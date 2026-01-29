const https = require('https');
const http = require('http');
const csv = require('csv-parser');
const { isValidUrl } = require('./utils');

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZIJlaIWq3EP38gapc_JGas5gPeE801zNpb8_X1ij1F8VED0ZA6ANSCgmo0ilj1ZlvVILEDDTnuwx7/pub?gid=0&single=true&output=csv';

/**
 * Descarga el CSV desde la URL de Google Sheets
 * Maneja redirecciones HTTP (301, 302, 307, 308)
 * @param {string} url - URL a descargar
 * @param {number} maxRedirects - Máximo número de redirecciones a seguir (default: 5)
 * @returns {Promise<string>} - Contenido del CSV como string
 */
function downloadCsv(url = CSV_URL, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) {
      reject(new Error('Demasiadas redirecciones'));
      return;
    }

    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    const req = client.request(options, (response) => {
      // Manejar redirecciones
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Consumir la respuesta para liberar recursos
        response.resume();
        
        // Seguir la redirección
        const redirectUrl = response.headers.location.startsWith('http')
          ? response.headers.location
          : `${urlObj.protocol}//${urlObj.hostname}${response.headers.location}`;
        
        return downloadCsv(redirectUrl, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }

      // Si no es una respuesta exitosa, rechazar
      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error(`Error al descargar CSV: ${response.statusCode} ${response.statusMessage}`));
        return;
      }

      // Leer el contenido
      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        resolve(data);
      });

      response.on('error', (error) => {
        reject(error);
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

/**
 * Parsea el CSV y filtra las filas según los criterios:
 * - "Tiene sitio RFPs" debe ser "SI" o "OTRO" (case insensitive)
 * - "Link" debe ser una URL válida y no vacía
 * @returns {Promise<Array>} - Array de objetos con las filas filtradas
 */
async function readAndFilterCsv() {
  try {
    const csvContent = await downloadCsv();
    
    return new Promise((resolve, reject) => {
      const results = [];
      
      // Crear un stream desde el string del CSV
      const stream = require('stream');
      const readable = new stream.Readable();
      readable.push(csvContent);
      readable.push(null);
      
      readable
        .pipe(csv())
        .on('data', (row) => {
          // Normalizar nombres de columnas (por si hay espacios extra)
          const tieneSitioRFPs = (row['Tiene sitio RFPs'] || row['Tiene sitio RFPs '] || '').trim();
          const link = (row['Link'] || row['Link '] || '').trim();
          
          // Filtrar: debe ser "SI" o "OTRO" (case insensitive) y tener URL válida
          const tieneSitioUpper = tieneSitioRFPs.toUpperCase();
          if ((tieneSitioUpper === 'SI' || tieneSitioUpper === 'OTRO') && isValidUrl(link)) {
            results.push({
              tieneSitioRFPs: tieneSitioRFPs,
              link: link
            });
          }
        })
        .on('end', () => {
          resolve(results);
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  } catch (error) {
    throw new Error(`Error al leer CSV: ${error.message}`);
  }
}

module.exports = {
  readAndFilterCsv
};
