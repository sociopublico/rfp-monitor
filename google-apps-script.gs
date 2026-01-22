/**
 * Script de Google Apps Script para actualizar status y keywords desde la API
 * 
 * Instrucciones:
 * 1. Abre tu Google Sheet
 * 2. Ve a Extensiones > Apps Script
 * 3. Pega este código
 * 4. Guarda el proyecto
 * 5. El script se ejecutará automáticamente al abrir el spreadsheet
 */

const API_URL = 'https://rfp.sociopublico.com/api/urls';

/**
 * Función que se ejecuta al abrir el spreadsheet
 */
function onOpen() {
  try {
    updateStatusAndKeywords();
  } catch (error) {
    Logger.log('Error en onOpen: ' + error.toString());
    SpreadsheetApp.getUi().alert('Error al actualizar datos: ' + error.message);
  }
}

/**
 * Función principal que actualiza status y keywords
 */
function updateStatusAndKeywords() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet) {
    Logger.log('No hay hoja activa');
    return;
  }
  
  // Obtener datos de la API
  const apiData = fetchApiData();
  if (!apiData || !apiData.urls || apiData.urls.length === 0) {
    Logger.log('No se obtuvieron datos de la API');
    return;
  }
  
  // Crear un mapa de URL -> datos para búsqueda rápida
  const urlMap = new Map();
  apiData.urls.forEach(item => {
    urlMap.set(item.url, item);
  });
  
  // Encontrar las columnas
  const headerRow = 1;
  const lastColumn = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  
  // Buscar columnas: Link, status, keywords
  let linkCol = -1;
  let statusCol = -1;
  let keywordsCol = -1;
  
  for (let col = 1; col <= lastColumn; col++) {
    const headerValue = sheet.getRange(headerRow, col).getValue().toString().toLowerCase().trim();
    if (headerValue === 'link') {
      linkCol = col;
    } else if (headerValue === 'status') {
      statusCol = col;
    } else if (headerValue === 'keywords') {
      keywordsCol = col;
    }
  }
  
  if (linkCol === -1) {
    Logger.log('No se encontró la columna "Link"');
    return;
  }
  
  // Crear columnas si no existen
  if (statusCol === -1) {
    statusCol = lastColumn + 1;
    sheet.getRange(headerRow, statusCol).setValue('Status');
  }
  
  if (keywordsCol === -1) {
    keywordsCol = lastColumn + 1;
    if (statusCol === lastColumn + 1) {
      keywordsCol = lastColumn + 2;
    }
    sheet.getRange(headerRow, keywordsCol).setValue('Keywords');
  }
  
  // Procesar cada fila
  let updatedCount = 0;
  for (let row = 2; row <= lastRow; row++) {
    const linkValue = sheet.getRange(row, linkCol).getValue().toString().trim();
    
    if (!linkValue || linkValue === '') {
      continue;
    }
    
    // Buscar en el mapa (comparar URLs normalizadas)
    const normalizedLink = normalizeUrl(linkValue);
    let matchedData = null;
    
    for (const [apiUrl, data] of urlMap.entries()) {
      if (normalizeUrl(apiUrl) === normalizedLink) {
        matchedData = data;
        break;
      }
    }
    
    if (matchedData) {
      // Actualizar status
      sheet.getRange(row, statusCol).setValue(matchedData.status || '');
      
      // Actualizar keywords (convertir array a string separado por comas)
      const keywordsStr = Array.isArray(matchedData.keywords) 
        ? matchedData.keywords.join(', ') 
        : (matchedData.keywords || '');
      sheet.getRange(row, keywordsCol).setValue(keywordsStr);
      
      updatedCount++;
    } else {
      // Si no se encuentra, limpiar las celdas
      sheet.getRange(row, statusCol).setValue('');
      sheet.getRange(row, keywordsCol).setValue('');
    }
  }
  
  Logger.log('Actualizadas ' + updatedCount + ' filas');
  
  // Mostrar notificación
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Actualización completada: ' + updatedCount + ' URLs actualizadas',
    'Actualización de Status',
    3
  );
}

/**
 * Normaliza una URL para comparación (remueve trailing slash, convierte a lowercase, etc)
 */
function normalizeUrl(url) {
  if (!url) return '';
  
  try {
    const urlObj = new URL(url.trim());
    let normalized = urlObj.protocol + '//' + urlObj.hostname.toLowerCase();
    
    // Agregar path sin trailing slash
    if (urlObj.pathname && urlObj.pathname !== '/') {
      normalized += urlObj.pathname.replace(/\/$/, '');
    }
    
    // Agregar query string si existe
    if (urlObj.search) {
      normalized += urlObj.search;
    }
    
    return normalized;
  } catch (e) {
    // Si no es una URL válida, retornar normalizada sin protocolo
    return url.trim().toLowerCase().replace(/\/$/, '');
  }
}

/**
 * Obtiene datos de la API
 */
function fetchApiData() {
  try {
    const response = UrlFetchApp.fetch(API_URL, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });
    
    const responseCode = response.getResponseCode();
    
    if (responseCode !== 200) {
      Logger.log('Error en API: ' + responseCode + ' - ' + response.getContentText());
      return null;
    }
    
    const responseText = response.getContentText();
    const data = JSON.parse(responseText);
    
    return data;
  } catch (error) {
    Logger.log('Error al obtener datos de la API: ' + error.toString());
    return null;
  }
}

/**
 * Función manual para ejecutar la actualización (útil para testing)
 */
function manualUpdate() {
  updateStatusAndKeywords();
}
