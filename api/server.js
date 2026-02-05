const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Rutas de datos
const DATA_DIR = path.join(__dirname, '..', 'data');
const STATUS_FILE = path.join(DATA_DIR, 'status', 'latest.json');
const ALERTS_DIR = path.join(DATA_DIR, 'alerts');
const DIFFS_DIR = path.join(DATA_DIR, 'diffs');
const CHANGES_DIR = path.join(DATA_DIR, 'changes');
const TEXT_DIR = path.join(DATA_DIR, 'snapshots', 'text');
const HISTORY_FILE = path.join(DATA_DIR, 'history', 'url-history.jsonl');

/**
 * Genera slug desde URL (misma lógica que scripts/utils.js)
 */
function slugFromUrl(url) {
  try {
    const urlObj = new URL(url);
    let slug = urlObj.hostname.replace(/^www\./, '');
    if (urlObj.pathname && urlObj.pathname !== '/') {
      slug += urlObj.pathname.replace(/\/$/, '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);
    }
    return slug.replace(/_+/g, '_').replace(/^_|_$/g, '') || 'index';
  } catch {
    return url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50).replace(/^_|_$/g, '') || 'unknown';
  }
}

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

/**
 * Get latest status
 */
app.get('/api/status', async (req, res) => {
  try {
    const content = await fs.readFile(STATUS_FILE, 'utf-8');
    const status = JSON.parse(content);
    res.json(status);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.status(404).json({
        error: 'Status file not found',
        message: 'The status file does not exist yet. Run the scraper first.'
      });
    } else {
      console.error('Error reading status file:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to read status file'
      });
    }
  }
});

/**
 * Get all alerts (sorted by date desc)
 */
app.get('/api/alerts', async (req, res) => {
  try {
    const files = await fs.readdir(ALERTS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    if (jsonFiles.length === 0) {
      return res.json([]);
    }
    
    const alerts = await Promise.all(
      jsonFiles.map(async (file) => {
        try {
          const content = await fs.readFile(
            path.join(ALERTS_DIR, file),
            'utf-8'
          );
          return JSON.parse(content);
        } catch (error) {
          console.error(`Error reading alert file ${file}:`, error);
          return null;
        }
      })
    );
    
    // Filtrar nulls y ordenar por timestamp desc
    const validAlerts = alerts
      .filter(a => a !== null)
      .sort((a, b) => {
        const dateA = new Date(a.timestamp || 0);
        const dateB = new Date(b.timestamp || 0);
        return dateB - dateA; // Descendente
      });
    
    res.json(validAlerts);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.json([]);
    } else {
      console.error('Error reading alerts:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to read alerts directory'
      });
    }
  }
});

/**
 * Get latest alert
 */
app.get('/api/alerts/latest', async (req, res) => {
  try {
    const files = await fs.readdir(ALERTS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    if (jsonFiles.length === 0) {
      return res.status(204).send();
    }
    
    // Ordenar archivos por nombre (que incluye timestamp)
    const sortedFiles = jsonFiles.sort().reverse();
    
    // Leer el más reciente
    const latestFile = sortedFiles[0];
    const content = await fs.readFile(
      path.join(ALERTS_DIR, latestFile),
      'utf-8'
    );
    const alert = JSON.parse(content);
    
    res.json(alert);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.status(204).send();
    } else {
      console.error('Error reading latest alert:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to read latest alert'
      });
    }
  }
});

/**
 * Get history with optional filters
 */
app.get('/api/history', async (req, res) => {
  try {
    const { url, limit } = req.query;
    
    // Leer archivo JSONL
    const content = await fs.readFile(HISTORY_FILE, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    // Parsear cada línea
    let events = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (error) {
        console.error('Error parsing JSONL line:', error);
        return null;
      }
    }).filter(e => e !== null);
    
    // Filtrar por URL si se especifica
    if (url) {
      events = events.filter(e => e.url === url);
    }
    
    // Ordenar por timestamp desc (más reciente primero)
    events.sort((a, b) => {
      const dateA = new Date(a.timestamp || 0);
      const dateB = new Date(b.timestamp || 0);
      return dateB - dateA;
    });
    
    // Aplicar límite si se especifica
    if (limit) {
      const limitNum = parseInt(limit, 10);
      if (!isNaN(limitNum) && limitNum > 0) {
        events = events.slice(0, limitNum);
      }
    }
    
    res.json({
      total: events.length,
      events: events
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.json({
        total: 0,
        events: []
      });
    } else {
      console.error('Error reading history:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to read history file'
      });
    }
  }
});

/**
 * Get summary for URLs (last scraping info)
 * Query params: url (optional) - filter by specific URL
 */
app.get('/api/urls', async (req, res) => {
  try {
    const { url: filterUrl } = req.query;
    
    // Leer histórico
    const content = await fs.readFile(HISTORY_FILE, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    // Parsear eventos
    const events = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    }).filter(e => e !== null);
    
    // Agrupar por URL y obtener el último evento de cada una
    const urlMap = new Map();
    
    for (const event of events) {
      if (filterUrl && event.url !== filterUrl) {
        continue;
      }
      
      if (!urlMap.has(event.url)) {
        urlMap.set(event.url, event);
      } else {
        const existing = urlMap.get(event.url);
        const existingDate = new Date(existing.timestamp || 0);
        const eventDate = new Date(event.timestamp || 0);
        if (eventDate > existingDate) {
          urlMap.set(event.url, event);
        }
      }
    }
    
    // Convertir a array y construir respuesta
    const results = Array.from(urlMap.values()).map(event => {
      // Usar changedChars del evento si existe, si no calcularlo
      const textLength = event.textLength || 0;
      const changeRatio = event.changeRatio || 0;
      const changedChars = event.changedChars !== undefined 
        ? event.changedChars 
        : Math.round(textLength * changeRatio);
      const finalScore = event.finalScore || 0;
      const keywordsInChanges = event.keywordsInChanges || [];
      
      // Determinar status basado en keywords en cambios (lo más importante)
      let status = 'error';
      if (event.status === 'success') {
        if (event.isFirstRun) {
          // Primera ejecución: si hay keywords, es relevante
          if (keywordsInChanges.length >= 2) {
            status = 'primera ejecución - relevante';
          } else if (keywordsInChanges.length === 1) {
            status = 'primera ejecución - posible';
          } else {
            status = 'primera ejecución';
          }
        } else if (!event.hasChanged || changedChars === 0) {
          status = 'sin cambios';
        } else {
          // LÓGICA BASADA EN KEYWORDS EN CAMBIOS
          // 2+ keywords en cambios = relevante
          // 1 keyword en cambios = posiblemente relevante
          // 0 keywords pero cambió mucho = revisar
          if (keywordsInChanges.length >= 2 || finalScore >= 70) {
            status = 'cambios relevantes';
          } else if (keywordsInChanges.length === 1 || finalScore >= 50) {
            status = 'cambios - posiblemente relevante';
          } else if (changeRatio >= 0.05) {
            status = 'cambios - revisar';
          } else {
            status = 'cambios irrelevantes';
          }
        }
      }
      
      return {
        url: event.url,
        status: status,
        textLength: textLength,
        changedChars: changedChars,
        changeRatio: changeRatio,
        keywords: keywordsInChanges,  // Solo keywords EN los cambios
        keywordsTotal: event.foundKeywords?.length || 0,  // Keywords en texto completo
        lastScraped: event.timestamp,
        finalScore: finalScore
      };
    });
    
    // Ordenar por URL
    results.sort((a, b) => a.url.localeCompare(b.url));
    
    // Si se filtró por URL específica, devolver solo ese objeto
    if (filterUrl && results.length === 1) {
      res.json(results[0]);
    } else if (filterUrl && results.length === 0) {
      res.status(404).json({
        error: 'URL not found',
        message: `No se encontró información para la URL: ${filterUrl}`
      });
    } else {
      res.json({
        total: results.length,
        urls: results
      });
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.json({
        total: 0,
        urls: []
      });
    } else {
      console.error('Error reading URLs summary:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to read URLs summary'
      });
    }
  }
});

/**
 * Get the diff text of the last detected changes for a URL
 * Query params: url (required) - the page URL
 * Returns the content of data/diffs/{slug}.diff.txt
 */
app.get('/api/changes', async (req, res) => {
  try {
    const { url: targetUrl } = req.query;

    if (!targetUrl || typeof targetUrl !== 'string' || targetUrl.trim() === '') {
      return res.status(400).json({
        error: 'Missing parameter',
        message: 'Query parameter "url" is required. Example: /api/changes?url=https://example.com/page'
      });
    }

    const slug = slugFromUrl(targetUrl.trim());
    const diffPath = path.join(DIFFS_DIR, `${slug}.diff.txt`);

    const content = await fs.readFile(diffPath, 'utf-8');

    const accept = (req.headers.accept || '').toLowerCase();
    if (accept.includes('text/plain')) {
      res.type('text/plain').send(content);
    } else {
      res.json({
        url: targetUrl.trim(),
        slug,
        diff: content
      });
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        error: 'Diff not found',
        message: 'No hay diff guardado para esta URL. Solo existe cuando hubo cambios detectados.'
      });
    }
    console.error('Error reading diff:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to read diff file'
    });
  }
});

/**
 * Get the full text content of the last scrape for a URL
 * Query params: url (required) - the page URL
 * Returns the content of data/snapshots/text/{slug}.txt
 */
app.get('/api/text', async (req, res) => {
  try {
    const { url: targetUrl } = req.query;

    if (!targetUrl || typeof targetUrl !== 'string' || targetUrl.trim() === '') {
      return res.status(400).json({
        error: 'Missing parameter',
        message: 'Query parameter "url" is required. Example: /api/text?url=https://example.com/page'
      });
    }

    const slug = slugFromUrl(targetUrl.trim());
    const textPath = path.join(TEXT_DIR, `${slug}.txt`);

    const content = await fs.readFile(textPath, 'utf-8');

    const accept = (req.headers.accept || '').toLowerCase();
    if (accept.includes('text/plain')) {
      res.type('text/plain').send(content);
    } else {
      res.json({
        url: targetUrl.trim(),
        slug,
        textLength: content.length,
        text: content
      });
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        error: 'Text not found',
        message: 'No hay texto guardado para esta URL. La página aún no ha sido scrapeada.'
      });
    }
    console.error('Error reading text:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to read text file'
    });
  }
});

/**
 * Get the changed text (latest) for a URL
 * Query params: url (required) - the page URL
 * Returns the content of data/changes/{slug}_latest.txt
 */
app.get('/api/changed-text', async (req, res) => {
  try {
    const { url: targetUrl } = req.query;

    if (!targetUrl || typeof targetUrl !== 'string' || targetUrl.trim() === '') {
      return res.status(400).json({
        error: 'Missing parameter',
        message: 'Query parameter "url" is required. Example: /api/changed-text?url=https://example.com/page'
      });
    }

    const slug = slugFromUrl(targetUrl.trim());
    const changesPath = path.join(CHANGES_DIR, `${slug}_latest.txt`);

    const content = await fs.readFile(changesPath, 'utf-8');

    const accept = (req.headers.accept || '').toLowerCase();
    if (accept.includes('text/plain')) {
      res.type('text/plain').send(content);
    } else {
      res.json({
        url: targetUrl.trim(),
        slug,
        textLength: content.length,
        changedText: content
      });
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        error: 'Changed text not found',
        message: 'No hay texto de cambios guardado para esta URL.'
      });
    }
    console.error('Error reading changed text:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to read changed text file'
    });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 RFP Monitor API server running on port ${PORT}`);
  console.log(`📁 Data directory: ${DATA_DIR}`);
});

module.exports = app;
