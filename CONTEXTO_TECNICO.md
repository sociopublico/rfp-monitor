# Contexto para empezar — RFP Monitor

Documento de onboarding. Si es la primera vez que tocás este repo (humano o agente), leé esto antes de cambiar código.

## En una frase

Job de scraping + API de lectura que vigila páginas de convocatorias y marca cuándo el **texto nuevo** parece un RFP alineado a sociopúblico.

No es un dashboard. No es n8n (el `package.json` se llama `n8n-proposals` por historia). No muta el spreadsheet desde Node: el Sheet tira de la API.

## Piezas que existen

```
Google Sheet (URLs + keywords)
        │ CSV público
        ▼
scripts/run.js          ← pipeline de scraping (cron / a mano)
        │ escribe
        ▼
data/                   ← fuente de verdad local (gitignore)
        │ lee
        ▼
api/server.js           ← Express, puerto 3000, solo GET
        │
        ├─ Traefik → https://rfp.sociopublico.com
        └─ google-apps-script.gs → columnas Status / Keywords del Sheet
```

Dos procesos distintos:

| Proceso | Entrada | Comando | Persistencia |
| --- | --- | --- | --- |
| Scraper | CSV de URLs | `npm run scrape` | escribe `data/` |
| API | `data/` | `npm start` | no escribe nada |

Docker Compose solo levanta la API. El scraper hay que ejecutarlo aparte (`docker exec rfp-monitor node scripts/run.js` o un cron en el host).

## Flujo de una corrida

`scripts/run.js` es el orquestador. Por cada URL filtrada:

1. `readCsv.js` — baja el Sheet, deja filas con `Tiene sitio RFPs` ∈ {SI, OTRO} y `Link` http(s).
2. `fetchSite.js` — una sola instancia de Chromium para toda la corrida. Reintentos: `networkidle2` → `domcontentloaded` → `load`. Bloquea image/font/media. Maneja `detached Frame`.
3. `utils.extractVisibleText` — Cheerio, sin `script/style/nav/header/footer`.
4. `detectChange.js` — **antes** de sobrescribir el snapshot. Hash SHA-256 del texto normalizado. Si cambió, recorta el bloque añadido (prefijo/sufijo común) y busca keywords **solo ahí**.
5. `analyzeContent.js` — keywords + fechas futuras sobre el texto completo (heurística; el comentario de “LLM futuro” sigue vigente).
6. `score.js` — score final. Lo que manda es `keywordsInChanges`.
7. `historyLogger.js` — append a `data/history/url-history.jsonl`.
8. `alertManager.js` — JSON en `data/alerts/` si `finalScore >= minFinalScore`.
9. Recién ahora se pisan `snapshots/html` y `snapshots/text`.
10. Pausa de **10 segundos** antes de la siguiente URL.
11. `updateStatus.js` — `data/status/latest.json`.

Errores por URL no abortan la corrida. Se loguean con `errorType` (`timeout`, `ssl`, `dns`, `connection`, `browser`, `frame_detached`, `unknown`) y la API los expone en `/api/errors`.

## Mapa de archivos

```
api/server.js              Express. Endpoints listados en el README.
config/profile.js          Umbrales y keywords de fallback.
scripts/run.js             Orquestador.
scripts/readCsv.js         URLs desde Sheets (gid=0). URL hardcodeada.
scripts/loadKeywords.js    Keywords desde Sheets (gid=1294632680, columna `word`). Cache 1h.
scripts/fetchSite.js       Puppeteer / Chromium.
scripts/utils.js           slug, extractVisibleText, metadata.json.
scripts/detectChange.js    hash, ratio, diffs, `data/changes/`.
scripts/analyzeContent.js  relevancia heurística del texto completo.
scripts/score.js           changeScore + keywordScore + finalScore + alerta.
scripts/historyLogger.js   JSONL append-only + getLastEventForUrl.
scripts/alertManager.js    escribe alertas.
scripts/updateStatus.js    latest.json.
google-apps-script.gs      se pega a mano en el Sheet; pega Status/Keywords.
Dockerfile                 node:20-alpine + chromium del sistema. CMD = API.
docker-compose.yml         Traefik + volumen data + shm 2gb.
```

No hay tests. No hay scheduler. No hay `.env`: las URLs del Sheet están en el código.

## Scoring (el código, no los comentarios viejos)

`config/profile.js` manda. Hoy `minFinalScore = 20`. El fallback dentro de `shouldGenerateAlert` es 30 si no hay config; en la práctica siempre hay config.

`calculateFinalScore(changeScore, relevanceScore, hasChanged, keywordsInChangesCount, isFirstRun)`:

- `keywordsInChangesCount >= 2` → `max(70, 0.6·keyword + 0.2·change + 0.2·relevance)`
- `== 1` → `max(50, 0.5·keyword + 0.25·change + 0.25·relevance)`
- primera corrida y `relevanceScore > 30` → `0.8 · relevanceScore`
- sin cambio → `0.3 · relevanceScore`
- cambio sin keywords en el diff → promedio 50/50 de change y relevance

`calculateChangeScore` es generoso (cualquier cambio > 0 ya da 30). `calculateKeywordScore`: 1→40, 2→70, 3+→100.

Labels que arma `/api/urls` (eso es lo que ve el equipo en el Sheet). `primera ejecución` solo si **no hay un scrape exitoso anterior** (un error reciente no cuenta):

| Condición | `status` |
| --- | --- |
| error de scrape | `error` |
| `isFirstRun` + 2+ keywords | `primera ejecución - relevante` |
| `isFirstRun` + 1 keyword | `primera ejecución - posible` |
| `isFirstRun` | `primera ejecución` |
| sin cambio / 0 chars | `sin cambios` |
| 2+ keywords en cambios o score ≥ 70 | `cambios relevantes` |
| 1 keyword o score ≥ 50 | `cambios - posiblemente relevante` |
| `changeRatio >= 0.05` | `cambios - revisar` |
| el resto | `cambios irrelevantes` |

Si tocás scoring, actualizá esta tabla y el README. El Sheet no tiene lógica propia: solo muestra lo que devuelve la API.

## Contratos que no conviene romper

- **`GET /api/urls`** — lo consume Apps Script. Campos usados: `url`, `status`, `keywords` (array). Normaliza URLs (lowercase, sin trailing slash).
- **Columnas del CSV de URLs**: `Tiene sitio RFPs`, `Link`.
- **Columna del CSV de keywords**: `word`.
- **Slug** — `generateSlug` en `utils.js` y `slugFromUrl` en `api/server.js` tienen que seguir la misma regla, si no `/api/changes` y `/api/text` no encuentran archivos.
- **Histórico append-only** — nunca reescribir `url-history.jsonl`. `detectChange` usa el último evento **con textHash** (`getLastBaselineEventForUrl`), no el último evento a secas.
- **Detectar cambios antes de escribir snapshots** — si invertís el orden, el “texto anterior” es el actual y el ratio queda en 0.
- Un `frame_detached` tiene que recrear la page de Puppeteer; si no, las URLs que siguen en la corrida fallan todas.

## Cómo trabajar

```bash
npm ci
npm start                 # terminal 1, API
npm run scrape            # terminal 2, una corrida
curl localhost:3000/health
curl localhost:3000/api/urls
```

Chromium en local: Puppeteer descarga el suyo. En Docker/Alpine hay que usar `/usr/bin/chromium-browser` (`PUPPETEER_EXECUTABLE_PATH`).

Para una URL puntual, el camino de debug es:

1. `/api/errors?url=…` o la línea en el JSONL
2. `data/snapshots/text/{slug}.txt`
3. `data/diffs/{slug}.diff.txt` y `data/changes/{slug}_latest.txt`
4. keywords del Sheet vs `config/profile.js`

Logs del scraper van a stdout con prefijos (`📥`, `🔄`, `🎯`, `❌`). No hay logger estructurado.

## Decisiones ya tomadas (no reabrirlas de onda)

- Heurística de keywords, no embeddings ni LLM (está preparado el hueco en `analyzeContent.js`).
- Una page de Puppeteer reutilizada, no un browser por URL.
- Pausa fija de 10s entre sitios.
- `--single-process` en Docker, con retry sin ese flag si Chromium no arranca.
- Certificados inválidos se ignoran (`ignoreHTTPSErrors`, `--ignore-certificate-errors`).
- Imagen de prod: `registry.sociopublico.com/rfp-monitor`. Host: `rfp.sociopublico.com`.

## Huecos conocidos

- Análisis “semántico” = regex de keywords + fechas `YYYY-MM-DD` / `DD/MM/YYYY` / `Month YYYY`.
- No hay notificaciones cuando se genera una alerta; solo el archivo y lo que el Sheet muestre después.
- `readCsv.js` y `loadKeywords.js` duplican el downloader HTTP.
- `package.json` name `n8n-proposals` no coincide con el repo `rfp-monitor`.
- `page.waitForTimeout` en `fetchSite.js` está deprecado en Puppeteer reciente; si se actualiza el paquete, puede romper.
- Primera ejecución: `hasChanged = false` a propósito (no hay baseline). Las keywords se buscan en el texto completo.
- `data/` no viaja en git ni en la imagen (`.dockerignore` excluye snapshots/diffs). En un contenedor nuevo, sin volumen, la API arranca vacía.

## Próximos pasos razonables (si alguien pregunta)

1. LLM real (o clasificador) en `analyzeContent.js`, usando el texto de `data/changes/` no la página entera.
2. Webhook/Slack cuando `generateAlert` corre.
3. Cron documentado o un sidecar, para no depender de un `docker exec` manual.
4. Extraer las URLs de Sheets a env vars.
5. Tests de `calculateChangeRatio`, `calculateFinalScore` y el mapeo de status de `/api/urls`.
