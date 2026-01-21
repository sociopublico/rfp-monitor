const puppeteer = require('puppeteer');

const TIMEOUT = 60000; // 60 segundos

/**
 * Obtiene el HTML renderizado de una URL usando Puppeteer
 * Espera a que la página esté completamente cargada (networkidle2)
 * @param {Object} page - Instancia de Puppeteer Page
 * @param {string} url - URL a obtener
 * @returns {Promise<string>} - HTML renderizado
 */
async function fetchSiteHtml(page, url) {
  try {
    // Navegar a la URL con timeout
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: TIMEOUT
    });

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
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Configurar timeout por defecto
  page.setDefaultTimeout(TIMEOUT);
  
  // Configurar user agent para evitar bloqueos
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
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
