const fs = require('fs').promises;
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'history', 'url-history.jsonl');

/**
 * Logger para registrar histórico de ejecuciones en formato JSONL
 * Cada línea es un objeto JSON independiente (append-only)
 */
class HistoryLogger {
  /**
   * Asegura que el archivo de histórico existe
   */
  static async ensureHistoryFile() {
    try {
      await fs.access(HISTORY_FILE);
    } catch {
      // Archivo no existe, se creará al escribir
      const dir = path.dirname(HISTORY_FILE);
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Registra un evento en el histórico
   * @param {Object} event - Objeto con los datos del evento
   * @param {string} event.url - URL procesada
   * @param {string} event.timestamp - Timestamp ISO
   * @param {string} event.status - "success" | "error"
   * @param {number} [event.httpStatus] - Código HTTP si existe
   * @param {string} [event.errorMessage] - Mensaje de error si falla
   * @param {string} [event.textHash] - Hash del texto normalizado
   * @param {number} [event.textLength] - Longitud del texto
   * @param {boolean} [event.hasChanged] - Si hubo cambio respecto al anterior
   * @param {number} [event.changeRatio] - Ratio de cambio (0-1)
   * @param {number} [event.keywordHits] - Cantidad de hits de keywords RFP
   * @param {number} [event.finalScore] - Score final calculado
   */
  static async logEvent(event) {
    await this.ensureHistoryFile();
    
    // Validar campos requeridos
    if (!event.url || !event.timestamp || !event.status) {
      throw new Error('Evento debe tener url, timestamp y status');
    }

    // Construir objeto de evento con campos opcionales
    const logEntry = {
      url: event.url,
      timestamp: event.timestamp,
      status: event.status,
      ...(event.httpStatus !== undefined && { httpStatus: event.httpStatus }),
      ...(event.errorType && { errorType: event.errorType }),
      ...(event.errorMessage && { errorMessage: event.errorMessage }),
      ...(event.textHash && { textHash: event.textHash }),
      ...(event.textLength !== undefined && { textLength: event.textLength }),
      ...(event.hasChanged !== undefined && { hasChanged: event.hasChanged }),
      ...(event.isFirstRun !== undefined && { isFirstRun: event.isFirstRun }),
      ...(event.changeRatio !== undefined && { changeRatio: event.changeRatio }),
      ...(event.changedChars !== undefined && { changedChars: event.changedChars }),
      ...(event.keywordHits !== undefined && { keywordHits: event.keywordHits }),
      ...(event.foundKeywords && Array.isArray(event.foundKeywords) && { foundKeywords: event.foundKeywords }),
      ...(event.keywordsInChanges && Array.isArray(event.keywordsInChanges) && { keywordsInChanges: event.keywordsInChanges }),
      ...(event.finalScore !== undefined && { finalScore: event.finalScore })
    };

    // Escribir como JSONL (una línea JSON por evento)
    const line = JSON.stringify(logEntry) + '\n';
    await fs.appendFile(HISTORY_FILE, line, 'utf-8');
  }

  /**
   * Lee el histórico completo (útil para análisis)
   * @returns {Promise<Array>} - Array de eventos históricos
   */
  static async readHistory() {
    try {
      const content = await fs.readFile(HISTORY_FILE, 'utf-8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  /**
   * Obtiene el último evento para una URL específica
   * @param {string} url - URL a buscar
   * @returns {Promise<Object|null>} - Último evento o null si no existe
   */
  static async getLastEventForUrl(url) {
    const history = await this.readHistory();
    const urlEvents = history
      .filter(event => event.url === url)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    return urlEvents.length > 0 ? urlEvents[0] : null;
  }
}

module.exports = HistoryLogger;
