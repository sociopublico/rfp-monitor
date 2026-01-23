const path = require('path');
const fs = require('fs').promises;
const { readAndFilterCsv } = require('./readCsv');
const { fetchSiteHtml, createBrowser, closeBrowser } = require('./fetchSite');
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
const config = require('../config/profile');

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
    
    // Guardar HTML
    const htmlPath = path.join(HTML_DIR, `${slug}.html`);
    await fs.writeFile(htmlPath, html, 'utf-8');
    
    // Guardar texto
    const textPath = path.join(TEXT_DIR, `${slug}.txt`);
    await fs.writeFile(textPath, text, 'utf-8');
    
    // === NUEVO: Detección de cambios ===
    const changeInfo = await detectChange(url, slug, text);
    
    // === NUEVO: Análisis semántico ===
    const analysis = await analyzeRelevance(text, config);
    
    // === NUEVO: Calcular scores ===
    const changeScore = calculateChangeScore(changeInfo.changeRatio);
    const finalScore = calculateFinalScore(
      changeScore,
      analysis.relevanceScore,
      changeInfo.hasChanged
    );
    
    // === NUEVO: Registrar en histórico ===
    await HistoryLogger.logEvent({
      url: url,
      timestamp: timestamp,
      status: 'success',
      textHash: changeInfo.textHash,
      textLength: changeInfo.textLength,
      hasChanged: changeInfo.hasChanged,
      isFirstRun: changeInfo.isFirstRun || false,
      changeRatio: changeInfo.changeRatio,
      keywordHits: analysis.foundKeywords?.length || 0,
      foundKeywords: analysis.foundKeywords || [],
      keywordsInChanges: changeInfo.keywordsInChanges || [],
      finalScore: finalScore
    });
    
    // === NUEVO: Generar alerta si es necesario ===
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
            changeRatio: changeInfo.changeRatio,
            keywordHits: Math.ceil(analysis.relevanceScore / 15)
          }),
          scores: {
            changeScore: changeScore,
            relevanceScore: analysis.relevanceScore
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
      changeRatio: changeInfo.changeRatio,
      relevanceScore: analysis.relevanceScore,
      finalScore: finalScore,
      alertGenerated: alertGenerated
    };
    
    // Log resumen
    if (changeInfo.hasChanged) {
      console.log(`  🔄 Cambio detectado (ratio: ${(changeInfo.changeRatio * 100).toFixed(1)}%)`);
    }
    if (analysis.hasOpportunity) {
      console.log(`  💡 Oportunidad detectada (score: ${analysis.relevanceScore}/100)`);
    }
    console.log(`  📊 Final Score: ${finalScore}/100`);
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
    
    // 2. Leer y filtrar CSV
    console.log('📊 Leyendo y filtrando CSV...');
    const filteredRows = await readAndFilterCsv();
    console.log(`✅ Encontradas ${filteredRows.length} URLs válidas\n`);
    
    if (filteredRows.length === 0) {
      console.log('⚠️  No se encontraron URLs para procesar.');
      return;
    }
    
    // 3. Leer metadata existente
    const existingMetadata = await readMetadata(METADATA_PATH);
    console.log(`📋 Metadatos existentes: ${existingMetadata.length} entradas\n`);
    
    // 4. Crear browser y page (reutilizar para todas las URLs)
    console.log('🌐 Iniciando navegador...');
    const { browser, page } = await createBrowser();
    
    try {
      // 5. Procesar cada URL
      const newMetadata = [];
      
      for (let i = 0; i < filteredRows.length; i++) {
        const row = filteredRows[i];
        console.log(`\n[${i + 1}/${filteredRows.length}] Procesando: ${row.link}`);
        
        const metadata = await processUrl(page, row.link, existingMetadata);
        newMetadata.push(metadata);
        
        // Pausa entre requests para no sobrecargar el servidor
        if (i < filteredRows.length - 1) {
          console.log('⏳ Esperando 10 segundos antes del siguiente sitio...');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      // 6. Combinar metadata existente con nueva (evitar duplicados)
      const allMetadata = [...existingMetadata];
      for (const meta of newMetadata) {
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
      
      // 9. Actualizar archivo de status
      try {
        await updateStatus({
          lastRun: new Date().toISOString(),
          totalUrls: newMetadata.length,
          successCount: successCount,
          errorCount: errorCount,
          changedCount: changedCount,
          alertsCount: alertsCount
        });
        console.log('📊 Status actualizado');
      } catch (statusError) {
        console.error('⚠️  Error al actualizar status:', statusError.message);
      }
      
      // 10. Resumen final
      console.log('\n' + '='.repeat(60));
      console.log('📊 RESUMEN FINAL');
      console.log('='.repeat(60));
      console.log(`Total URLs procesadas: ${newMetadata.length}`);
      console.log(`✅ Exitosas: ${successCount}`);
      console.log(`❌ Errores: ${errorCount}`);
      console.log(`🔄 Con cambios: ${changedCount}`);
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
    process.exit(1);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch((error) => {
    console.error('Error no manejado:', error);
    process.exit(1);
  });
}

module.exports = { main };
