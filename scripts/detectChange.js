const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const HistoryLogger = require('./historyLogger');
const { loadKeywords } = require('./loadKeywords');

const DIFFS_DIR = path.join(__dirname, '..', 'data', 'diffs');
const TEXT_DIR = path.join(__dirname, '..', 'data', 'snapshots', 'text');

/**
 * Normaliza texto para comparación:
 * - lowercase
 * - trim
 * - collapse espacios múltiples
 * @param {string} text - Texto a normalizar
 * @returns {string} - Texto normalizado
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' '); // Colapsar espacios múltiples
}

/**
 * Calcula hash SHA256 de un texto normalizado
 * @param {string} text - Texto a hashear
 * @returns {string} - Hash hexadecimal
 */
function calculateTextHash(text) {
  const normalized = normalizeText(text);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Calcula el ratio de cambio entre dos textos
 * Usa algoritmo simple de distancia basado en palabras
 * @param {string} oldText - Texto anterior
 * @param {string} newText - Texto nuevo
 * @returns {number} - Ratio de cambio (0-1)
 */
function calculateChangeRatio(oldText, newText) {
  const oldNormalized = normalizeText(oldText);
  const newNormalized = normalizeText(newText);
  
  if (!oldNormalized && !newNormalized) {
    return 0;
  }
  
  if (!oldNormalized) {
    return 1; // Todo es nuevo
  }
  
  if (!newNormalized) {
    return 1; // Todo fue eliminado
  }
  
  // Dividir en palabras
  const oldWords = oldNormalized.split(/\s+/).filter(w => w.length > 0);
  const newWords = newNormalized.split(/\s+/).filter(w => w.length > 0);
  
  if (oldWords.length === 0 && newWords.length === 0) {
    return 0;
  }
  
  // Calcular palabras únicas
  const oldSet = new Set(oldWords);
  const newSet = new Set(newWords);
  
  // Palabras añadidas
  const added = newWords.filter(w => !oldSet.has(w));
  // Palabras eliminadas
  const removed = oldWords.filter(w => !newSet.has(w));
  
  // Ratio basado en cambios únicos
  const totalUnique = oldSet.size + newSet.size;
  const changes = added.length + removed.length;
  
  // Normalizar entre 0 y 1
  return Math.min(1, changes / Math.max(totalUnique, 1));
}

/**
 * Genera un diff textual simple entre dos textos
 * @param {string} oldText - Texto anterior
 * @param {string} newText - Texto nuevo
 * @returns {string} - Diff textual
 */
function generateTextDiff(oldText, newText) {
  const oldNormalized = normalizeText(oldText);
  const newNormalized = normalizeText(newText);
  
  if (oldNormalized === newNormalized) {
    return 'No changes detected';
  }
  
  // Diff simple: mostrar líneas añadidas y eliminadas
  const oldLines = oldNormalized.split(/\n/).filter(l => l.trim());
  const newLines = newNormalized.split(/\n/).filter(l => l.trim());
  
  let diff = `=== DIFF GENERATED AT ${new Date().toISOString()} ===\n\n`;
  diff += `OLD TEXT LENGTH: ${oldNormalized.length} chars\n`;
  diff += `NEW TEXT LENGTH: ${newNormalized.length} chars\n`;
  diff += `CHANGE RATIO: ${calculateChangeRatio(oldText, newText).toFixed(4)}\n\n`;
  
  // Mostrar primeras diferencias significativas
  const maxDiffLines = 50;
  let diffLines = 0;
  
  diff += '--- REMOVED LINES ---\n';
  for (const line of oldLines) {
    if (!newLines.includes(line) && diffLines < maxDiffLines) {
      diff += `- ${line}\n`;
      diffLines++;
    }
  }
  
  diffLines = 0;
  diff += '\n+++ ADDED LINES +++\n';
  for (const line of newLines) {
    if (!oldLines.includes(line) && diffLines < maxDiffLines) {
      diff += `+ ${line}\n`;
      diffLines++;
    }
  }
  
  return diff;
}

/**
 * Encuentra keywords en el texto (similar a analyzeContent pero más simple)
 * @param {string} text - Texto a analizar
 * @param {Array<string>} keywords - Keywords a buscar
 * @returns {Array<string>} - Keywords encontradas
 */
function findKeywordsInText(text, keywords) {
  if (!keywords || keywords.length === 0) {
    return [];
  }
  
  const normalizedText = text.toLowerCase();
  const found = new Set();
  
  for (const keyword of keywords) {
    const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (regex.test(normalizedText)) {
      found.add(keyword.toLowerCase());
    }
  }
  
  return Array.from(found);
}

/**
 * Detecta cambios en el texto de una URL comparando con el snapshot anterior
 * @param {string} url - URL procesada
 * @param {string} slug - Slug de la URL
 * @param {string} currentText - Texto actual extraído
 * @returns {Promise<Object>} - Objeto con información del cambio
 */
async function detectChange(url, slug, currentText) {
  const currentHash = calculateTextHash(currentText);
  const currentNormalized = normalizeText(currentText);
  
  // Buscar último evento en histórico
  const lastEvent = await HistoryLogger.getLastEventForUrl(url);
  
  // Si no hay histórico previo, es la primera vez
  if (!lastEvent || !lastEvent.textHash) {
    // Detectar keywords en el texto inicial
    let keywordsInChanges = [];
    try {
      const allKeywords = await loadKeywords();
      keywordsInChanges = findKeywordsInText(currentText, allKeywords);
    } catch (error) {
      console.warn('⚠️  Error al cargar keywords:', error.message);
    }
    
    return {
      hasChanged: false,
      changeRatio: 0,
      textHash: currentHash,
      textLength: currentNormalized.length,
      isFirstRun: true,
      keywordsInChanges: keywordsInChanges
    };
  }
  
  // Comparar hashes
  const hashChanged = lastEvent.textHash !== currentHash;
  
  if (!hashChanged) {
    // Aunque no haya cambios, detectar keywords en el texto actual
    let keywordsInChanges = [];
    try {
      const allKeywords = await loadKeywords();
      keywordsInChanges = findKeywordsInText(currentText, allKeywords);
    } catch (error) {
      console.warn('⚠️  Error al cargar keywords:', error.message);
    }
    
    return {
      hasChanged: false,
      changeRatio: 0,
      textHash: currentHash,
      textLength: currentNormalized.length,
      isFirstRun: false,
      keywordsInChanges: keywordsInChanges
    };
  }
  
  // Intentar leer texto anterior del snapshot si existe
  let oldText = '';
  try {
    const oldTextPath = path.join(TEXT_DIR, `${slug}.txt`);
    oldText = await fs.readFile(oldTextPath, 'utf-8');
  } catch {
    // No existe snapshot anterior, usar aproximación basada en longitud
    // Si la longitud cambió significativamente, asumimos cambio
    const lengthDiff = Math.abs(currentNormalized.length - (lastEvent.textLength || 0));
    const avgLength = (currentNormalized.length + (lastEvent.textLength || 1)) / 2;
    const estimatedRatio = avgLength > 0 ? Math.min(1, lengthDiff / avgLength) : 0.5;
    
    // Detectar keywords aunque no tengamos el texto anterior completo
    let keywordsInChanges = [];
    try {
      const allKeywords = await loadKeywords();
      keywordsInChanges = findKeywordsInText(currentText, allKeywords);
    } catch (error) {
      console.warn('⚠️  Error al cargar keywords:', error.message);
    }
    
    return {
      hasChanged: true,
      changeRatio: estimatedRatio,
      textHash: currentHash,
      textLength: currentNormalized.length,
      isFirstRun: false,
      keywordsInChanges: keywordsInChanges
    };
  }
  
  // Hay cambio, calcular ratio usando texto anterior real
  const changeRatio = calculateChangeRatio(oldText, currentText);
  
  // Detectar keywords en el texto nuevo (solo en los cambios)
  let keywordsInChanges = [];
  try {
    const allKeywords = await loadKeywords();
    // Extraer solo el texto que cambió (diferencia aproximada)
    // Por simplicidad, analizamos el texto completo actual
    keywordsInChanges = findKeywordsInText(currentText, allKeywords);
  } catch (error) {
    console.warn('⚠️  Error al cargar keywords para detectar cambios:', error.message);
  }
  
  // Generar diff si hay cambio significativo
  if (changeRatio > 0.01) { // Solo generar diff si cambio > 1%
    const diff = generateTextDiff(oldText, currentText);
    const diffPath = path.join(DIFFS_DIR, `${slug}.diff.txt`);
    await fs.mkdir(DIFFS_DIR, { recursive: true });
    await fs.writeFile(diffPath, diff, 'utf-8');
  }
  
  return {
    hasChanged: true,
    changeRatio: changeRatio,
    textHash: currentHash,
    textLength: currentNormalized.length,
    isFirstRun: false,
    keywordsInChanges: keywordsInChanges // Keywords encontradas en el texto actual
  };
}

module.exports = {
  normalizeText,
  calculateTextHash,
  calculateChangeRatio,
  generateTextDiff,
  detectChange
};
