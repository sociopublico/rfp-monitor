# RFP Monitor

Sistema de monitoreo de sitios web para detectar **RFPs**, convocatorias y licitaciones relevantes para [sociopúblico](https://github.com/sociopublico).

Lee una lista de URLs desde Google Sheets, scrapea cada página con Chromium, compara el texto contra la corrida anterior y genera alertas cuando el cambio parece una oportunidad (keywords de RFP + temas de interés).

En producción la API vive en `https://rfp.sociopublico.com` detrás de Traefik.

## Qué hace

1. Descarga el CSV publicado del spreadsheet (filas con `Tiene sitio RFPs` = `SI` o `OTRO`).
2. Abre cada URL con Puppeteer, espera a que corra el JS y extrae el texto visible.
3. Compara contra el snapshot anterior (hash SHA-256 + diff de caracteres).
4. Busca keywords **en el texto que cambió**, no en toda la página.
5. Calcula un score y, si supera el umbral, escribe una alerta en disco.
6. Expone esos resultados por una API REST de solo lectura.

El spreadsheet se puede actualizar a mano (menú **RFP Monitor → Actualizar status y keywords**, que lee `GET /api/urls`) o solo, los lunes: GitHub Actions corre el scraper y le manda el resultado al Apps Script.

En `https://rfp.sociopublico.com` hay una página de inicio que explica el flujo y muestra la última corrida.

## Requisitos

- Node.js 20+
- Chromium / Chrome (Puppeteer lo baja solo en local; en Docker se usa el de Alpine)
- Acceso de red a Google Sheets (CSV público) y a los sitios a monitorear

## Arranque local

```bash
npm ci
npm start          # API en http://localhost:3000
npm run scrape     # una corrida del scraper
```

La primera corrida no genera diffs: marca cada URL como primera ejecución y guarda el texto base. Recién la segunda (y siguientes) detectan cambios.

Entre sitio y sitio hay una pausa de 10 segundos para no martillar servidores.

### Verificar que levantó

```bash
curl http://localhost:3000/
curl http://localhost:3000/health
# {"status":"ok"}

curl http://localhost:3000/api/status
curl http://localhost:3000/api/urls
curl http://localhost:3000/api/runs
```

Hasta que no corras el scraper, `/api/status` responde 404 y `/api/urls` un listado vacío. Eso es esperado.

## Docker

La imagen de producción es `registry.sociopublico.com/rfp-monitor`. El contenedor **solo levanta la API**. El scraper de los lunes corre en GitHub Actions, no en este contenedor. Un `docker exec` sigue sirviendo para una corrida manual en el servidor.

```bash
docker compose up -d
```

Notas:

- El volumen `./data` es persistente: snapshots, histórico, diffs y alertas viven ahí.
- `shm_size: 2gb` es necesario para Chromium.
- Traefik espera la red externa `traefik-public` y el host `rfp.sociopublico.com`.
- En la imagen, `PUPPETEER_EXECUTABLE_PATH` apunta a `/usr/bin/chromium-browser`.

Para scrapear dentro del contenedor:

```bash
docker exec rfp-monitor node scripts/run.js
```

## Configuración

Todo el perfil de análisis está en [`config/profile.js`](config/profile.js):

| Clave | Qué controla | Default actual |
| --- | --- | --- |
| `interestKeywords` | Temas de sociopúblico (governance, cities, climate, etc.) | lista local |
| `rfpKeywords` | Señales de convocatoria (`rfp`, `licitación`, `deadline`, …) | lista local |
| `analysisThresholds.minTextChangeRatio` | Cambio mínimo para considerarlo significativo | `0.03` |
| `analysisThresholds.minKeywordHits` | Hits de keywords RFP para marcar oportunidad | `2` |
| `analysisThresholds.minFinalScore` | Score mínimo para escribir una alerta | `20` |
| `settings.detectFutureDates` | Bonus si hay fechas futuras (deadlines) | `true` |

Las keywords que realmente se buscan en los cambios salen del spreadsheet (hoja de `word`), con cache de 1 hora. Si esa descarga falla, se usa el fallback de `config/profile.js`.

## API

Base: `http://localhost:3000` o `https://rfp.sociopublico.com`.

| Método | Ruta | Qué devuelve |
| --- | --- | --- |
| `GET` | `/` | Página de inicio (cómo usar el monitor) |
| `GET` | `/health` | `{ "status": "ok" }` |
| `GET` | `/api/status` | Resumen de la última corrida |
| `GET` | `/api/urls` | Status + keywords por URL (lo que consume el Sheet) |
| `GET` | `/api/urls?url=` | Lo mismo, una sola URL |
| `GET` | `/api/alerts` | Alertas, más reciente primero |
| `GET` | `/api/alerts/latest` | Última alerta (`204` si no hay) |
| `GET` | `/api/history?url=&limit=` | Eventos del JSONL |
| `GET` | `/api/errors?url=&limit=` | Errores recientes (timeout, SSL, DNS, …) |
| `GET` | `/api/runs` | Historial de corridas |
| `GET` | `/api/runs/latest` | Detalle de la última corrida (con cada URL) |
| `GET` | `/api/changes?url=` | Diff de la última detección |
| `GET` | `/api/text?url=` | Texto visible del último scrape |
| `GET` | `/api/changed-text?url=` | Solo el texto añadido |

`/api/changes`, `/api/text` y `/api/changed-text` aceptan `Accept: text/plain` para devolver el archivo crudo.

### Status que ve el spreadsheet

Valores de `status` en `/api/urls`:

- `primera ejecución` / `primera ejecución - posible` / `primera ejecución - relevante`
- `sin cambios`
- `cambios relevantes` — 2+ keywords en el diff, o score ≥ 70
- `cambios - posiblemente relevante` — 1 keyword, o score ≥ 50
- `cambios - revisar` — cambió ≥ 5% sin keywords claras
- `cambios irrelevantes`
- `error`

## Datos en disco

`data/` se crea sola en la primera corrida. En git entra solo lo que la corrida siguiente necesita para comparar, y el HTML no:

- `data/snapshots/text/` y `data/snapshots/metadata.json`
- `data/history/url-history.jsonl`
- `data/status/latest.json`

El HTML, los diffs, los cambios crudos, las alertas y los logs siguen afuera.

```
data/
  snapshots/html/{slug}.html      HTML renderizado
  snapshots/text/{slug}.txt       texto visible
  snapshots/metadata.json         metadatos por URL
  history/url-history.jsonl       un evento por línea (append-only)
  logs/{runId}.log                stdout de cada corrida
  runs/index.jsonl                índice de corridas
  runs/{runId}.json               resumen + URLs de esa corrida
  diffs/{slug}.diff.txt           último diff
  changes/{slug}_latest.txt       texto añadido (y copias timestamped)
  alerts/{timestamp}-{slug}.json  alertas
  status/latest.json              resumen de la última corrida
```

El slug se arma con hostname + path (`utils.generateSlug`).

## Google Sheets y Apps Script

Hay dos pestañas publicadas como CSV:

- **URLs** (`gid=0`): columnas `Tiene sitio RFPs` y `Link`.
- **Keywords** (`gid=1294632680`): columna `word`.

La hoja de trabajo es **Sitios RFPs**. Columnas que usa el sistema: `Tiene sitio RFPs`, `Link`, `status`, `keywords`. El resto (`Comentarios Loli`, etc.) es de las personas.

Para instalar/actualizar el script:

1. Spreadsheet → Extensiones → Apps Script.
2. Pegá [`google-apps-script.gs`](google-apps-script.gs) y autorizá una vez.
3. En la hoja aparece el menú **RFP Monitor → Actualizar status y keywords**.
4. Un `onOpen` simple de Google **no puede** llamar a la API. Si querés que se actualice al abrir, creá un activador instalable sobre `updateStatusAndKeywords`.
5. Para el lunes automático: en el proyecto de Apps Script, propiedad `SHEETS_WEBHOOK_TOKEN` (un secreto largo). Implementar → Aplicación web → ejecutar como vos, acceso cualquiera, y copiá la URL que termina en `/exec`.
6. En el repo, secrets `SHEETS_WEBHOOK_URL` (esa URL) y `SHEETS_WEBHOOK_TOKEN` (el mismo valor). Sin esos secrets la corrida igual sube el reporte a git y no toca el Sheet.

El script siempre escribe en `Sitios RFPs`, aunque estés parado en Keywords o en Propuestas (esas pestañas también tienen columna Link). El POST del lunes, además, llena la hoja **Semana** y las columnas `aparecio entre` y `fecha en la pagina`. El menú manual no las borra.

## Corrida de los lunes

[`.github/workflows/scrape-monday.yml`](.github/workflows/scrape-monday.yml) corre en un runner de GitHub, no en tu computadora y no en `rfp.sociopublico.com`. El cron es lunes 14:00 UTC, que son las 11:00 en Argentina. También se puede disparar a mano desde la pestaña Actions. Recién corre solo cuando este workflow está en `main`.

Cada corrida:

1. Baja el CSV público, abre las ~170 URLs con Chrome y compara contra el texto de la corrida anterior.
2. Commitea el texto nuevo, el historial y `reports/YYYY-MM-DD.json`.
3. Si están los secrets, hace POST al Apps Script. Eso actualiza `status` y `keywords` de las filas que ya existen. No agrega organizaciones.

`reports/YYYY-MM-DD.json` trae, por URL, `url`, `status` y `keywords`. En los cambios relevantes o posibles de esa semana suma:

- `aparecioEntre`: entre la corrida anterior y esta. No es el día en que el sitio publicó el RFP. Para eso habría que scrapear todos los días, y el cupo gratis de Actions no da.
- `fechaEnLaPagina`: una fecha escrita en el texto nuevo, si hay una que no sea un deadline futuro ni más vieja que 18 meses. Es lo que dice la página, no el día en que la vimos.

`palabras` son las 15 palabras de peso de esos textos nuevos. El peso es en cuántos RFPs de la semana aparece cada una. Quedan afuera artículos, conectores y la jerga del detector (`request`, `proposal`, `rfp`, `licitación`, …). La hoja **Semana** muestra esa lista y los RFPs nuevos.

La primera corrida, si no hay texto previo en el repo, marca todo como primera ejecución y no arma ventana ni palabras. Para no perder la comparación que ya vive en el servidor:

```bash
# en el servidor, desde el directorio del compose
docker cp rfp-monitor:/app/data/snapshots/text ./data/snapshots/text
docker cp rfp-monitor:/app/data/snapshots/metadata.json ./data/snapshots/metadata.json
docker cp rfp-monitor:/app/data/history/url-history.jsonl ./data/history/url-history.jsonl
```

Esos tres archivos se commitean una vez, antes del primer lunes. El HTML no hace falta.

## Primera ejecución “falsa”

Si Chromium se cae a mitad de una corrida (`frame_detached` / execution context destroyed), las URLs que siguen no se pueden scrapear con la misma instancia. El scraper **reinicia Chromium entero** y reintenta esa URL. En el Sheet, un error de scrape **no pisa** el último status útil: se sigue mostrando el último éxito. El fallo queda en `lastErrorAt` / `/api/errors`.

## Cómo se decide si algo importa

El score final **prioriza keywords en el texto añadido**, no el tamaño del cambio:

- 2+ keywords en cambios → mínimo 70
- 1 keyword en cambios → mínimo 50
- primera corrida con relevancia > 30 → 80% del relevance score
- cambio sin keywords → promedio de change score y relevance
- sin cambio → 30% del relevance (tope bajo)

El umbral de alerta es `minFinalScore` (hoy 20). El análisis semántico todavía es heurístico (keywords + fechas); el código está preparado para un LLM, pero no está conectado.

## Dónde mirar cuando algo falla

| Síntoma | Dónde |
| --- | --- |
| La API está viva pero no hay datos | No corrió el scraper, o `data/` no está montada |
| Una URL siempre da error | `GET /api/errors?url=…` — tipos: `timeout`, `ssl`, `dns`, `connection`, `browser`, `frame_detached` |
| “Hay cambio pero no es RFP” | `data/diffs/` y `data/changes/` |
| Keywords de más / de menos | spreadsheet de `word`, o fallback en `config/profile.js` |
| Chromium no arranca en Docker | `shm_size`, `PUPPETEER_EXECUTABLE_PATH`, logs de `createBrowser()` |

Más detalle de arquitectura, scoring y mapa de archivos: [`CONTEXTO_TECNICO.md`](CONTEXTO_TECNICO.md).

## Qué no está hecho

- Integración real con un LLM en `analyzeContent.js`
- Notificaciones (mail, Slack, webhook) cuando sale una alerta
- Dashboard; hoy la UI es el spreadsheet + la API
- El día exacto en que cada sitio publicó un RFP. La corrida semanal solo puede decir entre qué dos lunes apareció el texto, más una fecha si la página la escribe
