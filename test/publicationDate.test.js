const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractPublicationDate } = require('../scripts/publicationDate');

const NOW = new Date('2026-11-13T15:00:00.000Z');

test('lee una fecha de publicación en español dentro del texto nuevo', () => {
  const date = extractPublicationDate('La convocatoria se publicó el 10 de noviembre de 2026.', NOW);
  assert.equal(date, '2026-11-10');
});

test('lee November 2, 2026 y se queda con la fecha más reciente', () => {
  const date = extractPublicationDate('Posted November 2, 2026. Actualizado el 2026-11-09.', NOW);
  assert.equal(date, '2026-11-09');
});

test('un deadline futuro no cuenta como día de publicación', () => {
  assert.equal(extractPublicationDate('Deadline 2026-12-01.', NOW), null);
});

test('una fecha de más de 18 meses no cuenta', () => {
  assert.equal(extractPublicationDate('Archivo del 2019-01-15 y también 15/01/2019.', NOW), null);
});

test('descarta días imposibles', () => {
  assert.equal(extractPublicationDate('Fecha rota 2026-02-31 y 31/02/2026.', NOW), null);
});
