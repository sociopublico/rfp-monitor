const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { inspect } = require('util');

const RUNS_DIR = path.join(__dirname, '..', 'data', 'runs');
const LOGS_DIR = path.join(__dirname, '..', 'data', 'logs');
const RUNS_INDEX = path.join(RUNS_DIR, 'index.jsonl');

function runIdFromDate(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function formatArgs(args) {
  return args
    .map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 4, breakLength: 120 })))
    .join(' ');
}

/**
 * Guarda stdout/stderr de una corrida en data/logs y un resumen JSON en data/runs.
 */
function startRunLog() {
  const startedAt = new Date();
  const runId = runIdFromDate(startedAt);
  const lines = [];
  const originals = {
    log: console.log,
    error: console.error,
    warn: console.warn
  };

  const capture = (level, fn) => (...args) => {
    const stamp = new Date().toISOString();
    lines.push(`${stamp} [${level}] ${formatArgs(args)}`);
    fn.apply(console, args);
  };

  console.log = capture('INFO', originals.log);
  console.error = capture('ERROR', originals.error);
  console.warn = capture('WARN', originals.warn);

  return {
    runId,
    startedAt: startedAt.toISOString(),
    async finish(summary = {}) {
      console.log = originals.log;
      console.error = originals.error;
      console.warn = originals.warn;

      await fsp.mkdir(LOGS_DIR, { recursive: true });
      await fsp.mkdir(RUNS_DIR, { recursive: true });

      const logRel = path.join('logs', `${runId}.log`);
      const jsonRel = path.join('runs', `${runId}.json`);
      const logPath = path.join(__dirname, '..', 'data', logRel);
      const jsonPath = path.join(__dirname, '..', 'data', jsonRel);

      const record = {
        runId,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        logFile: logRel,
        ...summary
      };

      await fsp.writeFile(logPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8');
      await fsp.writeFile(jsonPath, JSON.stringify(record, null, 2), 'utf-8');
      await fsp.appendFile(RUNS_INDEX, JSON.stringify({
        runId,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        totalUrls: record.totalUrls || 0,
        successCount: record.successCount || 0,
        errorCount: record.errorCount || 0,
        changedCount: record.changedCount || 0,
        alertsCount: record.alertsCount || 0,
        firstRunCount: record.firstRunCount || 0,
        logFile: logRel,
        summaryFile: jsonRel
      }) + '\n', 'utf-8');

      originals.log(`📝 Log de corrida: data/${logRel}`);
      originals.log(`📦 Resumen de corrida: data/${jsonRel}`);
      return record;
    }
  };
}

function readRunsIndexSync() {
  try {
    const content = fs.readFileSync(RUNS_INDEX, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = {
  startRunLog,
  runIdFromDate,
  RUNS_DIR,
  LOGS_DIR,
  RUNS_INDEX,
  readRunsIndexSync
};
