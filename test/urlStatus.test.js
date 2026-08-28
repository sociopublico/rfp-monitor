const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyUrlStatus,
  lastBaselineEventForUrl,
  countBaselinesForUrl,
  parseJsonl
} = require('../scripts/urlStatus');

test('un error reciente no pisa el baseline anterior', () => {
  const events = [
    { url: 'https://www.newamerica.org/careers/', timestamp: '2026-06-01T01:00:00.000Z', status: 'success', textHash: 'aaa', isFirstRun: true },
    { url: 'https://www.newamerica.org/careers/', timestamp: '2026-07-13T01:00:00.000Z', status: 'success', textHash: 'bbb', isFirstRun: false },
    { url: 'https://www.newamerica.org/careers/', timestamp: '2026-08-17T02:25:19.890Z', status: 'error', errorType: 'frame_detached' }
  ];

  const baseline = lastBaselineEventForUrl(events, 'https://www.newamerica.org/careers/');
  assert.equal(baseline.textHash, 'bbb');
  assert.equal(baseline.status, 'success');
  assert.equal(countBaselinesForUrl(events, 'https://www.newamerica.org/careers/'), 2);
});

test('JSONL con una línea rota no tira todo el histórico', () => {
  const events = parseJsonl('{"url":"https://a.example","textHash":"x"}\nNOT JSON\n{"url":"https://b.example","textHash":"y"}\n');
  assert.equal(events.length, 2);
  assert.equal(events[1].url, 'https://b.example');
});

test('Loli case: isFirstRun mal marcado no se muestra si ya había baseline', () => {
  const latest = {
    status: 'success',
    isFirstRun: true,
    hasChanged: false,
    changedChars: 0,
    keywordsInChanges: ['careers', 'deadline']
  };
  assert.equal(classifyUrlStatus(latest, { hadPriorBaseline: false }), 'primera ejecución - relevante');
  assert.equal(classifyUrlStatus(latest, { hadPriorBaseline: true }), 'sin cambios');
});

test('cambios relevantes siguen mandando si no es primera ejecución', () => {
  const event = {
    status: 'success',
    isFirstRun: false,
    hasChanged: true,
    changeRatio: 0.1,
    changedChars: 400,
    finalScore: 80,
    keywordsInChanges: ['rfp', 'deadline']
  };
  assert.equal(classifyUrlStatus(event), 'cambios relevantes');
});
