const https = require('https');
const http = require('http');
const csv = require('csv-parser');

const KEYWORDS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRHDJfR9H6Zx0G-VPvdYQMWO7n8TbbdsCyxgfgc_3r8wks1-ic1H0dDoXCqSanVKq10yVzmhbdbj5hO/pub?gid=915784238&single=true&output=csv';

// Cache de keywords
let cachedKeywords = null;
let cacheTimestamp = null;
const CACHE_TTL = 3600000; // 1 hora en ms

/**
 * Descarga el CSV de keywords desde Google Sheets
 * @param {string} url - URL del CSV
 * @param {number} maxRedirects - Máximo de redirecciones
 * @returns {Promise<string>} - Contenido del CSV
 */
function downloadCsv(url = KEYWORDS_CSV_URL, maxRedirects = 5) {
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
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const redirectUrl = response.headers.location.startsWith('http')
          ? response.headers.location
          : `${urlObj.protocol}//${urlObj.hostname}${response.headers.location}`;
        return downloadCsv(redirectUrl, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error(`Error al descargar CSV: ${response.statusCode} ${response.statusMessage}`));
        return;
      }

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
 * Carga keywords desde el CSV de Google Sheets
 * @param {boolean} forceRefresh - Forzar recarga sin usar cache
 * @returns {Promise<Array<string>>} - Array de keywords
 */
async function loadKeywords(forceRefresh = false) {
  // Verificar cache
  if (!forceRefresh && cachedKeywords && cacheTimestamp) {
    const age = Date.now() - cacheTimestamp;
    if (age < CACHE_TTL) {
      return cachedKeywords;
    }
  }

  try {
    const csvContent = await downloadCsv();
    
    return new Promise((resolve, reject) => {
      const keywords = [];
      const stream = require('stream');
      const readable = new stream.Readable();
      readable.push(csvContent);
      readable.push(null);
      
      readable
        .pipe(csv())
        .on('data', (row) => {
          const word = (row['word'] || row['Word'] || '').trim();
          if (word && word.length > 0) {
            keywords.push(word.toLowerCase());
          }
        })
        .on('end', () => {
          // Actualizar cache
          cachedKeywords = keywords;
          cacheTimestamp = Date.now();
          resolve(keywords);
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  } catch (error) {
    // Si falla, usar cache si existe
    if (cachedKeywords) {
      console.warn('⚠️  Error al cargar keywords del CSV, usando cache:', error.message);
      return cachedKeywords;
    }
    throw new Error(`Error al cargar keywords: ${error.message}`);
  }
}

/**
 * Limpia el cache de keywords
 */
function clearCache() {
  cachedKeywords = null;
  cacheTimestamp = null;
}

module.exports = {
  loadKeywords,
  clearCache
};
