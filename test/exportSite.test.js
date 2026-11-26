const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { exportSite, toStaticIndex } = require('../scripts/exportSite');

test('la home estática pide los JSON en vez de las rutas de Express', () => {
  const html = toStaticIndex(`
    <a href="/api/status">/api/status</a>
    <a href="/api/urls">/api/urls</a>
    <a href="/api/alerts">/api/alerts</a>
    <a href="/api/errors">/api/errors</a>
    <a href="/api/runs">/api/runs</a>
    <a href="/api/history?limit=20">/api/history</a>
    <a href="/health">/health</a>
    fetch('/api/status')
    fetch('/api/urls')
  `);
  assert.match(html, /href="api\/status\.json"/);
  assert.match(html, /href="api\/urls\.json"/);
  assert.match(html, /href="api\/alerts\.json"/);
  assert.match(html, /href="api\/errors\.json"/);
  assert.match(html, /href="api\/runs\.json"/);
  assert.match(html, /href="api\/history\.json"/);
  assert.match(html, /href="health\.json"/);
  assert.match(html, /fetch\('api\/status\.json'\)/);
  assert.match(html, /fetch\('api\/urls\.json'\)/);
  assert.doesNotMatch(html, /fetch\('\/api\//);
});

test('exporta el sitio vacío sin inventar un status', async () => {
  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'rfp-site-')), 'site');
  const { written } = await exportSite({ dest });
  assert.equal(written.includes('api/status.json'), false);
  assert.equal(written.includes('health.json'), true);
  assert.equal(written.includes('api/urls.json'), true);
  const index = await fs.readFile(path.join(dest, 'index.html'), 'utf-8');
  assert.match(index, /fetch\('api\/status\.json'\)/);
  assert.equal(await fs.readFile(path.join(dest, 'CNAME'), 'utf-8'), 'rfp.sociopublico.com\n');
  const urls = JSON.parse(await fs.readFile(path.join(dest, 'api', 'urls.json'), 'utf-8'));
  assert.deepEqual(urls, { total: 0, urls: [] });
  await fs.access(path.join(dest, '.nojekyll'));
});
