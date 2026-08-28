const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const HistoryLogger = require('../scripts/historyLogger');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfp-history-'));
const historyFile = path.join(tmpDir, 'url-history.jsonl');

before(() => {
  HistoryLogger.configure({ historyFile });
});

after(() => {
  HistoryLogger.configure({ historyFile: null });
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('getLastBaselineEventForUrl saltea errores sin hash', async () => {
  await HistoryLogger.logEvent({
    url: 'https://example.org/rfp',
    timestamp: '2026-06-01T00:00:00.000Z',
    status: 'success',
    textHash: 'hash-junio',
    isFirstRun: false
  });
  await HistoryLogger.logEvent({
    url: 'https://example.org/rfp',
    timestamp: '2026-08-17T00:00:00.000Z',
    status: 'error',
    errorType: 'frame_detached',
    errorMessage: 'Attempted to use detached Frame'
  });

  const lastAny = await HistoryLogger.getLastEventForUrl('https://example.org/rfp');
  const baseline = await HistoryLogger.getLastBaselineEventForUrl('https://example.org/rfp');

  assert.equal(lastAny.status, 'error');
  assert.equal(baseline.status, 'success');
  assert.equal(baseline.textHash, 'hash-junio');
});
