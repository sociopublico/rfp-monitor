const fs = require('fs').promises;
const path = require('path');

const ALERTS_DIR = path.join(__dirname, '..', 'data', 'alerts');

/**
 * Genera y guarda una alerta cuando se detecta una oportunidad relevante
 * @param {Object} alertData - Datos de la alerta
 * @param {string} alertData.url - URL donde se detectó la oportunidad
 * @param {string} alertData.slug - Slug de la URL
 * @param {number} alertData.finalScore - Score final calculado
 * @param {string} alertData.reason - Razón de la alerta
 * @param {Object} alertData.scores - Objetos con scores detallados
 * @param {Object} alertData.analysis - Resultado del análisis semántico
 * @param {Object} alertData.change - Información del cambio detectado
 * @returns {Promise<string>} - Ruta del archivo de alerta creado
 */
async function generateAlert(alertData) {
  await fs.mkdir(ALERTS_DIR, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}-${alertData.slug}.json`;
  const alertPath = path.join(ALERTS_DIR, filename);
  
  const alert = {
    timestamp: new Date().toISOString(),
    url: alertData.url,
    slug: alertData.slug,
    finalScore: alertData.finalScore,
    reason: alertData.reason,
    scores: {
      changeScore: alertData.scores.changeScore,
      relevanceScore: alertData.scores.relevanceScore,
      finalScore: alertData.finalScore
    },
    analysis: {
      hasOpportunity: alertData.analysis.hasOpportunity,
      relevanceScore: alertData.analysis.relevanceScore,
      reason: alertData.analysis.reason
    },
    change: {
      hasChanged: alertData.change.hasChanged,
      changeRatio: alertData.change.changeRatio,
      textLength: alertData.change.textLength
    },
    summary: alertData.reason
  };
  
  await fs.writeFile(alertPath, JSON.stringify(alert, null, 2), 'utf-8');
  
  return alertPath;
}

module.exports = {
  generateAlert
};
