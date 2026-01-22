# Contexto Técnico - Sistema de Monitoreo RFP/Proposals

## Propósito
Sistema Node.js que monitorea sitios web para detectar oportunidades de RFPs (Request for Proposals) y convocatorias relevantes para sociopublico. Detecta cambios en contenido, analiza relevancia semántica y genera alertas.

## Arquitectura

### Componentes Principales

#### 1. **Scraper/Analyzer** (`scripts/run.js`)
- **Orquestador principal**: Ejecuta el pipeline completo
- **Flujo**:
  1. Lee CSV desde Google Sheets (URLs a monitorear)
  2. Filtra URLs válidas (campo "Tiene sitio RFPs" = "SI" o "OTRO")
  3. Para cada URL:
     - Scraping con Puppeteer (HTML renderizado post-JS)
     - Extracción de texto limpio (Cheerio)
     - Detección de cambios vs. ejecución anterior
     - Análisis semántico de relevancia
     - Cálculo de scores
     - Generación de alertas si aplica
     - Registro en histórico

#### 2. **Módulos de Procesamiento**

**`readCsv.js`**: 
- Descarga CSV desde Google Sheets (maneja redirecciones HTTP)
- Filtra filas según criterios (keywords, URLs válidas)

**`fetchSite.js`**: 
- Puppeteer wrapper
- Reutiliza una instancia de browser para todas las URLs
- Timeout: 60s, espera `networkidle2`

**`utils.js`**: 
- `generateSlug()`: Convierte URL a slug seguro
- `extractVisibleText()`: Extrae texto visible (excluye script, style, nav, footer, header)
- `isValidUrl()`: Valida URLs

**`detectChange.js`**: 
- Normaliza texto (lowercase, trim, collapse spaces)
- Calcula hash SHA256 del texto normalizado
- Compara con snapshot anterior (lee histórico JSONL)
- Calcula ratio de cambio (0-1) usando distancia de palabras
- Genera diffs textuales en `data/diffs/{slug}.diff.txt`

**`analyzeContent.js`**: 
- Análisis semántico mock (preparado para LLM futuro)
- Busca keywords RFP y keywords de interés temático
- Detecta fechas futuras (deadlines)
- Retorna: `hasOpportunity`, `relevanceScore` (0-100), `reason`

**`score.js`**: 
- `calculateChangeScore()`: Score basado en ratio de cambio
- `calculateFinalScore()`: Combina changeScore (40%) + relevanceScore (60%)
- `shouldGenerateAlert()`: Evalúa si supera umbral mínimo

**`historyLogger.js`**: 
- Registra eventos en `data/history/url-history.jsonl` (JSON Lines)
- Append-only, nunca sobrescribe
- Cada línea: `{url, timestamp, status, textHash, changeRatio, scores, ...}`

**`alertManager.js`**: 
- Genera archivos JSON en `data/alerts/{timestamp}-{slug}.json`
- Solo si `finalScore >= minFinalScore` (configurable)

**`updateStatus.js`**: 
- Actualiza `data/status/latest.json` con estadísticas de última ejecución

#### 3. **API REST** (`api/server.js`)
- Express.js, solo lectura de archivos (stateless)
- Endpoints:
  - `GET /health`: Health check
  - `GET /api/status`: Lee `data/status/latest.json`
  - `GET /api/alerts`: Lista alertas ordenadas por fecha desc
  - `GET /api/alerts/latest`: Última alerta (204 si no hay)
  - `GET /api/history?url=X&limit=Y`: Histórico con filtros opcionales

#### 4. **Configuración** (`config/profile.js`)
- `interestKeywords`: Array de keywords temáticas
- `rfpKeywords`: Array de keywords específicas de RFPs
- `analysisThresholds`: `minTextChangeRatio`, `minKeywordHits`, `minFinalScore`

## Stack Tecnológico

- **Runtime**: Node.js 20+
- **Dependencias principales**:
  - `puppeteer`: Scraping headless browser
  - `cheerio`: Parsing HTML y extracción de texto
  - `csv-parser`: Parseo de CSV
  - `express`: API REST
- **Docker**: `node:20-alpine`, expone puerto 3000
- **Docker Compose**: Configurado para Traefik (labels, TLS, healthcheck)

## Estructura de Datos

### Archivos Generados

**`data/snapshots/`**:
- `html/{slug}.html`: HTML renderizado completo
- `text/{slug}.txt`: Texto visible extraído
- `metadata.json`: Array de metadatos por URL

**`data/history/url-history.jsonl`**:
- Formato JSON Lines (una línea = un evento)
- Campos: `url`, `timestamp`, `status`, `textHash`, `hasChanged`, `changeRatio`, `keywordHits`, `finalScore`

**`data/alerts/{timestamp}-{slug}.json`**:
- Alertas generadas cuando `finalScore >= minFinalScore`
- Incluye: scores, análisis, cambios, razón

**`data/status/latest.json`**:
- Estadísticas de última ejecución: `lastRun`, `totalUrls`, `successCount`, `errorCount`, `changedCount`, `alertsCount`

**`data/diffs/{slug}.diff.txt`**:
- Diffs textuales cuando hay cambios significativos

## Flujo de Ejecución

```
1. node scripts/run.js
   ↓
2. readCsv.js → Filtra URLs del CSV
   ↓
3. Para cada URL:
   ├─ fetchSite.js → Puppeteer obtiene HTML
   ├─ utils.js → Extrae texto limpio
   ├─ detectChange.js → Compara con histórico
   ├─ analyzeContent.js → Analiza relevancia
   ├─ score.js → Calcula scores
   ├─ historyLogger.js → Registra en JSONL
   ├─ alertManager.js → Genera alerta si aplica
   └─ Guarda snapshots (HTML + texto)
   ↓
4. updateStatus.js → Actualiza latest.json
```

## Características Técnicas

- **Modular**: Cada módulo con responsabilidad única
- **Resiliente**: Errores por URL no abortan corrida completa
- **Incremental**: Histórico append-only, nunca sobrescribe
- **Configurable**: Umbrales y keywords ajustables sin tocar código
- **Stateless API**: Solo lectura, no muta archivos
- **Dockerizado**: Listo para producción con Traefik

## Puntos Clave para Debugging

- **Histórico**: Siempre consultar `url-history.jsonl` para ver evolución
- **Cambios**: Verificar `data/diffs/` para ver qué cambió
- **Alertas**: Revisar `data/alerts/` para oportunidades detectadas
- **Status**: `data/status/latest.json` tiene resumen de última ejecución
- **Logs**: Todo se loguea en consola con emojis para fácil lectura

## Próximos Pasos (Preparado pero no implementado)

- Integración con LLM real en `analyzeContent.js` (actualmente mock)
- Notificaciones (email/webhook) cuando se genera alerta
- Dashboard para visualizar histórico y alertas
