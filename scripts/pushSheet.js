const fs = require('fs').promises;
const path = require('path');

/**
 * Manda el reporte de la última corrida al Apps Script del spreadsheet.
 * Si faltan SHEETS_WEBHOOK_URL o SHEETS_WEBHOOK_TOKEN, no hace nada.
 */
async function pushLatestReport() {
  const url = process.env.SHEETS_WEBHOOK_URL;
  const token = process.env.SHEETS_WEBHOOK_TOKEN;
  if (!url || !token) {
    console.log('Sin SHEETS_WEBHOOK_URL o SHEETS_WEBHOOK_TOKEN. El spreadsheet no se tocó.');
    return;
  }

  const reportsDir = path.join(__dirname, '..', 'reports');
  const names = (await fs.readdir(reportsDir))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();
  if (names.length === 0) {
    throw new Error('No hay reportes en reports/');
  }

  const reportPath = path.join(reportsDir, names[names.length - 1]);
  const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      runDate: report.runDate,
      generatedAt: report.generatedAt,
      urls: report.urls,
      palabras: report.palabras,
      includesAppearance: true
    })
  });

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = null;
  }
  if (!response.ok || !body || body.ok !== true) {
    throw new Error(`El spreadsheet rechazó el reporte (${response.status}): ${bodyText.slice(0, 500)}`);
  }
  console.log(`Spreadsheet actualizado desde ${names[names.length - 1]}: ${body.updated} URLs`);
}

if (require.main === module) {
  pushLatestReport().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { pushLatestReport };
