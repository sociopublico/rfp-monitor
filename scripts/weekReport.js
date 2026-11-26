const fs = require('fs').promises;
const path = require('path');
const { extractPublicationDate } = require('./publicationDate');
const { classifyUrlStatus, pickDisplayEvent, parseJsonl } = require('./urlStatus');
const { rankWeekWords, tokensFromKeywords } = require('./weekWords');
const config = require('../config/profile');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');

const NEW_RFP_STATUSES = new Set([
  'cambios relevantes',
  'cambios - posiblemente relevante'
]);

function dateInArgentina(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function summarizeHistory(events) {
  const urlMap = new Map();

  for (const event of events) {
    if (!event || !event.url) {
      continue;
    }
    if (!urlMap.has(event.url)) {
      urlMap.set(event.url, {
        latest: event,
        lastSuccess: event.status === 'success' ? event : null,
        baselineCount: event.textHash ? 1 : 0
      });
      continue;
    }
    const bucket = urlMap.get(event.url);
    const latestDate = new Date(bucket.latest?.timestamp || 0);
    const eventDate = new Date(event.timestamp || 0);
    if (eventDate > latestDate) {
      bucket.latest = event;
    }
    if (event.status === 'success') {
      const successDate = new Date(bucket.lastSuccess?.timestamp || 0);
      if (eventDate > successDate) {
        bucket.lastSuccess = event;
      }
    }
    if (event.textHash) {
      bucket.baselineCount += 1;
    }
  }

  return Array.from(urlMap.entries()).map(([url, bucket]) => {
    const displayEvent = pickDisplayEvent(bucket.latest, bucket.lastSuccess);
    const hadPriorBaseline = bucket.baselineCount > 1;
    return {
      url,
      status: classifyUrlStatus(displayEvent, { hadPriorBaseline }),
      keywords: displayEvent?.keywordsInChanges || []
    };
  }).sort((a, b) => a.url.localeCompare(b.url));
}

/**
 * @param {Object} input
 * @param {Array} input.events Histórico JSONL ya parseado, incluida esta corrida
 * @param {Array} input.runResults Resultados en memoria de esta corrida (traen addedText)
 * @param {Date} [input.generatedAt]
 * @param {string[]} [input.rfpKeywords]
 */
function buildWeekReport({ events, runResults, generatedAt = new Date(), rfpKeywords }) {
  const summaries = summarizeHistory(events);
  const byUrl = new Map((runResults || []).map((result) => [result.url, result]));
  const urls = summaries.map((summary) => {
    const item = {
      url: summary.url,
      status: summary.status,
      keywords: summary.keywords
    };
    if (!NEW_RFP_STATUSES.has(summary.status)) {
      return item;
    }
    const run = byUrl.get(summary.url);
    if (!run) {
      return item;
    }
    if (run.previousBaselineAt && (run.fechaFetch || run.timestamp)) {
      item.aparecioEntre = {
        desde: run.previousBaselineAt,
        hasta: run.fechaFetch || run.timestamp
      };
    }
    const fechaEnLaPagina = extractPublicationDate(run.addedText || '', generatedAt);
    if (fechaEnLaPagina) {
      item.fechaEnLaPagina = fechaEnLaPagina;
    }
    return item;
  });

  const documents = urls
    .filter((item) => NEW_RFP_STATUSES.has(item.status))
    .map((item) => byUrl.get(item.url)?.addedText || '')
    .filter((text) => text.trim().length > 0);

  const palabras = rankWeekWords(documents, {
    extraStopwords: tokensFromKeywords(rfpKeywords || config.rfpKeywords)
  });

  return {
    runDate: dateInArgentina(generatedAt),
    generatedAt: generatedAt.toISOString(),
    urls,
    palabras
  };
}

async function writeWeekReport({ runResults, generatedAt = new Date(), historyFile } = {}) {
  const file = historyFile || path.join(__dirname, '..', 'data', 'history', 'url-history.jsonl');
  let events = [];
  try {
    events = parseJsonl(await fs.readFile(file, 'utf-8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  const report = buildWeekReport({ events, runResults, generatedAt });
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, `${report.runDate}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  return { report, file: reportPath };
}

module.exports = {
  NEW_RFP_STATUSES,
  summarizeHistory,
  buildWeekReport,
  writeWeekReport,
  dateInArgentina
};
