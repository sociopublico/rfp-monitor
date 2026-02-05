const config = require('../config/profile');

/**
 * Calcula el score de cambio basado en el ratio de cambio
 * SCORING GENEROSO: Cualquier cambio da puntos significativos
 * @param {number} changeRatio - Ratio de cambio (0-1)
 * @returns {number} - Score de cambio (0-100)
 */
function calculateChangeScore(changeRatio) {
  if (changeRatio === 0) {
    return 0;
  }
  
  // SCORING GENEROSO:
  // - Cualquier cambio (>0%) = mínimo 30 puntos
  // - Cambio pequeño (1-5%) = 50 puntos
  // - Cambio mediano (5-20%) = 70 puntos
  // - Cambio grande (>20%) = 100 puntos
  if (changeRatio < 0.01) {
    return 30; // Cambio mínimo pero existente
  } else if (changeRatio < 0.05) {
    return 50; // Cambio pequeño
  } else if (changeRatio < 0.20) {
    return 70; // Cambio mediano
  } else {
    return 100; // Cambio grande
  }
}

/**
 * Calcula el score de keywords encontradas
 * SCORING MUY GENEROSO: 2-3 keywords = alto score
 * @param {number} keywordCount - Cantidad de keywords encontradas
 * @returns {number} - Score de keywords (0-100)
 */
function calculateKeywordScore(keywordCount) {
  if (keywordCount === 0) {
    return 0;
  }
  
  // SCORING MUY GENEROSO:
  // - 1 keyword = 40 puntos
  // - 2 keywords = 70 puntos
  // - 3+ keywords = 100 puntos
  if (keywordCount === 1) {
    return 40;
  } else if (keywordCount === 2) {
    return 70;
  } else {
    return 100; // 3 o más keywords = máximo
  }
}

/**
 * Calcula el score final combinando cambio y keywords
 * PRIORIZA KEYWORDS: Si hay keywords en cambios, es relevante
 * @param {number} changeScore - Score de cambio (0-100)
 * @param {number} relevanceScore - Score de relevancia (0-100)
 * @param {boolean} hasChanged - Si hubo cambio detectado
 * @param {number} keywordsInChangesCount - Cantidad de keywords en el texto cambiado
 * @param {boolean} isFirstRun - Si es primera ejecución
 * @returns {number} - Score final (0-100)
 */
function calculateFinalScore(changeScore, relevanceScore, hasChanged, keywordsInChangesCount = 0, isFirstRun = false) {
  // Calcular score de keywords en cambios
  const keywordScore = calculateKeywordScore(keywordsInChangesCount);
  
  // LÓGICA GENEROSA:
  // Si hay keywords en los cambios, eso es lo más importante
  if (keywordsInChangesCount >= 2) {
    // 2+ keywords en cambios = automáticamente relevante (mínimo 70)
    return Math.max(70, Math.round((keywordScore * 0.6) + (changeScore * 0.2) + (relevanceScore * 0.2)));
  }
  
  if (keywordsInChangesCount === 1) {
    // 1 keyword en cambios = probablemente relevante (mínimo 50)
    return Math.max(50, Math.round((keywordScore * 0.5) + (changeScore * 0.25) + (relevanceScore * 0.25)));
  }
  
  // Primera ejecución: considerar keywords en texto completo
  if (isFirstRun && relevanceScore > 30) {
    return Math.round(relevanceScore * 0.8); // Dar más peso en primera ejecución
  }
  
  // Sin keywords en cambios: score más bajo
  if (!hasChanged) {
    return Math.round(relevanceScore * 0.3); // Máximo 30 puntos sin cambio
  }
  
  // Cambio sin keywords relevantes
  return Math.round((changeScore * 0.5) + (relevanceScore * 0.5));
}

/**
 * Determina si se debe generar una alerta basado en el score final
 * UMBRAL BAJO: 30 puntos es suficiente para alertar
 * @param {number} finalScore - Score final calculado
 * @param {Object} thresholds - Umbrales de configuración (opcional)
 * @returns {boolean} - true si debe generar alerta
 */
function shouldGenerateAlert(finalScore, thresholds = null) {
  const configThresholds = thresholds || config.analysisThresholds;
  // UMBRAL MÁS BAJO: 30 en vez de 60
  const minFinalScore = configThresholds?.minFinalScore || 30;
  
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
 * @param {number} scores.changedChars - Caracteres cambiados
 * @param {number} scores.keywordHits - Hits de keywords totales
 * @param {number} scores.keywordsInChangesCount - Keywords en texto cambiado
 * @returns {string} - Resumen explicativo
 */
function generateScoreSummary(scores) {
  const parts = [];
  
  if (scores.isFirstRun) {
    parts.push('🆕 Primera ejecución');
  } else if (scores.hasChanged) {
    const changedChars = scores.changedChars || Math.round((scores.changeRatio || 0) * (scores.textLength || 0));
    parts.push(`📝 Cambio: ${changedChars} chars (${((scores.changeRatio || 0) * 100).toFixed(1)}%)`);
    parts.push(`Change Score: ${scores.changeScore}/100`);
  } else {
    parts.push('Sin cambios');
  }
  
  // Keywords en cambios es lo más importante
  const keywordsInChanges = scores.keywordsInChangesCount || 0;
  if (keywordsInChanges > 0) {
    parts.push(`🎯 ${keywordsInChanges} keyword(s) EN CAMBIOS`);
  }
  
  if (scores.keywordHits > 0 && scores.keywordHits !== keywordsInChanges) {
    parts.push(`(${scores.keywordHits} keywords total)`);
  }
  
  parts.push(`Final Score: ${scores.finalScore}/100`);
  
  // Umbral más bajo (30)
  if (scores.finalScore >= 30) {
    if (scores.finalScore >= 70) {
      parts.push('🔥 MUY RELEVANTE');
    } else if (scores.finalScore >= 50) {
      parts.push('⚠️ RELEVANTE');
    } else {
      parts.push('📌 Posiblemente relevante');
    }
  }
  
  return parts.join(' | ');
}

module.exports = {
  calculateChangeScore,
  calculateKeywordScore,
  calculateFinalScore,
  shouldGenerateAlert,
  generateScoreSummary
};
