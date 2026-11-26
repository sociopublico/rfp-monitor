const fs = require('fs').promises;
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DEST = path.join(ROOT, 'site');
const INDEX_HTML = path.join(ROOT, 'public', 'index.html');
const CNAME = 'rfp.sociopublico.com';

const ENDPOINTS = [
  ['/api/status', 'api/status.json'],
  ['/api/urls', 'api/urls.json'],
  ['/api/alerts', 'api/alerts.json'],
  ['/api/errors', 'api/errors.json'],
  ['/api/runs', 'api/runs.json'],
  ['/api/history?limit=20', 'api/history.json'],
  ['/health', 'health.json']
];

/**
 * La home del servidor pide las rutas de Express. En Pages el mismo JSON
 * vive en un archivo, con caminos relativos para que sirvan en el dominio
 * propio y en la URL del repo.
 */
function toStaticIndex(html) {
  return html
    .replaceAll("fetch('/api/status')", "fetch('api/status.json')")
    .replaceAll("fetch('/api/urls')", "fetch('api/urls.json')")
    .replaceAll('href="/api/status"', 'href="api/status.json"')
    .replaceAll('href="/api/urls"', 'href="api/urls.json"')
    .replaceAll('href="/api/alerts"', 'href="api/alerts.json"')
    .replaceAll('href="/api/errors"', 'href="api/errors.json"')
    .replaceAll('href="/api/runs"', 'href="api/runs.json"')
    .replaceAll('href="/api/history?limit=20"', 'href="api/history.json"')
    .replaceAll('href="/health"', 'href="health.json"');
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

function fetchPath(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path: urlPath
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf-8')
        });
      });
    });
    req.on('error', reject);
  });
}

/**
 * Arma site/ con la home y los JSON que hoy sirve Express.
 * Un 404 (todavía no hay corrida) no escribe ese archivo: la página
 * ya sabe mostrar el estado vacío.
 */
async function exportSite({ dest = DEFAULT_DEST } = {}) {
  const app = require('../api/server');
  const server = await listen(app);
  const port = server.address().port;
  const staging = path.join(dest, '..', `.site-export-${process.pid}`);

  try {
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(path.join(staging, 'api'), { recursive: true });

    const written = [];
    for (const [urlPath, file] of ENDPOINTS) {
      const response = await fetchPath(port, urlPath);
      if (response.status !== 200) {
        console.log(`Sin ${file}: HTTP ${response.status}`);
        continue;
      }
      const parsed = JSON.parse(response.body);
      await fs.writeFile(
        path.join(staging, file),
        JSON.stringify(parsed, null, 2) + '\n',
        'utf-8'
      );
      written.push(file);
    }

    const html = await fs.readFile(INDEX_HTML, 'utf-8');
    await fs.writeFile(path.join(staging, 'index.html'), toStaticIndex(html), 'utf-8');
    await fs.writeFile(path.join(staging, 'CNAME'), CNAME + '\n', 'utf-8');
    await fs.writeFile(path.join(staging, '.nojekyll'), '', 'utf-8');

    await fs.rm(dest, { recursive: true, force: true });
    await fs.rename(staging, dest);
    console.log(`Sitio estático en ${dest}: ${written.join(', ')}`);
    return { dest, written };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

if (require.main === module) {
  exportSite().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { exportSite, toStaticIndex };
