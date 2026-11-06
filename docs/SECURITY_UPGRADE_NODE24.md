# Upgrade de seguridad — Node.js 24 LTS

Documento de auditoría (Fase 1), cambios aplicados (Fase 2), validación (Fase 3) y despliegue manual (Fase 4).

**No se modifica el servidor de producción, bases de datos, secrets ni contenedores existentes sin aprobación explícita.**

---

## Fase 1 — Hallazgos de auditoría

### Estado previo

| Componente | Valor anterior | Riesgo |
| --- | --- | --- |
| Imagen base | `node:20-alpine` | Node.js 20 está **EOL** (sin parches de seguridad) |
| Express (lock) | `4.22.1` (`^4.18.2`) | Dependencias transitivas con CVEs (`qs`, `proxy-addr`, `body-parser`, `path-to-regexp`) |
| Puppeteer (lock) | `24.35.0` | CVEs en `@puppeteer/browsers`, `extract-zip`, `chromium-bidi`/`zod`, `ws`, `undici` |
| Cheerio / csv-parser | `1.1.2` / `3.2.0` | Sin CVE críticos; fuera de última patch |
| `npm audit` | **16** (2 critical, 12 high, 2 moderate) | Ver detalle abajo |
| Usuario del contenedor | **root** | Privilegio innecesario |
| Compose | Sin `cap_drop` / `no-new-privileges` / `read_only` | Superficie de ataque ampliada |
| Puertos | No publica `ports:` (solo Traefik) | OK |
| Volumen | `./data:/app/data` | OK y necesario; único mount de host |
| Cron / scheduler | **No hay** en el repo | El scrape se dispara fuera (cron host / `docker exec`) — sin cambios de comportamiento |
| Env vars | `PORT`, `NODE_ENV`, `PUPPETEER_*` | Sin `.env` en imagen; URLs del Sheet hardcodeadas |
| Compatibilidad Node 24 | Código CommonJS, sin APIs removidas críticas | Compatible; Puppeteer 25 exige `node >= 22.12` |

### Vulnerabilidades detectadas (`npm audit` pre-upgrade)

- **critical:** `proxy-addr` (IP spoofing), `basic-ftp` (path traversal vía cadena Puppeteer)
- **high:** `extract-zip`, `path-to-regexp`, `undici`, `ws`, `zod` / `chromium-bidi`, cadenas Puppeteer
- **moderate:** `qs` (vía Express), `body-parser` (agrupado), etc.

### Compatibilidad Puppeteer / Chromium

- En Docker se usa Chromium del sistema Alpine (`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`), no el Chrome embebido.
- `page.waitForTimeout(1200)` en `scripts/fetchSite.js` **ya no existe** en Puppeteer moderno → rompería al subir a 25.x.
- Flags actuales (`--no-sandbox`, `--disable-dev-shm-usage`, `--single-process` con fallback) se mantienen; `shm_size: 2gb` se conserva.

### Problemas de seguridad Docker (pre)

1. Proceso como root.
2. Sin `no-new-privileges` ni `cap_drop`.
3. Filesystem del contenedor escribible.
4. `freetype-dev` en la imagen (paquete de desarrollo innecesario en runtime).
5. `version:` obsoleto en Compose v2 (cosmético).

### Cambios propuestos (y aplicados en Fase 2)

1. Base `node:24-alpine` (tag LTS Krypton; soporte hasta abril 2028).
2. Dependencias: Express 4.22.3, Puppeteer 25.16.0, Cheerio 1.2.0, csv-parser 3.2.1.
3. Reemplazar `waitForTimeout` por `node:timers/promises`.
4. `USER node`, `cap_drop: ALL`, `no-new-privileges`, `read_only` + `tmpfs /tmp`.
5. Documentar build/deploy/rollback **sin** desplegar a DigitalOcean.

---

## Fase 2 — Versiones exactas instaladas

| Paquete | Versión exacta (lock) |
| --- | --- |
| `express` | `4.22.3` |
| `puppeteer` | `25.16.0` |
| `cheerio` | `1.2.0` |
| `csv-parser` | `3.2.1` |
| Node (imagen) | `node:24-alpine` (LTS Krypton) |
| Chromium | paquete `chromium` de Alpine en la imagen |

`engines.node` en `package.json`: `>=24`.

Lógica de monitoreo, scoring, endpoints y scheduling externo: **sin cambios de comportamiento**.

---

## Fase 3 — Validación (local / staging)

Comandos:

```bash
npm ci
npm test
npm audit
docker build -t rfp-monitor:node24 .
# Red de Traefik no requerida para smoke local:
docker network create traefik-public 2>/dev/null || true
mkdir -p data
docker run --rm -d --name rfp-monitor-test \
  --user 1000:1000 \
  --read-only \
  --tmpfs /tmp:size=256m,mode=1777 \
  --shm-size=2g \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  -v "$(pwd)/data:/app/data" \
  -p 3000:3000 \
  rfp-monitor:node24

curl -sS http://127.0.0.1:3000/health
# Verificar Chromium:
docker exec rfp-monitor-test node -e "const {createBrowser,closeBrowser}=require('./scripts/fetchSite'); (async()=>{const {browser}=await createBrowser(); console.log('browser OK'); await closeBrowser(browser);})().catch(e=>{console.error(e); process.exit(1);})"
# Smoke del pipeline (una corrida; requiere red a Sheets + sitios):
docker exec rfp-monitor-test node scripts/run.js
docker stop rfp-monitor-test
```

### Resultados de validación (ambiente de agente, 2026-11-06 12:29 America/Buenos_Aires)

| Check | Resultado |
| --- | --- |
| `npm audit` (host + imagen) | **0 vulnerabilities** |
| `npm test` | 6/6 pass |
| `docker build -t rfp-monitor:node24-test` | OK (`node:24-alpine` → Node **v24.22.2**) |
| Chromium Alpine | `/usr/bin/chromium-browser` → Chromium **156.0.8078.79** |
| Launch Puppeteer (non-root, `read_only`, `cap_drop ALL`) | OK; navegó a example.com |
| `GET /health` | `{"status":"ok"}` |
| Flujo monitoreo (fetch → extract → detectChange x2) | Primera corrida baseline; segunda detectó cambio + keywords `rfp`, `deadline` |
| Entry scrape / cron | Sin cambios: `node scripts/run.js` / `docker exec rfp-monitor node scripts/run.js` |

**No se desplegó a DigitalOcean.**

---

## Fase 4 — Despliegue manual (DigitalOcean) — requiere aprobación

### Archivos cambiados

- `Dockerfile`
- `docker-compose.yml`
- `package.json` / `package-lock.json`
- `scripts/fetchSite.js` (delay compatible)
- `README.md`, `CONTEXTO_TECNICO.md`
- `docs/SECURITY_UPGRADE_NODE24.md` (este archivo)

### Build y push

```bash
# En máquina de CI o local con acceso al registry
docker build -t registry.sociopublico.com/rfp-monitor:node24 .
docker tag registry.sociopublico.com/rfp-monitor:node24 registry.sociopublico.com/rfp-monitor:latest
docker push registry.sociopublico.com/rfp-monitor:node24
docker push registry.sociopublico.com/rfp-monitor:latest
```

### Deploy en el droplet (solo con aprobación)

```bash
ssh <user>@<droplet>
cd /traefik/rfp   # o la ruta real del compose
# Backup del volumen de datos (recomendado)
tar -czf ~/rfp-data-backup-$(date +%Y%m%d%H%M).tgz data
docker compose pull
docker compose up -d
docker compose ps
curl -sS https://rfp.sociopublico.com/health
# Verificar scrape (cron host sin cambios de comando):
docker exec rfp-monitor node scripts/run.js
```

### Cambios manuales en el servidor

1. Asegurar que el directorio `./data` sea escribible por uid/gid **1000** (usuario `node` de la imagen):
   ```bash
   sudo chown -R 1000:1000 ./data
   ```
2. Confirmar que el cron/job existente sigue siendo:
   `docker exec rfp-monitor node scripts/run.js`
3. Confirmar red externa `traefik-public` y labels Traefik (sin cambios de host).
4. **No** hace falta tocar secrets/DB (este servicio no usa DB ni secrets montados).

### Rollback

```bash
# Etiquetar/pull de la imagen anterior (guardar digest antes del deploy)
docker pull registry.sociopublico.com/rfp-monitor:<digest-or-tag-previo>
# O restaurar desde backup local de imagen:
# docker load < rfp-monitor-pre-node24.tar
cd /traefik/rfp
# Si se versiona el compose, checkout del commit anterior
git checkout <commit-previo> -- Dockerfile docker-compose.yml package.json package-lock.json scripts/fetchSite.js
docker compose up -d --build
# Restaurar data solo si hubo corrupción (raro):
# tar -xzf ~/rfp-data-backup-....tgz
```

Guardar el digest de la imagen en producción **antes** del pull:

```bash
docker image inspect registry.sociopublico.com/rfp-monitor:latest --format '{{index .RepoDigests 0}}'
```

---

## Notas

- Node 24 está en Maintenance LTS (Krypton) hasta **2028-04-30**. El tag Docker `lts` puede apuntar a otra major; por eso se fija `node:24-alpine`.
- Se permanece en **Express 4.x** a propósito (evitar breaking de Express 5).
- `--no-sandbox` sigue siendo necesario en este contenedor hardening; el riesgo residual se mitiga con non-root + `cap_drop` + `read_only`.
