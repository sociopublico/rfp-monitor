const puppeteer = require('puppeteer');

const TIMEOUT = 60000; // 60 segundos

function classifyNavigationError(error) {
  const message = (error && error.message ? error.message : '').toLowerCase();
  if (message.includes('timeout')) return 'timeout';
  if (message.includes('err_cert')) return 'ssl';
  if (message.includes('err_name_not_resolved') || message.includes('enotfound')) return 'dns';
  if (message.includes('err_connection') || message.includes('econnreset') || message.includes('econnrefused')) return 'connection';
  if (message.includes('target closed') || message.includes('session closed')) return 'browser';
  return 'unknown';
}

async function gotoWithRetries(page, url) {
  const attempts = [
    { waitUntil: 'networkidle2', timeout: TIMEOUT },
    { waitUntil: 'domcontentloaded', timeout: TIMEOUT },
    { waitUntil: 'load', timeout: 45000 }
  ];
  let lastError = null;

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      await page.goto(url, attempt);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`⚠️  Navegación fallida [${i + 1}/${attempts.length}] (${attempt.waitUntil}): ${error.message}`);
    }
  }

  const errorType = classifyNavigationError(lastError);
  throw new Error(`[${errorType}] ${lastError ? lastError.message : 'unknown navigation error'}`);
}

/**
 * Obtiene el HTML renderizado de una URL usando Puppeteer
 * Espera a que la página esté completamente cargada (networkidle2)
 * @param {Object} page - Instancia de Puppeteer Page
 * @param {string} url - URL a obtener
 * @returns {Promise<string>} - HTML renderizado
 */
async function fetchSiteHtml(page, url) {
  try {
    // Navegar con reintentos y estrategias de espera
    await gotoWithRetries(page, url);

    // Obtener el HTML completo después de que JavaScript haya ejecutado
    const html = await page.content();
    
    return html;
  } catch (error) {
    throw new Error(`Error al obtener HTML de ${url}: ${error.message}`);
  }
}

/**
 * Crea una instancia de browser y page reutilizable
 * @returns {Promise<Object>} - Objeto con browser y page
 */
async function createBrowser() {
  // Detectar si estamos en Docker/Alpine y usar Chromium del sistema
  // En Alpine, Chromium puede estar en diferentes ubicaciones
  const fs = require('fs');
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  
  if (!executablePath && process.platform === 'linux') {
    // Probar diferentes ubicaciones comunes de Chromium
    const possiblePaths = [
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable'
    ];
    
    for (const path of possiblePaths) {
      try {
        if (fs.existsSync(path)) {
          executablePath = path;
          console.log(`✅ Chromium encontrado en: ${path}`);
          break;
        }
      } catch (e) {
        // Continuar buscando
      }
    }
    
    if (!executablePath) {
      console.warn('⚠️  Chromium no encontrado en rutas estándar, Puppeteer intentará usar su Chrome descargado');
    }
  }
  
  // Argumentos mínimos necesarios para Alpine/Docker
  const chromeArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--no-first-run',
    '--no-zygote',
    '--single-process', // Necesario en contenedores con recursos limitados
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio'
  ];
  
  const launchOptions = {
    headless: true, // Modo headless estándar (más compatible que 'new')
    args: chromeArgs,
    ignoreHTTPSErrors: true,
    timeout: 90000, // 90 segundos para iniciar (Alpine puede ser lento)
    protocolTimeout: 120000 // 120 segundos para protocolo
  };
  
  // Solo agregar executablePath si fue encontrado
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }
  
  console.log('🚀 Iniciando Chromium con opciones:', {
    headless: launchOptions.headless,
    executablePath: launchOptions.executablePath || 'default',
    argsCount: launchOptions.args.length,
    timeout: launchOptions.timeout
  });
  
  // Verificar que el ejecutable existe y es ejecutable
  if (executablePath) {
    try {
      const { execSync } = require('child_process');
      execSync(`test -x "${executablePath}"`, { stdio: 'ignore' });
      console.log(`✅ Chromium es ejecutable: ${executablePath}`);
    } catch (e) {
      console.warn(`⚠️  Chromium puede no ser ejecutable: ${executablePath}`);
    }
  }
  
  let browser;
  try {
    browser = await puppeteer.launch(launchOptions);
    console.log('✅ Chromium iniciado correctamente');
  } catch (error) {
    console.error('❌ Error al iniciar Chromium:', error.message);
    // Si falla con single-process, intentar sin él
    if (launchOptions.args.includes('--single-process')) {
      console.log('🔄 Reintentando sin --single-process...');
      launchOptions.args = launchOptions.args.filter(arg => arg !== '--single-process');
      browser = await puppeteer.launch(launchOptions);
      console.log('✅ Chromium iniciado sin --single-process');
    } else {
      throw error;
    }
  }
  
  const page = await browser.newPage();
  
  // Configurar timeout por defecto
  page.setDefaultTimeout(TIMEOUT);
  
  // Configurar user agent para evitar bloqueos
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Reducir carga de recursos no esenciales para bajar timeouts
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const resourceType = request.resourceType();
    if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
      request.abort();
      return;
    }
    request.continue();
  });
  
  return { browser, page };
}

/**
 * Cierra el browser
 * @param {Object} browser - Instancia de Puppeteer Browser
 */
async function closeBrowser(browser) {
  await browser.close();
}

module.exports = {
  fetchSiteHtml,
  createBrowser,
  closeBrowser
};
