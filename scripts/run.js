const path = require('path');
const fs = require('fs').promises;
const { readAndFilterCsv } = require('./readCsv');
const { fetchSiteHtml, createBrowser, closeBrowser, shouldRecreatePage } = require('./fetchSite');
const { startRunLog } = require('./runLog');
const {
  generateSlug,
  extractVisibleText,
  ensureDirectoryExists,
  readMetadata,
  writeMetadata
} = require('./utils');
const HistoryLogger = require('./historyLogger');
const { detectChange } = require('./detectChange');
const { analyzeRelevance } = require('./analyzeContent');
const {
  calculateChangeScore,
  calculateFinalScore,
  shouldGenerateAlert,
  generateScoreSummary
} = require('./score');
const { generateAlert } = require('./alertManager');
const { updateStatus } = require('./updateStatus');
const { writeWeekReport } = require('./weekReport');
const config = require('../config/profile');

function extractErrorType(errorMessage) {
  if (!errorMessage) {
    return 'unknown';
  }
  const message = errorMessage.toLowerCase();
  if (message.includes('[timeout]') || message.includes('timeout')) {
    return 'timeout';
  }
  if (message.includes('[ssl]') || message.includes('err_cert')) {
    return 'ssl';
  }
  if (message.includes('[dns]') || message.includes('err_name_not_resolved') || message.includes('enotfound')) {
    return 'dns';
  }
  if (message.includes('[connection]') || message.includes('econnreset') || message.includes('econnrefused')) {
    return 'connection';
  }
  if (message.includes('[browser]') || message.includes('target closed')) {
    return 'browser';
  }
  if (message.includes('[frame_detached]') || message.includes('detached frame') || message.includes('execution context was destroyed')) {
    return 'frame_detached';
  }
  return 'unknown';
}

// Rutas de directorios y archivos
const SNAPSHOTS_DIR = path.join(__dirname, '..', 'data', 'snapshots');
const HTML_DIR = path.join(SNAPSHOTS_DIR, 'html');
const TEXT_DIR = path.join(SNAPSHOTS_DIR, 'text');
const METADATA_PATH = path.join(SNAPSHOTS_DIR, 'metadata.json');

/**
 * Procesa una URL individual: obtiene HTML, extrae texto, detecta cambios,
 * analiza contenido y genera alertas si es necesario
 * @param {Object} page - Instancia de Puppeteer Page
 * @param {string} url - URL a procesar
 * @param {Array} existingMetadata - Metadatos existentes para evitar duplicados
 * @returns {Promise<Object>} - Metadatos del sitio procesado
 */
async function processUrl(page, url, existingMetadata) {
  const slug = generateSlug(url);
  const timestamp = new Date().toISOString();
  
  try {
    console.log(`📥 Obteniendo HTML de: ${url}`);
    
    // Obtener HTML renderizado
    const html = await fetchSiteHtml(page, url);
    
    // Extraer texto visible
    const text = extractVisibleText(html);
    
    // === DETECCIÓN DE CAMBIOS ===
    // IMPORTANTE: detectar ANTES de sobrescribir snapshots
    const changeInfo = await detectChange(url, slug, text);
    
    // Guardar HTML (snapshot actual)
    const htmlPath = path.join(HTML_DIR, `${slug}.html`);
    await fs.writeFile(htmlPath, html, 'utf-8');
    
    // Guardar texto (snapshot actual)
    const textPath = path.join(TEXT_DIR, `${slug}.txt`);
    await fs.writeFile(textPath, text, 'utf-8');
    
    // === ANÁLISIS SEMÁNTICO del texto completo ===
    // (para referencia, pero las keywords que importan son las de cambios)
    const analysis = await analyzeRelevance(text, config);
    
    // === CALCULAR SCORES ===
    // Ahora el score prioriza keywords encontradas en los cambios
    const changeScore = calculateChangeScore(changeInfo.changeRatio);
    const keywordsInChangesCount = changeInfo.keywordsInChanges?.length || 0;
    const finalScore = calculateFinalScore(
      changeScore,
      analysis.relevanceScore,
      changeInfo.hasChanged,
      keywordsInChangesCount,
      changeInfo.isFirstRun || false
    );
    
    // === REGISTRAR EN HISTÓRICO ===
    await HistoryLogger.logEvent({
      url: url,
      timestamp: timestamp,
      status: 'success',
      textHash: changeInfo.textHash,
      textLength: changeInfo.textLength,
      hasChanged: changeInfo.hasChanged,
      isFirstRun: changeInfo.isFirstRun || false,
      changeRatio: changeInfo.changeRatio,
      changedChars: changeInfo.changedChars || 0,
      keywordHits: analysis.foundKeywords?.length || 0,
      foundKeywords: analysis.foundKeywords || [],
      keywordsInChanges: changeInfo.keywordsInChanges || [],
      finalScore: finalScore
    });
    
    // === GENERAR ALERTA SI ES NECESARIO ===
    // El umbral ahora es más bajo (30 puntos)
    let alertGenerated = false;
    if (shouldGenerateAlert(finalScore, config.analysisThresholds)) {
      try {
        const alertPath = await generateAlert({
          url: url,
          slug: slug,
          finalScore: finalScore,
          reason: generateScoreSummary({
            changeScore: changeScore,
            relevanceScore: analysis.relevanceScore,
            finalScore: finalScore,
            hasChanged: changeInfo.hasChanged,
            isFirstRun: changeInfo.isFirstRun || false,
            changeRatio: changeInfo.changeRatio,
            changedChars: changeInfo.changedChars || 0,
            textLength: changeInfo.textLength,
            keywordHits: analysis.foundKeywords?.length || 0,
            keywordsInChangesCount: keywordsInChangesCount
          }),
          scores: {
            changeScore: changeScore,
            relevanceScore: analysis.relevanceScore,
            keywordsInChangesCount: keywordsInChangesCount
          },
          analysis: analysis,
          change: changeInfo
        });
        console.log(`🚨 ALERTA generada: ${alertPath}`);
        alertGenerated = true;
      } catch (alertError) {
        console.error(`⚠️  Error al generar alerta: ${alertError.message}`);
      }
    }
    
    // Crear metadatos (compatible con formato anterior)
    const metadata = {
      url: url,
      slug: slug,
      fechaFetch: timestamp,
      tamañoHTML: Buffer.byteLength(html, 'utf-8'),
      tamañoTexto: Buffer.byteLength(text, 'utf-8'),
      // Campos adicionales del nuevo sistema
      hasChanged: changeInfo.hasChanged,
      isFirstRun: changeInfo.isFirstRun || false,
      changeRatio: changeInfo.changeRatio,
      changedChars: changeInfo.changedChars || 0,
      relevanceScore: analysis.relevanceScore,
      finalScore: finalScore,
      keywordsInChanges: changeInfo.keywordsInChanges || [],
      alertGenerated: alertGenerated,
      previousBaselineAt: changeInfo.previousBaselineAt || null,
      addedText: changeInfo.addedText || ''
    };
    
    // Log resumen
    if (changeInfo.isFirstRun) {
      console.log(`  🆕 Primera ejecución para esta URL`);
    }
    if (changeInfo.hasChanged) {
      const changedChars = changeInfo.changedChars || 0;
      console.log(`  🔄 Cambio detectado: ${changedChars} caracteres (${(changeInfo.changeRatio * 100).toFixed(1)}%)`);
    }
    
    // Lo más importante: keywords EN los cambios
    if (keywordsInChangesCount > 0) {
      console.log(`  🎯 KEYWORDS EN CAMBIOS (${keywordsInChangesCount}): ${changeInfo.keywordsInChanges.slice(0, 5).join(', ')}${keywordsInChangesCount > 5 ? '...' : ''}`);
    }
    
    // Keywords en texto completo (referencia)
    if (analysis.foundKeywords && analysis.foundKeywords.length > 0) {
      console.log(`  🔑 Keywords en texto completo: ${analysis.foundKeywords.length} total`);
    }
    
    console.log(`  📊 Final Score: ${finalScore}/100 ${finalScore >= 70 ? '🔥 MUY RELEVANTE' : finalScore >= 50 ? '⚠️ RELEVANTE' : finalScore >= 30 ? '📌 Posible' : ''}`);
    console.log(`✅ Procesado: ${url} -> ${slug}`);
    
    return metadata;
    
  } catch (error) {
    console.error(`❌ Error al procesar ${url}: ${error.message}`);
    
    // === NUEVO: Registrar error en histórico ===
    try {
      await HistoryLogger.logEvent({
        url: url,
        timestamp: timestamp,
        status: 'error',
        errorType: extractErrorType(error.message),
        errorMessage: error.message
      });
    } catch (logError) {
      // No fallar si no se puede registrar el error
      console.error(`⚠️  Error al registrar en histórico: ${logError.message}`);
    }
    
    // Retornar metadata con error (compatible con formato anterior)
    return {
      url: url,
      slug: slug,
      fechaFetch: timestamp,
      error: error.message,
      tamañoHTML: 0,
      tamañoTexto: 0
    };
  }
}

/**
 * Función principal que orquesta todo el proceso
 */
async function main() {
  const runLog = startRunLog();
  console.log(`🚀 Iniciando proceso de scraping... ${new Date().toISOString()}\n`);
  
  try {
    // 1. Asegurar que los directorios existen
    console.log('📁 Creando directorios necesarios...');
    await ensureDirectoryExists(SNAPSHOTS_DIR);
    await ensureDirectoryExists(HTML_DIR);
    await ensureDirectoryExists(TEXT_DIR);
    await ensureDirectoryExists(path.join(__dirname, '..', 'data', 'diffs'));
    await ensureDirectoryExists(path.join(__dirname, '..', 'data', 'alerts'));
    await ensureDirectoryExists(path.join(__dirname, '..', 'data', 'history'));
    await ensureDirectoryExists(path.join(__dirname, '..', 'data', 'runs'));
    await ensureDirectoryExists(path.join(__dirname, '..', 'data', 'logs'));
    
    // 2. Leer y filtrar CSV
    console.log('📊 Leyendo y filtrando CSV...');
    const filteredRows = await readAndFilterCsv();
    console.log(`✅ Encontradas ${filteredRows.length} URLs válidas\n`);
    
    if (filteredRows.length === 0) {
      console.log('⚠️  No se encontraron URLs para procesar.');
      await runLog.finish({ totalUrls: 0, status: 'empty' });
      return;
    }
    
    // 3. Leer metadata existente
    const existingMetadata = await readMetadata(METADATA_PATH);
    console.log(`📋 Metadatos existentes: ${existingMetadata.length} entradas\n`);
    
    // 4. Crear browser y page (reutilizar para todas las URLs)
    console.log('🌐 Iniciando navegador...');
    let browser;
    let page;
    ({ browser, page } = await createBrowser());

    async function restartBrowser(reason) {
      console.warn(`⚠️  ${reason}. Reiniciando Chromium completo (una page nueva no alcanza)...`);
      try {
        await closeBrowser(browser);
      } catch (closeError) {
        console.warn(`⚠️  No se pudo cerrar Chromium: ${closeError.message}`);
      }
      const fresh = await createBrowser();
      browser = fresh.browser;
      page = fresh.page;
      console.log('✅ Chromium reiniciado');
    }
    
    try {
      // 5. Procesar cada URL
      const newMetadata = [];
      
      for (let i = 0; i < filteredRows.length; i++) {
        const row = filteredRows[i];
        console.log(`\n[${i + 1}/${filteredRows.length}] Procesando: ${row.link}`);
        
        let metadata = await processUrl(page, row.link, existingMetadata);

        if (metadata.error && shouldRecreatePage(metadata.error)) {
          await restartBrowser('Chromium quedó en un frame inválido');
          console.log(`🔁 Reintentando ${row.link} con browser nuevo...`);
          metadata = await processUrl(page, row.link, existingMetadata);
          if (metadata.error && shouldRecreatePage(metadata.error)) {
            await restartBrowser('El reintento también rompió Chromium');
          }
        }

        newMetadata.push(metadata);
        
        // Pausa entre requests para no sobrecargar el servidor
        if (i < filteredRows.length - 1) {
          console.log('⏳ Esperando 10 segundos antes del siguiente sitio...');
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      }
      
      // 6. Combinar metadata existente con nueva (evitar duplicados).
      // addedText queda solo en memoria: el reporte lo usa y metadata.json no.
      const allMetadata = [...existingMetadata];
      for (const meta of newMetadata.map(withoutAddedText)) {
        const exists = allMetadata.find(m => m.url === meta.url || m.slug === meta.slug);
        if (!exists) {
          allMetadata.push(meta);
        } else {
          // Actualizar entrada existente
          const index = allMetadata.findIndex(m => m.url === meta.url || m.slug === meta.slug);
          allMetadata[index] = meta;
        }
      }
      
      // 7. Guardar metadata actualizado
      await writeMetadata(METADATA_PATH, allMetadata);
      
      // 8. Calcular estadísticas finales
      const successCount = newMetadata.filter(m => !m.error).length;
      const errorCount = newMetadata.filter(m => m.error).length;
      const changedCount = newMetadata.filter(m => m.hasChanged).length;
      const alertsCount = newMetadata.filter(m => m.alertGenerated).length;
      const firstRunCount = newMetadata.filter(m => m.isFirstRun).length;
      
      // 9. Actualizar archivo de status
      const statusPayload = {
        lastRun: new Date().toISOString(),
        totalUrls: newMetadata.length,
        successCount: successCount,
        errorCount: errorCount,
        changedCount: changedCount,
        alertsCount: alertsCount,
        firstRunCount: firstRunCount
      };
      try {
        await updateStatus(statusPayload);
        console.log('📊 Status actualizado');
      } catch (statusError) {
        console.error('⚠️  Error al actualizar status:', statusError.message);
      }

      try {
        const written = await writeWeekReport({ runResults: newMetadata });
        console.log(`📝 Reporte semanal: ${written.file}`);
      } catch (reportError) {
        console.error('⚠️  Error al escribir el reporte semanal:', reportError.message);
      }

      try {
        await runLog.finish({
          ...statusPayload,
          urls: newMetadata.map((m) => ({
            url: m.url,
            slug: m.slug,
            error: m.error || null,
            hasChanged: Boolean(m.hasChanged),
            isFirstRun: Boolean(m.isFirstRun),
            changedChars: m.changedChars || 0,
            finalScore: m.finalScore || 0,
            alertGenerated: Boolean(m.alertGenerated),
            keywordsInChanges: m.keywordsInChanges || []
          }))
        });
      } catch (runLogError) {
        console.error('⚠️  Error al guardar log de corrida:', runLogError.message);
      }
      
      // 10. Resumen final
      console.log('\n' + '='.repeat(60));
      console.log('📊 RESUMEN FINAL');
      console.log('='.repeat(60));
      console.log(`Total URLs procesadas: ${newMetadata.length}`);
      console.log(`✅ Exitosas: ${successCount}`);
      console.log(`❌ Errores: ${errorCount}`);
      console.log(`🔄 Con cambios: ${changedCount}`);
      console.log(`🆕 Primera ejecución (reales): ${firstRunCount}`);
      console.log(`🚨 Alertas generadas: ${alertsCount}`);
      console.log(`📁 Total en metadata: ${allMetadata.length}`);
      console.log('='.repeat(60));
      
    } finally {
      // 11. Cerrar browser
      console.log('\n🔒 Cerrando navegador...');
      await closeBrowser(browser);
    }
    
  } catch (error) {
    console.error('\n❌ Error fatal:', error.message);
    console.error(error.stack);
    try {
      await runLog.finish({ status: 'fatal', error: error.message });
    } catch {
      // ignore
    }
    process.exit(1);
  }
}

function withoutAddedText(meta) {
  if (!meta || !Object.prototype.hasOwnProperty.call(meta, 'addedText')) {
    return meta;
  }
  const copy = { ...meta };
  delete copy.addedText;
  return copy;
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch((error) => {
    console.error('Error no manejado:', error);
    process.exit(1);
  });
}

module.exports = { main };
