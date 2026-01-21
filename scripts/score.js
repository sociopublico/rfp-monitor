const config = require('../config/profile');

/**
 * Calcula el score de cambio basado en el ratio de cambio
 * @param {number} changeRatio - Ratio de cambio (0-1)
 * @returns {number} - Score de cambio (0-100)
 */
function calculateChangeScore(changeRatio) {
  if (changeRatio === 0) {
    return 0;
  }
  
  // Score aumenta exponencialmente con el cambio
  // Cambios pequeños (5%) = 20 puntos
  // Cambios medianos (20%) = 50 puntos
  // Cambios grandes (50%+) = 100 puntos
  const score = Math.min(100, Math.pow(changeRatio * 2, 0.7) * 100);
  return Math.round(score);
}

/**
 * Calcula el score final combinando changeScore y relevanceScore
 * @param {number} changeScore - Score de cambio (0-100)
 * @param {number} relevanceScore - Score de relevancia (0-100)
 * @param {boolean} hasChanged - Si hubo cambio detectado
 * @returns {number} - Score final (0-100)
 */
function calculateFinalScore(changeScore, relevanceScore, hasChanged) {
  // Si no hay cambio, el score final es bajo (solo relevancia)
  if (!hasChanged) {
    return Math.round(relevanceScore * 0.3); // Máximo 30 puntos sin cambio
  }
  
  // Combinar scores con pesos:
  // - changeScore: 40% del peso (indica que algo cambió)
  // - relevanceScore: 60% del peso (indica relevancia temática)
  const finalScore = (changeScore * 0.4) + (relevanceScore * 0.6);
  
  return Math.round(Math.min(100, finalScore));
}

/**
 * Determina si se debe generar una alerta basado en el score final
 * @param {number} finalScore - Score final calculado
 * @param {Object} thresholds - Umbrales de configuración (opcional)
 * @returns {boolean} - true si debe generar alerta
 */
function shouldGenerateAlert(finalScore, thresholds = null) {
  const configThresholds = thresholds || config.analysisThresholds;
  const minFinalScore = configThresholds?.minFinalScore || 60;
  
  return finalScore >= minFinalScore;
}

/**
 * Genera un resumen explicativo del scoring
 * @param {Object} scores - Objetos con los scores calculados
 * @param {number} scores.changeScore - Score de cambio
 * @param {number} scores.relevanceScore - Score de relevancia
 * @param {number} scores.finalScore - Score final
 * @param {boolean} scores.hasChanged - Si hubo cambio
 * @param {number} scores.changeRatio - Ratio de cambio
 * @param {number} scores.keywordHits - Hits de keywords
 * @returns {string} - Resumen explicativo
 */
function generateScoreSummary(scores) {
  const parts = [];
  
  if (scores.hasChanged) {
    parts.push(`Cambio detectado (ratio: ${(scores.changeRatio * 100).toFixed(1)}%)`);
    parts.push(`Change Score: ${scores.changeScore}/100`);
  } else {
    parts.push('Sin cambios detectados');
  }
  
  if (scores.keywordHits > 0) {
    parts.push(`${scores.keywordHits} keyword(s) RFP encontrado(s)`);
  }
  
  parts.push(`Relevance Score: ${scores.relevanceScore}/100`);
  parts.push(`Final Score: ${scores.finalScore}/100`);
  
  if (scores.finalScore >= (config.analysisThresholds?.minFinalScore || 60)) {
    parts.push('⚠️ ALERTA: Score supera umbral mínimo');
  }
  
  return parts.join(' | ');
}

module.exports = {
  calculateChangeScore,
  calculateFinalScore,
  shouldGenerateAlert,
  generateScoreSummary
};
