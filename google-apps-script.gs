/**
 * Apps Script del spreadsheet "Monitoreo de RFPs".
 *
 * Cómo instalarlo:
 * 1. Abrí el spreadsheet → Extensiones → Apps Script
 * 2. Reemplazá el código por este archivo y guardá
 * 3. Ejecutá una vez `updateStatusAndKeywords` desde el editor y autorizá
 *    el acceso (UrlFetchApp + Spreadsheet)
 * 4. En la hoja aparece el menú "RFP Monitor"
 * 5. Para que el scrape de los lunes escriba solo:
 *    - Proyecto → Configuración del proyecto → Propiedades del script
 *    - Creá SHEETS_WEBHOOK_TOKEN con un secreto largo
 *    - Implementar → Nueva implementación → Aplicación web
 *    - Ejecutar como: yo. Quién tiene acceso: cualquier persona
 *    - Copiá la URL que termina en /exec
 *    - En el repo, secrets SHEETS_WEBHOOK_URL (esa URL) y
 *      SHEETS_WEBHOOK_TOKEN (el mismo valor)
 *
 * Importante:
 * - Un onOpen simple NO puede llamar a la API (Google lo bloquea).
 *   Por eso el menú; si querés auto-update al abrir, creá un activador
 *   instalable: Reloj → Activadores → evento al abrir → updateStatusAndKeywords.
 * - Siempre escribe en la hoja "Sitios RFPs", aunque estés mirando Keywords
 *   o Propuestas identificadas (esas también tienen columna Link).
 * - El POST del lunes también escribe la hoja "Semana" (15 palabras y
 *   RFPs nuevos). El menú manual no la toca.
 */

// Mientras el droplet sirva Express, la ruta no lleva extensión.
// Cuando el dominio apunte a GitHub Pages, cambiar a:
// https://rfp.sociopublico.com/api/urls.json
const API_URL = 'https://rfp.sociopublico.com/api/urls';
const SITIOS_SHEET_NAME = 'Sitios RFPs';
const SEMANA_SHEET_NAME = 'Semana';

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
  const apiData = fetchApiData();
  if (!apiData || !apiData.urls || apiData.urls.length === 0) {
    SpreadsheetApp.getUi().alert(
      'No pude leer la API (' + API_URL + '). El spreadsheet no se tocó.'
    );
    return;
  }
  let result;
  try {
    result = applyStatusAndKeywords_(apiData.urls, { includesAppearance: false });
  } catch (error) {
    SpreadsheetApp.getUi().alert(String(error));
    return;
  }
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Listo: ' + result.updatedCount + ' URLs actualizadas' +
      (result.unmatchedCount ? ' · ' + result.unmatchedCount + ' todavía no aparecen en la API' : ''),
    'RFP Monitor',
    5
  );
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('SHEETS_WEBHOOK_TOKEN');
    if (!expected || body.token !== expected) {
      return jsonResponse_({ ok: false, error: 'unauthorized' });
    }
    const result = applyStatusAndKeywords_(body.urls || [], {
      includesAppearance: Boolean(body.includesAppearance)
    });
    const palabras = writeSemana_(body);
    return jsonResponse_({
      ok: true,
      updated: result.updatedCount,
      palabras: palabras
    });
  } catch (error) {
    return jsonResponse_({ ok: false, error: String(error) });
  }
}

function applyStatusAndKeywords_(urlItems, options) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SITIOS_SHEET_NAME) || ss.getActiveSheet();
  const includesAppearance = Boolean(options && options.includesAppearance);

  if (!sheet) {
    throw new Error('No se encontró la hoja "' + SITIOS_SHEET_NAME + '".');
  }

  if (sheet.getName() !== SITIOS_SHEET_NAME) {
    ss.toast(
      'No encontré "' + SITIOS_SHEET_NAME + '". Actualicé la hoja activa: ' + sheet.getName(),
      'RFP Monitor',
      6
    );
  }

  const urlMap = new Map();
  (urlItems || []).forEach(function (item) {
    if (item && item.url) {
      urlMap.set(normalizeUrl(item.url), item);
    }
  });

  const lastRow = sheet.getLastRow();
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  if (lastRow < 2) {
    return { updatedCount: 0, unmatchedCount: 0 };
  }

  const headerRange = sheet.getRange(1, 1, 1, lastColumn);
  const headers = headerRange.getValues()[0];

  const linkCol = columnIndex_(headers, 'link');
  if (linkCol === -1) {
    throw new Error('No encontré la columna "Link" en ' + sheet.getName());
  }

  let statusCol = columnIndex_(headers, 'status');
  if (statusCol === -1) {
    statusCol = ensureColumn_(sheet, headers, 'status');
  }
  let keywordsCol = columnIndex_(headers, 'keywords');
  if (keywordsCol === -1) {
    keywordsCol = ensureColumn_(sheet, headers, 'keywords');
  }

  let windowCol = -1;
  let pageDateCol = -1;
  if (includesAppearance) {
    windowCol = ensureColumn_(sheet, headers, 'aparecio entre');
    pageDateCol = ensureColumn_(sheet, headers, 'fecha en la pagina');
  }

  const width = Math.max(sheet.getLastColumn(), headers.length);
  const numRows = lastRow - 1;
  const linkValues = sheet.getRange(2, linkCol + 1, numRows, 1).getValues();
  const statusValues = readColumn_(sheet, numRows, statusCol, width);
  const keywordValues = readColumn_(sheet, numRows, keywordsCol, width);
  const windowValues = includesAppearance ? readColumn_(sheet, numRows, windowCol, width) : null;
  const pageDateValues = includesAppearance ? readColumn_(sheet, numRows, pageDateCol, width) : null;

  let updatedCount = 0;
  let unmatchedCount = 0;

  for (let i = 0; i < numRows; i++) {
    const linkValue = String(linkValues[i][0] || '').trim();
    if (!linkValue) {
      continue;
    }

    const matched = urlMap.get(normalizeUrl(linkValue));
    if (!matched) {
      unmatchedCount++;
      continue;
    }

    statusValues[i][0] = matched.status || '';
    keywordValues[i][0] = Array.isArray(matched.keywords)
      ? matched.keywords.join(', ')
      : (matched.keywords || '');
    if (includesAppearance) {
      windowValues[i][0] = formatWindow_(matched.aparecioEntre);
      pageDateValues[i][0] = matched.fechaEnLaPagina || '';
    }
    updatedCount++;
  }

  sheet.getRange(2, statusCol + 1, numRows, 1).setValues(statusValues);
  sheet.getRange(2, keywordsCol + 1, numRows, 1).setValues(keywordValues);
  if (includesAppearance) {
    sheet.getRange(2, windowCol + 1, numRows, 1).setValues(windowValues);
    sheet.getRange(2, pageDateCol + 1, numRows, 1).setValues(pageDateValues);
  }

  return { updatedCount: updatedCount, unmatchedCount: unmatchedCount };
}

function writeSemana_(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SEMANA_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SEMANA_SHEET_NAME);
  }
  sheet.clear();

  const palabras = Array.isArray(body.palabras) ? body.palabras : [];
  const rows = [
    ['Palabras de la semana', body.runDate || ''],
    ['palabra', 'peso']
  ];
  palabras.forEach(function (item) {
    rows.push([item.palabra || '', item.peso || 0]);
  });
  if (palabras.length === 0) {
    rows.push(['(ninguna esta semana)', '']);
  }

  rows.push(['']);
  rows.push(['RFPs nuevos', 'status', 'aparecio entre', 'fecha en la pagina', 'keywords']);
  const urls = Array.isArray(body.urls) ? body.urls : [];
  let nuevos = 0;
  urls.forEach(function (item) {
    if (!isNewRfpStatus_(item && item.status)) {
      return;
    }
    nuevos++;
    const keywords = Array.isArray(item.keywords) ? item.keywords.join(', ') : (item.keywords || '');
    rows.push([
      item.url || '',
      item.status || '',
      formatWindow_(item.aparecioEntre),
      item.fechaEnLaPagina || '',
      keywords
    ]);
  });
  if (nuevos === 0) {
    rows.push(['(ninguno esta semana)', '', '', '', '']);
  }

  sheet.getRange(1, 1, rows.length, 5).setValues(rows.map(function (row) {
    const padded = row.slice();
    while (padded.length < 5) {
      padded.push('');
    }
    return padded;
  }));
  return palabras.length;
}

function isNewRfpStatus_(status) {
  return status === 'cambios relevantes' || status === 'cambios - posiblemente relevante';
}

function formatWindow_(window) {
  if (!window || !window.desde || !window.hasta) {
    return '';
  }
  return String(window.desde).slice(0, 10) + ' → ' + String(window.hasta).slice(0, 10);
}

function columnIndex_(headers, name) {
  const target = String(name || '').toLowerCase().trim();
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').toLowerCase().trim() === target) {
      return i;
    }
  }
  return -1;
}

function ensureColumn_(sheet, headers, name) {
  const existing = columnIndex_(headers, name);
  if (existing !== -1) {
    return existing;
  }
  const index = headers.length;
  sheet.getRange(1, index + 1).setValue(name);
  headers.push(name);
  return index;
}

function readColumn_(sheet, numRows, colIndex, width) {
  if (colIndex + 1 <= width && sheet.getLastColumn() >= colIndex + 1) {
    return sheet.getRange(2, colIndex + 1, numRows, 1).getValues();
  }
  const blank = [];
  for (let i = 0; i < numRows; i++) {
    blank.push(['']);
  }
  return blank;
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

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
