const fs = require('fs').promises;
const path = require('path');

const STATUS_FILE = path.join(__dirname, '..', 'data', 'status', 'latest.json');

/**
 * Actualiza el archivo de status con información de la última ejecución
 * @param {Object} statusData - Datos del status
 * @param {string} statusData.lastRun - Timestamp de última ejecución
 * @param {number} statusData.totalUrls - Total de URLs procesadas
 * @param {number} statusData.successCount - URLs exitosas
 * @param {number} statusData.errorCount - URLs con error
 * @param {number} statusData.changedCount - URLs con cambios
 * @param {number} statusData.alertsCount - Alertas generadas
 */
async function updateStatus(statusData) {
  const status = {
    lastRun: statusData.lastRun || new Date().toISOString(),
    totalUrls: statusData.totalUrls || 0,
    successCount: statusData.successCount || 0,
    errorCount: statusData.errorCount || 0,
    changedCount: statusData.changedCount || 0,
    alertsCount: statusData.alertsCount || 0,
    status: 'ok'
  };
  
  // Asegurar que el directorio existe
  const dir = path.dirname(STATUS_FILE);
  await fs.mkdir(dir, { recursive: true });
  
  // Escribir archivo
  await fs.writeFile(STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
}

module.exports = { updateStatus };
