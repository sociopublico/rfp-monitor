const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Rutas de datos
const DATA_DIR = path.join(__dirname, '..', 'data');
const STATUS_FILE = path.join(DATA_DIR, 'status', 'latest.json');
const ALERTS_DIR = path.join(DATA_DIR, 'alerts');
const HISTORY_FILE = path.join(DATA_DIR, 'history', 'url-history.jsonl');

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
