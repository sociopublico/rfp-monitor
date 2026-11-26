const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildWeekReport } = require('../scripts/weekReport');

test('un RFP nuevo guarda la ventana, la fecha dicha en la página y las palabras', () => {
  const url = 'https://example.org/rfp';
  const report = buildWeekReport({
    generatedAt: new Date('2026-11-10T15:00:00.000Z'),
    rfpKeywords: ['rfp', 'request for proposal'],
    events: [
      {
        url,
        timestamp: '2026-11-03T14:00:00.000Z',
        status: 'success',
        textHash: 'aaa',
        isFirstRun: true,
        hasChanged: false,
        changedChars: 0,
        keywordsInChanges: []
      },
      {
        url,
        timestamp: '2026-11-10T14:00:00.000Z',
        status: 'success',
        textHash: 'bbb',
        isFirstRun: false,
        hasChanged: true,
        changeRatio: 0.2,
        changedChars: 120,
        finalScore: 80,
        keywordsInChanges: ['climate']
      }
    ],
    runResults: [
      {
        url,
        addedText: 'Nuevo programa de climate publicado el 8 de noviembre de 2026 request',
        previousBaselineAt: '2026-11-03T14:00:00.000Z',
        fechaFetch: '2026-11-10T14:00:00.000Z'
      }
    ]
  });

  assert.equal(report.runDate, '2026-11-10');
  assert.equal(report.urls.length, 1);
  assert.equal(report.urls[0].status, 'cambios relevantes');
  assert.deepEqual(report.urls[0].keywords, ['climate']);
  assert.deepEqual(report.urls[0].aparecioEntre, {
    desde: '2026-11-03T14:00:00.000Z',
    hasta: '2026-11-10T14:00:00.000Z'
  });
  assert.equal(report.urls[0].fechaEnLaPagina, '2026-11-08');
  assert.equal(report.palabras.some((item) => item.palabra === 'climate'), true);
  assert.equal(report.palabras.some((item) => item.palabra === 'request'), false);
});

test('la primera ejecución no se trata como RFP aparecido esta semana', () => {
  const url = 'https://example.org/nuevo';
  const report = buildWeekReport({
    generatedAt: new Date('2026-11-10T15:00:00.000Z'),
    rfpKeywords: ['rfp'],
    events: [
      {
        url,
        timestamp: '2026-11-10T14:00:00.000Z',
        status: 'success',
        textHash: 'aaa',
        isFirstRun: true,
        hasChanged: false,
        changedChars: 0,
        finalScore: 80,
        keywordsInChanges: ['rfp', 'deadline']
      }
    ],
    runResults: [
      {
        url,
        addedText: 'zzquantum rfp deadline en toda la pagina',
        previousBaselineAt: null,
        fechaFetch: '2026-11-10T14:00:00.000Z'
      }
    ]
  });

  assert.equal(report.urls[0].status, 'primera ejecución - relevante');
  assert.equal(report.urls[0].aparecioEntre, undefined);
  assert.equal(report.palabras.some((item) => item.palabra === 'zzquantum'), false);
});

test('las palabras de config/ignoreWords no entran en el ranking', () => {
  const url = 'https://example.org/rfp';
  const report = buildWeekReport({
    generatedAt: new Date('2026-11-10T15:00:00.000Z'),
    rfpKeywords: [],
    ignoreWords: ['climate'],
    events: [
      {
        url,
        timestamp: '2026-11-03T14:00:00.000Z',
        status: 'success',
        textHash: 'aaa',
        isFirstRun: true,
        hasChanged: false,
        changedChars: 0,
        keywordsInChanges: []
      },
      {
        url,
        timestamp: '2026-11-10T14:00:00.000Z',
        status: 'success',
        textHash: 'bbb',
        isFirstRun: false,
        hasChanged: true,
        changeRatio: 0.2,
        changedChars: 80,
        finalScore: 80,
        keywordsInChanges: ['climate', 'governance']
      }
    ],
    runResults: [
      {
        url,
        addedText: 'climate climate governance',
        previousBaselineAt: '2026-11-03T14:00:00.000Z',
        fechaFetch: '2026-11-10T14:00:00.000Z'
      }
    ]
  });

  assert.equal(report.palabras.some((item) => item.palabra === 'climate'), false);
  assert.equal(report.palabras.some((item) => item.palabra === 'governance'), true);
});
