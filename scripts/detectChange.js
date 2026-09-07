const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const HistoryLogger = require('./historyLogger');
const { loadKeywords } = require('./loadKeywords');

const DIFFS_DIR = path.join(__dirname, '..', 'data', 'diffs');
const TEXT_DIR = path.join(__dirname, '..', 'data', 'snapshots', 'text');
const CHANGES_DIR = path.join(__dirname, '..', 'data', 'changes');

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
 * Calcula el ratio de cambio entre dos textos (sensible a orden)
 * usando prefijo/sufijo común sobre caracteres.
 * @param {string} oldText - Texto anterior
 * @param {string} newText - Texto nuevo
 * @returns {Object} - { ratio, changedChars, addedText, removedText }
 */
function calculateChangeRatio(oldText, newText) {
  const oldNormalized = normalizeText(oldText);
  const newNormalized = normalizeText(newText);
  
  if (!oldNormalized && !newNormalized) {
    return { ratio: 0, changedChars: 0, addedText: '', removedText: '' };
  }
  
  if (!oldNormalized) {
    return { ratio: 1, changedChars: newNormalized.length, addedText: newNormalized, removedText: '' };
  }
  
  if (!newNormalized) {
    return { ratio: 1, changedChars: oldNormalized.length, addedText: '', removedText: oldNormalized };
  }
  
  // Si son iguales, no hay cambios
  if (oldNormalized === newNormalized) {
    return { ratio: 0, changedChars: 0, addedText: '', removedText: '' };
  }
  
  // Longest common prefix
  let prefixLen = 0;
  const minLen = Math.min(oldNormalized.length, newNormalized.length);
  while (prefixLen < minLen && oldNormalized[prefixLen] === newNormalized[prefixLen]) {
    prefixLen++;
  }
  
  // Longest common suffix (sin superponer con el prefijo)
  let suffixLen = 0;
  const oldRemaining = oldNormalized.length - prefixLen;
  const newRemaining = newNormalized.length - prefixLen;
  const maxSuffix = Math.min(oldRemaining, newRemaining);
  
  while (
    suffixLen < maxSuffix &&
    oldNormalized[oldNormalized.length - 1 - suffixLen] === newNormalized[newNormalized.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }
  
  const oldChangedStart = prefixLen;
  const oldChangedEnd = oldNormalized.length - suffixLen;
  const newChangedStart = prefixLen;
  const newChangedEnd = newNormalized.length - suffixLen;
  
  const removedText = oldNormalized.slice(oldChangedStart, oldChangedEnd);
  const addedText = newNormalized.slice(newChangedStart, newChangedEnd);
  
  // Calcular caracteres cambiados
  const addedChars = addedText.length;
  const removedChars = removedText.length;
  const changedChars = addedChars + removedChars;
  
  // Ratio basado en caracteres cambiados vs total
  const totalChars = Math.max(oldNormalized.length, newNormalized.length, 1);
  const ratio = totalChars > 0 ? Math.min(1, changedChars / totalChars) : 0;
  
  return { ratio, changedChars, addedText, removedText };
}

/**
 * Genera un diff textual simple entre dos textos
 * @param {string} oldText - Texto anterior
 * @param {string} newText - Texto nuevo
 * @param {Object} changeInfo - Info del cambio calculado
 * @returns {string} - Diff textual
 */
function generateTextDiff(oldText, newText, changeInfo = null) {
  const oldNormalized = normalizeText(oldText);
  const newNormalized = normalizeText(newText);
  
  if (oldNormalized === newNormalized) {
    return 'No changes detected';
  }
  
  // Calcular info de cambio si no se proporciona
  const info = changeInfo || calculateChangeRatio(oldText, newText);
  
  let diff = `=== DIFF GENERATED AT ${new Date().toISOString()} ===\n\n`;
  diff += `OLD TEXT LENGTH: ${oldNormalized.length} chars\n`;
  diff += `NEW TEXT LENGTH: ${newNormalized.length} chars\n`;
  diff += `CHANGED CHARS: ${info.changedChars}\n`;
  diff += `CHANGE RATIO: ${(info.ratio * 100).toFixed(2)}%\n\n`;
  
  // Mostrar texto removido
  diff += '--- REMOVED TEXT ---\n';
  if (info.removedText && info.removedText.length > 0) {
    // Limitar a 5000 chars para no hacer archivos gigantes
    const removedPreview = info.removedText.substring(0, 5000);
    diff += removedPreview;
    if (info.removedText.length > 5000) {
      diff += `\n... (${info.removedText.length - 5000} chars más)`;
    }
  } else {
    diff += '(ninguno)';
  }
  
  diff += '\n\n+++ ADDED TEXT +++\n';
  if (info.addedText && info.addedText.length > 0) {
    const addedPreview = info.addedText.substring(0, 5000);
    diff += addedPreview;
    if (info.addedText.length > 5000) {
      diff += `\n... (${info.addedText.length - 5000} chars más)`;
    }
  } else {
    diff += '(ninguno)';
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
 * IMPORTANTE: Busca keywords SOLO en el texto que cambió (addedText)
 * @param {string} url - URL procesada
 * @param {string} slug - Slug de la URL
 * @param {string} currentText - Texto actual extraído
 * @returns {Promise<Object>} - Objeto con información del cambio
 */
async function detectChange(url, slug, currentText) {
  const currentHash = calculateTextHash(currentText);
  const currentNormalized = normalizeText(currentText);
  
  // Baseline = último scrape EXITOSO (con textHash). Un error reciente no cuenta
  // como "primera ejecución": si Chromium se cae al final de una corrida, las
  // URLs que ya se venían monitoreando tienen que compararse contra el éxito anterior.
  const lastEvent = await HistoryLogger.getLastBaselineEventForUrl(url);

  let snapshotText = '';
  try {
    snapshotText = await fs.readFile(path.join(TEXT_DIR, `${slug}.txt`), 'utf-8');
  } catch {
    snapshotText = '';
  }

  const hasHistoryBaseline = Boolean(lastEvent && lastEvent.textHash);
  const hasSnapshotBaseline = Boolean(snapshotText);

  // Si no hay histórico previo NI snapshot, es la primera vez
  // En primera ejecución, consideramos TODO el texto como "cambio" para análisis de keywords
  if (!hasHistoryBaseline && !hasSnapshotBaseline) {
    let keywordsInChanges = [];
    try {
      const allKeywords = await loadKeywords();
      // En primera ejecución, buscar keywords en TODO el texto
      keywordsInChanges = findKeywordsInText(currentText, allKeywords);
      console.log(`🔍 Primera ejecución - Keywords en texto completo: ${keywordsInChanges.length}`);
    } catch (error) {
      console.warn('⚠️  Error al cargar keywords:', error.message);
    }
    
    // Guardar el texto completo como "cambios" para primera ejecución
    await saveChangedText(slug, currentNormalized, true);
    
    return {
      hasChanged: false,
      changeRatio: 0,
      changedChars: 0,
      textHash: currentHash,
      textLength: currentNormalized.length,
      isFirstRun: true,
      keywordsInChanges: keywordsInChanges,
      addedText: currentNormalized // Todo el texto es "nuevo"
    };
  }
  
  const previousHash = lastEvent?.textHash || (snapshotText ? calculateTextHash(snapshotText) : null);
  const hashChanged = !previousHash || previousHash !== currentHash;

  if (!hashChanged) {
    return {
      hasChanged: false,
      changeRatio: 0,
      changedChars: 0,
      textHash: currentHash,
      textLength: currentNormalized.length,
      isFirstRun: false,
      keywordsInChanges: [],
      addedText: ''
    };
  }

  const oldText = snapshotText;
  if (!oldText) {
    const previousLength = lastEvent?.textLength || 0;
    const lengthDiff = Math.abs(currentNormalized.length - previousLength);
    const avgLength = (currentNormalized.length + (previousLength || 1)) / 2;
    const estimatedRatio = avgLength > 0 ? Math.min(1, lengthDiff / avgLength) : 0.5;
    
    // Sin texto anterior, analizar todo el texto actual
    let keywordsInChanges = [];
    try {
      const allKeywords = await loadKeywords();
      keywordsInChanges = findKeywordsInText(currentText, allKeywords);
    } catch (error) {
      console.warn('⚠️  Error al cargar keywords:', error.message);
    }
    
    await saveChangedText(slug, currentNormalized, false);
    
    return {
      hasChanged: true,
      changeRatio: estimatedRatio,
      changedChars: lengthDiff,
      textHash: currentHash,
      textLength: currentNormalized.length,
      isFirstRun: false,
      keywordsInChanges: keywordsInChanges,
      addedText: currentNormalized
    };
  }
  
  // Hay cambio, calcular ratio y extraer texto cambiado
  const changeInfo = calculateChangeRatio(oldText, currentText);
  
  // IMPORTANTE: Buscar keywords SOLO en el texto añadido (cambios)
  let keywordsInChanges = [];
  try {
    const allKeywords = await loadKeywords();
    if (changeInfo.addedText && changeInfo.addedText.length > 0) {
      keywordsInChanges = findKeywordsInText(changeInfo.addedText, allKeywords);
      console.log(`🔍 Keywords en texto cambiado (${changeInfo.addedText.length} chars): ${keywordsInChanges.length}`);
      if (keywordsInChanges.length > 0) {
        console.log(`   Keywords encontradas: ${keywordsInChanges.slice(0, 5).join(', ')}${keywordsInChanges.length > 5 ? '...' : ''}`);
      }
    }
  } catch (error) {
    console.warn('⚠️  Error al cargar keywords para detectar cambios:', error.message);
  }
  
  // Guardar texto cambiado para revisión
  if (changeInfo.addedText && changeInfo.addedText.length > 0) {
    await saveChangedText(slug, changeInfo.addedText, false);
  }
  
  // Generar diff si hay cambio
  if (changeInfo.ratio > 0 || changeInfo.changedChars > 0) {
    const diff = generateTextDiff(oldText, currentText, changeInfo);
    const diffPath = path.join(DIFFS_DIR, `${slug}.diff.txt`);
    await fs.mkdir(DIFFS_DIR, { recursive: true });
    await fs.writeFile(diffPath, diff, 'utf-8');
  }
  
  return {
    hasChanged: true,
    changeRatio: changeInfo.ratio,
    changedChars: changeInfo.changedChars,
    textHash: currentHash,
    textLength: currentNormalized.length,
    isFirstRun: false,
    keywordsInChanges: keywordsInChanges,
    addedText: changeInfo.addedText || ''
  };
}

/**
 * Guarda el texto cambiado para revisión posterior
 * @param {string} slug - Slug de la URL
 * @param {string} changedText - Texto que cambió
 * @param {boolean} isFirstRun - Si es primera ejecución
 */
async function saveChangedText(slug, changedText, isFirstRun) {
  try {
    await fs.mkdir(CHANGES_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = isFirstRun ? `${slug}_initial.txt` : `${slug}_${timestamp}.txt`;
    const filePath = path.join(CHANGES_DIR, filename);
    
    let content = `=== ${isFirstRun ? 'INITIAL CONTENT' : 'CHANGED TEXT'} ===\n`;
    content += `Timestamp: ${new Date().toISOString()}\n`;
    content += `Length: ${changedText.length} characters\n`;
    content += `===\n\n`;
    content += changedText;
    
    await fs.writeFile(filePath, content, 'utf-8');
    
    // También guardar siempre la versión "latest" para fácil acceso
    const latestPath = path.join(CHANGES_DIR, `${slug}_latest.txt`);
    await fs.writeFile(latestPath, content, 'utf-8');
  } catch (error) {
    console.warn('⚠️  Error al guardar texto cambiado:', error.message);
  }
}

module.exports = {
  normalizeText,
  calculateTextHash,
  calculateChangeRatio,
  generateTextDiff,
  detectChange,
  saveChangedText
};
