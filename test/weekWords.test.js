const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rankWeekWords, tokensFromKeywords } = require('../scripts/weekWords');

test('el peso cuenta RFPs, no repeticiones, y saca jerga y conectores', () => {
  const texts = [
    'The governance climate request for proposals and housing housing housing',
    'Governance y la housing convocatoria'
  ];
  const ranked = rankWeekWords(texts, {
    extraStopwords: tokensFromKeywords(['request for proposals', 'convocatoria', 'rfp'])
  });
  assert.deepEqual(ranked[0], { palabra: 'governance', peso: 2 });
  assert.deepEqual(ranked[1], { palabra: 'housing', peso: 2 });
  assert.equal(ranked.some((item) => item.palabra === 'request'), false);
  assert.equal(ranked.some((item) => item.palabra === 'proposals'), false);
  assert.equal(ranked.some((item) => item.palabra === 'convocatoria'), false);
  assert.equal(ranked.some((item) => item.palabra === 'the'), false);
  assert.equal(ranked.some((item) => item.palabra === 'housing' && item.peso === 3), false);
});

test('devuelve como máximo 15 palabras', () => {
  const words = Array.from({ length: 20 }, (_, index) => `palabra${String.fromCharCode(97 + index)}`);
  const ranked = rankWeekWords([words.join(' ')], { extraStopwords: [] });
  assert.equal(ranked.length, 15);
});
