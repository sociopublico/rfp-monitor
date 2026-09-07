const fs = require('fs').promises;
const path = require('path');
const { parseJsonl, lastBaselineEventForUrl } = require('./urlStatus');

const DEFAULT_HISTORY_FILE = path.join(__dirname, '..', 'data', 'history', 'url-history.jsonl');

/**
 * Logger para registrar histórico de ejecuciones en formato JSONL
 * Cada línea es un objeto JSON independiente (append-only)
 */
class HistoryLogger {
  static configure({ historyFile } = {}) {
    this._historyFile = historyFile || null;
    this._cache = null;
  }

  static get historyFile() {
    return this._historyFile || DEFAULT_HISTORY_FILE;
  }

  /**
   * Asegura que el archivo de histórico existe
   */
  static async ensureHistoryFile() {
    try {
      await fs.access(this.historyFile);
    } catch {
      const dir = path.dirname(this.historyFile);
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Registra un evento en el histórico
   */
  static async logEvent(event) {
    await this.ensureHistoryFile();
    
    if (!event.url || !event.timestamp || !event.status) {
      throw new Error('Evento debe tener url, timestamp y status');
    }

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

    const line = JSON.stringify(logEntry) + '\n';
    await fs.appendFile(this.historyFile, line, 'utf-8');
    if (this._cache) {
      this._cache.push(logEntry);
    }
  }

  /**
   * Lee el histórico completo. Líneas rotas se saltean; no se pierde el archivo entero.
   */
  static async readHistory() {
    if (this._cache) {
      return this._cache;
    }
    try {
      const content = await fs.readFile(this.historyFile, 'utf-8');
      this._cache = parseJsonl(content);
      return this._cache;
    } catch {
      this._cache = [];
      return this._cache;
    }
  }

  /**
   * Último evento de una URL, incluyendo errores (sin textHash).
   */
  static async getLastEventForUrl(url) {
    const history = await this.readHistory();
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].url === url) {
        return history[i];
      }
    }
    return null;
  }

  /**
   * Último scrape usable como baseline: tiene textHash.
   * Los errores (timeout, frame detached, etc.) no cuentan.
   */
  static async getLastBaselineEventForUrl(url) {
    const history = await this.readHistory();
    return lastBaselineEventForUrl(history, url);
  }
}

module.exports = HistoryLogger;
