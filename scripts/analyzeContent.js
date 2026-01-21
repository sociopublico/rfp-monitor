const config = require('../config/profile');

/**
 * Analiza semánticamente si el contenido podría corresponder a una proposal/RFP relevante
 * 
 * Por ahora implementa una versión mock que usa heurísticas simples.
 * Está preparado para luego integrar un LLM real.
 * 
 * @param {string} textSnippet - Fragmento de texto a analizar
 * @param {Object} profileConfig - Configuración del perfil (opcional, usa default si no se pasa)
 * @returns {Promise<Object>} - Resultado del análisis
 * @returns {boolean} hasOpportunity - Si detecta oportunidad relevante
 * @returns {number} relevanceScore - Score de relevancia (0-100)
 * @returns {string} reason - Razón explicativa del score
 */
async function analyzeRelevance(textSnippet, profileConfig = null) {
  const profile = profileConfig || config;
  
  if (!textSnippet || typeof textSnippet !== 'string' || textSnippet.trim().length === 0) {
    return {
      hasOpportunity: false,
      relevanceScore: 0,
      reason: 'Texto vacío o inválido'
    };
  }
  
  // Normalizar texto para análisis
  const normalizedText = textSnippet.toLowerCase();
  const textLength = normalizedText.length;
  
  // Limitar longitud del snippet si es muy largo
  const maxLength = profile.settings?.maxSnippetLength || 5000;
  const analysisText = normalizedText.substring(0, maxLength);
  
  // 1. Contar hits de keywords RFP
  const rfpHits = countKeywordHits(analysisText, profile.rfpKeywords);
  
  // 2. Contar hits de keywords de interés temático
  const interestHits = countKeywordHits(analysisText, profile.interestKeywords);
  
  // 3. Detectar fechas futuras (deadlines)
  const futureDates = profile.settings?.detectFutureDates 
    ? detectFutureDates(analysisText)
    : [];
  
  // 4. Calcular score base
  let score = 0;
  const reasons = [];
  
  // Score por keywords RFP (más peso)
  if (rfpHits > 0) {
    const rfpScore = Math.min(60, rfpHits * 15); // Máximo 60 puntos
    score += rfpScore;
    reasons.push(`${rfpHits} RFP keyword(s) encontrado(s)`);
  }
  
  // Score por keywords de interés (menos peso)
  if (interestHits > 0) {
    const interestScore = Math.min(30, interestHits * 3); // Máximo 30 puntos
    score += interestScore;
    reasons.push(`${interestHits} keyword(s) de interés temático`);
  }
  
  // Bonus por fechas futuras (indica deadline activo)
  if (futureDates.length > 0) {
    score += 10;
    reasons.push(`${futureDates.length} fecha(s) futura(s) detectada(s)`);
  }
  
  // Normalizar score a 0-100
  score = Math.min(100, Math.round(score));
  
  // Determinar si hay oportunidad
  const minHits = profile.analysisThresholds?.minKeywordHits || 2;
  const hasOpportunity = rfpHits >= minHits && score >= 30;
  
  // Construir razón explicativa
  let reason = '';
  if (hasOpportunity) {
    reason = `OPORTUNIDAD DETECTADA: ${reasons.join('; ')}`;
  } else if (rfpHits > 0 || interestHits > 0) {
    reason = `Relevancia parcial: ${reasons.join('; ')}`;
  } else {
    reason = 'No se detectaron keywords relevantes';
  }
  
  return {
    hasOpportunity,
    relevanceScore: score,
    reason
  };
}

/**
 * Cuenta cuántas veces aparecen las keywords en el texto
 * @param {string} text - Texto normalizado
 * @param {Array<string>} keywords - Array de keywords a buscar
 * @returns {number} - Número total de hits
 */
function countKeywordHits(text, keywords) {
  if (!keywords || keywords.length === 0) {
    return 0;
  }
  
  let hits = 0;
  for (const keyword of keywords) {
    // Buscar keyword como palabra completa (case insensitive)
    const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const matches = text.match(regex);
    if (matches) {
      hits += matches.length;
    }
  }
  
  return hits;
}

/**
 * Detecta fechas futuras en el texto (deadlines potenciales)
 * Patrones simples: "deadline: 2024-12-31", "due by january 2025", etc.
 * @param {string} text - Texto normalizado
 * @returns {Array<string>} - Array de fechas detectadas (formato ISO aproximado)
 */
function detectFutureDates(text) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const dates = [];
  
  // Patrón 1: YYYY-MM-DD o DD/MM/YYYY
  const datePattern1 = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
  const datePattern2 = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  
  let match;
  
  // Buscar fechas en formato YYYY-MM-DD
  while ((match = datePattern1.exec(text)) !== null) {
    const year = parseInt(match[1]);
    const month = parseInt(match[2]);
    const day = parseInt(match[3]);
    
    if (year >= currentYear) {
      try {
        const date = new Date(year, month - 1, day);
        if (date > now) {
          dates.push(date.toISOString().split('T')[0]);
        }
      } catch (e) {
        // Fecha inválida, ignorar
      }
    }
  }
  
  // Buscar fechas en formato DD/MM/YYYY
  while ((match = datePattern2.exec(text)) !== null) {
    const day = parseInt(match[1]);
    const month = parseInt(match[2]);
    const year = parseInt(match[3]);
    
    if (year >= currentYear) {
      try {
        const date = new Date(year, month - 1, day);
        if (date > now) {
          dates.push(date.toISOString().split('T')[0]);
        }
      } catch (e) {
        // Fecha inválida, ignorar
      }
    }
  }
  
  // Patrón 2: Meses del año + año futuro
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
  ];
  
  for (const monthName of monthNames) {
    const regex = new RegExp(`\\b${monthName}\\s+(\\d{4})\\b`, 'gi');
    while ((match = regex.exec(text)) !== null) {
      const year = parseInt(match[1]);
      if (year >= currentYear) {
        dates.push(`${year}-${monthName.substring(0, 3)}`);
      }
    }
  }
  
  // Eliminar duplicados
  return [...new Set(dates)];
}

module.exports = {
  analyzeRelevance,
  countKeywordHits,
  detectFutureDates
};
