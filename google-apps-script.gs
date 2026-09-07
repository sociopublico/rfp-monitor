/**
 * Apps Script del spreadsheet "Monitoreo de RFPs".
 *
 * Cómo instalarlo:
 * 1. Abrí el spreadsheet → Extensiones → Apps Script
 * 2. Reemplazá el código por este archivo y guardá
 * 3. Ejecutá una vez `updateStatusAndKeywords` desde el editor y autorizá
 *    el acceso (UrlFetchApp + Spreadsheet)
 * 4. En el spreadsheet va a aparecer el menú "RFP Monitor"
 *
 * Importante:
 * - Un onOpen simple NO puede llamar a la API (Google lo bloquea).
 *   Por eso el menú; si querés auto-update al abrir, creá un activador
 *   instalable: Reloj → Activadores → evento al abrir → updateStatusAndKeywords.
 * - Siempre escribe en la hoja "Sitios RFPs", aunque estés mirando Keywords
 *   o Propuestas identificadas (esas también tienen columna Link).
 */

const API_URL = 'https://rfp.sociopublico.com/api/urls';
const SITIOS_SHEET_NAME = 'Sitios RFPs';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('RFP Monitor')
    .addItem('Actualizar status y keywords', 'updateStatusAndKeywords')
    .addToUi();
}

function manualUpdate() {
  updateStatusAndKeywords();
}

function updateStatusAndKeywords() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SITIOS_SHEET_NAME) || SpreadsheetApp.getActiveSheet();

  if (!sheet) {
    SpreadsheetApp.getUi().alert('No se encontró la hoja "' + SITIOS_SHEET_NAME + '".');
    return;
  }

  if (sheet.getName() !== SITIOS_SHEET_NAME) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'No encontré "' + SITIOS_SHEET_NAME + '". Actualicé la hoja activa: ' + sheet.getName(),
      'RFP Monitor',
      6
    );
  }

  const apiData = fetchApiData();
  if (!apiData || !apiData.urls || apiData.urls.length === 0) {
    SpreadsheetApp.getUi().alert(
      'No pude leer la API (' + API_URL + '). El spreadsheet no se tocó.'
    );
    return;
  }

  const urlMap = new Map();
  apiData.urls.forEach(function (item) {
    urlMap.set(normalizeUrl(item.url), item);
  });

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) {
    return;
  }

  const headerRange = sheet.getRange(1, 1, 1, lastColumn);
  const headers = headerRange.getValues()[0];

  let linkCol = -1;
  let statusCol = -1;
  let keywordsCol = -1;

  for (let i = 0; i < headers.length; i++) {
    const headerValue = String(headers[i] || '').toLowerCase().trim();
    if (headerValue === 'link') {
      linkCol = i;
    } else if (headerValue === 'status') {
      statusCol = i;
    } else if (headerValue === 'keywords') {
      keywordsCol = i;
    }
  }

  if (linkCol === -1) {
    SpreadsheetApp.getUi().alert('No encontré la columna "Link" en ' + sheet.getName());
    return;
  }

  if (statusCol === -1) {
    statusCol = lastColumn;
    sheet.getRange(1, statusCol + 1).setValue('status');
  }
  if (keywordsCol === -1) {
    keywordsCol = Math.max(lastColumn, statusCol + 1);
    sheet.getRange(1, keywordsCol + 1).setValue('keywords');
  }

  const numRows = lastRow - 1;
  const linkValues = sheet.getRange(2, linkCol + 1, numRows, 1).getValues();
  const statusValues = sheet.getRange(2, statusCol + 1, numRows, 1).getValues();
  const keywordValues = sheet.getRange(2, keywordsCol + 1, numRows, 1).getValues();

  let updatedCount = 0;
  let unmatchedCount = 0;

  for (let i = 0; i < numRows; i++) {
    const linkValue = String(linkValues[i][0] || '').trim();
    if (!linkValue) {
      continue;
    }

    const matched = urlMap.get(normalizeUrl(linkValue));
    if (matched) {
      statusValues[i][0] = matched.status || '';
      keywordValues[i][0] = Array.isArray(matched.keywords)
        ? matched.keywords.join(', ')
        : (matched.keywords || '');
      updatedCount++;
    } else {
      unmatchedCount++;
    }
  }

  sheet.getRange(2, statusCol + 1, numRows, 1).setValues(statusValues);
  sheet.getRange(2, keywordsCol + 1, numRows, 1).setValues(keywordValues);

  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Listo: ' + updatedCount + ' URLs actualizadas' +
      (unmatchedCount ? ' · ' + unmatchedCount + ' todavía no aparecen en la API' : ''),
    'RFP Monitor',
    5
  );
}

function normalizeUrl(url) {
  if (!url) return '';

  try {
    const urlObj = new URL(String(url).trim());
    let normalized = urlObj.protocol + '//' + urlObj.hostname.toLowerCase();

    if (urlObj.pathname && urlObj.pathname !== '/') {
      normalized += urlObj.pathname.replace(/\/$/, '');
    }

    if (urlObj.search) {
      normalized += urlObj.search;
    }

    return normalized;
  } catch (e) {
    return String(url).trim().toLowerCase().replace(/\/$/, '');
  }
}

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

    return JSON.parse(response.getContentText());
  } catch (error) {
    Logger.log('Error al obtener datos de la API: ' + error.toString());
    return null;
  }
}
