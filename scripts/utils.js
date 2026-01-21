const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

/**
 * Genera un slug seguro basado en una URL
 * @param {string} url - URL a convertir en slug
 * @returns {string} - Slug generado (dominio + path)
 */
function generateSlug(url) {
  try {
    const urlObj = new URL(url);
    let slug = urlObj.hostname.replace(/^www\./, ''); // Remover www.
    
    // Agregar path si existe y no es solo "/"
    if (urlObj.pathname && urlObj.pathname !== '/') {
      slug += urlObj.pathname
        .replace(/\/$/, '') // Remover trailing slash
        .replace(/[^a-zA-Z0-9]/g, '_') // Reemplazar caracteres especiales
        .substring(0, 100); // Limitar longitud
    }
    
    // Limpiar y normalizar
    slug = slug
      .replace(/_+/g, '_') // Múltiples guiones bajos a uno solo
      .replace(/^_|_$/g, ''); // Remover guiones al inicio/fin
    
    return slug || 'index';
  } catch (error) {
    // Si la URL no es válida, generar slug genérico
    return url
      .replace(/[^a-zA-Z0-9]/g, '_')
      .substring(0, 50)
      .replace(/^_|_$/g, '') || 'unknown';
  }
}

/**
 * Valida si una cadena es una URL válida
 * @param {string} str - Cadena a validar
 * @returns {boolean} - true si es URL válida
 */
function isValidUrl(str) {
  if (!str || typeof str !== 'string' || str.trim() === '') {
    return false;
  }
  
  try {
    const url = new URL(str.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Extrae texto visible del HTML usando cheerio
 * Excluye scripts, styles, navs, headers, footers
 * @param {string} html - HTML a procesar
 * @returns {string} - Texto visible normalizado
 */
function extractVisibleText(html) {
  const $ = cheerio.load(html);
  
  // Remover elementos no deseados
  $('script, style, noscript, nav, footer, header').remove();
  
  // Obtener texto del body
  let text = $('body').text() || $('html').text();
  
  // Normalizar espacios: múltiples espacios/blancos a uno solo
  text = text
    .replace(/\s+/g, ' ') // Múltiples espacios a uno
    .replace(/\n\s*\n/g, '\n') // Múltiples saltos de línea a uno
    .trim();
  
  return text;
}

/**
 * Asegura que un directorio existe, creándolo si es necesario
 * @param {string} dirPath - Ruta del directorio
 */
async function ensureDirectoryExists(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * Lee el archivo metadata.json si existe, o retorna array vacío
 * @param {string} metadataPath - Ruta al archivo metadata.json
 * @returns {Promise<Array>} - Array de metadatos existentes
 */
async function readMetadata(metadataPath) {
  try {
    const content = await fs.readFile(metadataPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * Escribe el archivo metadata.json
 * @param {string} metadataPath - Ruta al archivo metadata.json
 * @param {Array} metadata - Array de metadatos a guardar
 */
async function writeMetadata(metadataPath, metadata) {
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

module.exports = {
  generateSlug,
  isValidUrl,
  extractVisibleText,
  ensureDirectoryExists,
  readMetadata,
  writeMetadata
};
