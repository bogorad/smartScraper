// src/browser/puppeteer-controller.js
// Enhanced debug logging for success paths and decision points.
// HTML content removed from error details.
// Added robust checks for viewport configuration and imported error classes.
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { URL } from 'url';
import { logger } from '../utils/logger.js';
// Import necessary error classes
import { NetworkError, ConfigurationError, ScraperError } from '../utils/error-handler.js';

puppeteer.use(StealthPlugin());

class PuppeteerController {
  constructor(pluginManager, scraperSettings) {
    this.pluginManager = pluginManager;
    this.scraperSettings = scraperSettings; // Passed from CoreScraperEngine

    // Critical check: Ensure scraperSettings and puppeteerViewport are available at construction
    if (!this.scraperSettings) {
        const errMsg = '[PuppeteerController CONSTRUCTOR] scraperSettings is undefined. This is a critical initialization error.';
        logger.error(errMsg);
        throw new ConfigurationError(errMsg, { reason: 'constructor_settings_missing' });
    }
    if (!this.scraperSettings.puppeteerViewport) {
        const errMsg = '[PuppeteerController CONSTRUCTOR] scraperSettings.puppeteerViewport is undefined. Viewport dimensions are required.';
        logger.error(errMsg);
        logger.debug('[DEBUG_MODE] scraperSettings at time of viewport error in constructor:', JSON.stringify(this.scraperSettings, null, 2));
        throw new ConfigurationError(errMsg, { reason: 'constructor_viewport_missing' });
    }
    if (typeof this.scraperSettings.puppeteerViewport.width !== 'number' || typeof this.scraperSettings.puppeteerViewport.height !== 'number') {
        const errMsg = `[PuppeteerController CONSTRUCTOR] scraperSettings.puppeteerViewport.width or .height is not a number. Viewport: ${JSON.stringify(this.scraperSettings.puppeteerViewport)}`;
        logger.error(errMsg);
        logger.debug('[DEBUG_MODE] scraperSettings at time of viewport type error in constructor:', JSON.stringify(this.scraperSettings, null, 2));
        throw new ConfigurationError(errMsg, { reason: 'constructor_viewport_type_error' });
    }

    logger.debug('[PuppeteerController CONSTRUCTOR] Initialized with valid scraperSettings.');
  }

  async launchBrowser(proxyDetails = null) {
    logger.debug(`[PuppeteerController launchBrowser] Launching browser. Proxy: ${proxyDetails ? 'Yes' : 'No'}`);

    if (!this.scraperSettings || !this.scraperSettings.puppeteerViewport ||
        typeof this.scraperSettings.puppeteerViewport.width !== 'number' ||
        typeof this.scraperSettings.puppeteerViewport.height !== 'number') {
      const errorMsg = `Puppeteer viewport configuration is missing or invalid in scraperSettings. Viewport: ${JSON.stringify(this.scraperSettings?.puppeteerViewport)}`;
      logger.error(`[PuppeteerController launchBrowser] ${errorMsg}`);
      logger.debug('[DEBUG_MODE] scraperSettings at time of viewport error in launchBrowser:', JSON.stringify(this.scraperSettings, null, 2));
      throw new ConfigurationError(errorMsg, {
          reason: "viewport_config_invalid_launch",
          currentViewportConfig: this.scraperSettings?.puppeteerViewport
      });
    }

    const launchOptions = {
      headless: this.scraperSettings.puppeteerHeadless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', 
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        `--window-size=${this.scraperSettings.puppeteerViewport.width},${this.scraperSettings.puppeteerViewport.height}`,
      ],
      executablePath: this.scraperSettings.puppeteerExecutablePath || undefined,
      timeout: this.scraperSettings.puppeteerLaunchTimeout || 60000, 
    };

    if (proxyDetails && proxyDetails.server) {
      try {
        const parsedProxyUrl = new URL(proxyDetails.server);
        const proxyHostPort = `${parsedProxyUrl.hostname}:${parsedProxyUrl.port || (parsedProxyUrl.protocol === 'https:' ? '443' : '80')}`;
        launchOptions.args.push(`--proxy-server=${proxyHostPort}`);
        logger.info(`[PuppeteerController launchBrowser] Using proxy for Puppeteer: ${proxyHostPort}`);
      } catch (e) {
        logger.error(`[PuppeteerController launchBrowser] Invalid proxy server string for Puppeteer: ${proxyDetails.server}. Error: ${e.message}`);
        throw new ConfigurationError(`Invalid proxy server string format for Puppeteer`, { proxyServer: proxyDetails.server, originalErrorName: e.name, originalErrorMessage: e.message });
      }
    }

    await this.pluginManager.configureLaunchOptions(launchOptions);

    if (this.scraperSettings.debug) {
      logger.debug('[PuppeteerController launchBrowser] Effective launch options after PluginManager:', launchOptions);
    }

    try {
      const browser = await puppeteer.launch(launchOptions);
      logger.info('[PuppeteerController launchBrowser] Puppeteer browser launched successfully.');
      if (this.scraperSettings.debug) {
        logger.debug(`[PuppeteerController launchBrowser] Browser version: ${await browser.version()}, Endpoint: ${browser.wsEndpoint()}`);
      }
      return browser;
    } catch (error) {
      logger.error(`[PuppeteerController launchBrowser] Failed to launch Puppeteer browser: ${error.message}`);
      if (this.scraperSettings.debug) {
        logger.error('[DEBUG_MODE] Full error during Puppeteer browser launch:', error);
      }
      if (error instanceof ScraperError) throw error;
      throw new NetworkError('Failed to launch Puppeteer browser', { originalErrorName: error.name, originalErrorMessage: error.message, stack: error.stack });
    }
  }

  async newPage(browser, userAgentString = null) {
    logger.debug('[PuppeteerController newPage] Creating new page.');
    try {
      const page = await browser.newPage();
      
      if (!this.scraperSettings || !this.scraperSettings.puppeteerViewport ||
          typeof this.scraperSettings.puppeteerViewport.width !== 'number' ||
          typeof this.scraperSettings.puppeteerViewport.height !== 'number') {
            const errorMsg = `Puppeteer viewport configuration is missing or invalid in newPage. Viewport: ${JSON.stringify(this.scraperSettings?.puppeteerViewport)}`;
            logger.error(`[PuppeteerController newPage] ${errorMsg}`);
            throw new ConfigurationError(errorMsg, { reason: "viewport_config_invalid_newpage" });
      }
      await page.setViewport({
        width: this.scraperSettings.puppeteerViewport.width,
        height: this.scraperSettings.puppeteerViewport.height,
      });

      const uaToSet = userAgentString || this.scraperSettings.defaultUserAgent;
      await page.setUserAgent(uaToSet);
      logger.info(`[PuppeteerController newPage] New page created. User-Agent set to: ${uaToSet}`);
      if (this.scraperSettings.debug) {
        logger.debug(`[PuppeteerController newPage] Page target ID: ${page.target()._targetId}`);
      }

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        // @ts-ignore
        // eslint-disable-next-line no-proto
        delete navigator.__proto__.webdriver; 
        // @ts-ignore
        window.navigator.chrome = { runtime: {} }; 
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimeTypes: [{ type: 'application/x-google-chrome-pdf', suffixes: 'pdf' }] },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf' }] },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', mimeTypes: [{ type: 'application/x-nacl', suffixes: ''},{ type: 'application/x-pnacl', suffixes: ''}] }
          ],
        });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      });
      logger.debug('[PuppeteerController newPage] Anti-detection measures applied.');

      return page;
    } catch (error) {
      logger.error(`[PuppeteerController newPage] Failed to create new Puppeteer page: ${error.message}`);
      if (this.scraperSettings.debug) {
        logger.error('[DEBUG_MODE] Full error during newPage creation:', error);
      }
      if (error instanceof ScraperError) throw error;
      throw new NetworkError('Failed to create new Puppeteer page', { originalErrorName: error.name, originalErrorMessage: error.message, stack: error.stack });
    }
  }

  async launchAndNavigate(url, proxyDetails = null, userAgentString = null, waitConditions = null, isInitialProbe = false) {
    let browser = null;
    let page = null;
    logger.debug(`[PuppeteerController launchAndNavigate] Entry. URL: ${url}, isInitialProbe: ${isInitialProbe}`);
    try {
      browser = await this.launchBrowser(proxyDetails); 
      page = await this.newPage(browser, userAgentString); 

      if (proxyDetails && proxyDetails.username && proxyDetails.password) {
        logger.debug('[PuppeteerController launchAndNavigate] Authenticating proxy...');
        await page.authenticate({
          username: decodeURIComponent(proxyDetails.username),
          password: decodeURIComponent(proxyDetails.password),
        });
        logger.info('[PuppeteerController launchAndNavigate] Proxy authentication set.');
      }

      await this.navigate(page, url, waitConditions, isInitialProbe);
      logger.info(`[PuppeteerController launchAndNavigate] Successfully launched and navigated to ${url}`);
      return { browser, page };
    } catch (error) { 
      logger.error(`[PuppeteerController launchAndNavigate] Launch or navigation failed for ${url}: ${error.message} (Error Name: ${error.name})`);
      if (this.scraperSettings.debug) {
        logger.error(`[DEBUG_MODE] Full error in launchAndNavigate for ${url}:`, error);
        if (error.stack) logger.debug(`[DEBUG_MODE] Stack: ${error.stack}`);
      }
      
      if (page && !page.isClosed()) {
        try { await page.close(); logger.debug('[PuppeteerController launchAndNavigate] Page closed during error handling.'); }
        catch (closeError) { logger.warn(`[PuppeteerController launchAndNavigate] Error closing page during error handling: ${closeError.message}`); }
      }
      if (browser && browser.isConnected()) {
        try { await browser.close(); logger.debug('[PuppeteerController launchAndNavigate] Browser closed during error handling.'); }
        catch (browserCloseError) { logger.warn(`[PuppeteerController launchAndNavigate] Error closing browser during error handling: ${browserCloseError.message}`); }
      }
      
      if (error instanceof ScraperError) {
          throw error;
      }
      throw new NetworkError(`Unexpected error during launch and navigation for ${url}: ${error.message}`, { originalErrorName: error.name, originalErrorMessage: error.message, stack: error.stack });
    }
  }

  async navigate(page, url, waitConditions = null, isInitialProbe = false) {
    logger.debug(`[PuppeteerController navigate] Navigating to: ${url}. isInitialProbe: ${isInitialProbe}`);
    let htmlContentOnError = null;
    try {
      const navigationOptions = {
        waitUntil: waitConditions || (isInitialProbe ? 'domcontentloaded' : 'networkidle2'),
        timeout: this.scraperSettings.puppeteerNavigationTimeout,
      };
      logger.debug(`[PuppeteerController navigate] Navigation options: ${JSON.stringify(navigationOptions)}`);
      const response = await page.goto(url, navigationOptions);
      logger.info(`[PuppeteerController navigate] Successfully navigated to ${url}. Status: ${response ? response.status() : 'N/A'}`);
      if (this.scraperSettings.debug && response) {
        logger.debug(`[PuppeteerController navigate] Final URL: ${page.url()}, Response headers (sample):`, response.headers()['content-type']);
      }

      await this.pluginManager.applyToPageAfterNavigation(page);
      logger.debug('[PuppeteerController navigate] Post-navigation plugins applied.');

      if (this.scraperSettings.puppeteerPostLoadDelay > 0) {
        logger.debug(`[PuppeteerController navigate] Waiting for postLoadDelay: ${this.scraperSettings.puppeteerPostLoadDelay}ms`);
        await page.waitForTimeout(this.scraperSettings.puppeteerPostLoadDelay);
      }

    } catch (error) {
      logger.error(`[PuppeteerController navigate] Navigation to ${url} failed: ${error.message}`);
      if (page && !page.isClosed()) {
        try {
          htmlContentOnError = await page.content();
        } catch (contentError) {
          logger.warn(`[PuppeteerController navigate] Could not get page content after navigation error: ${contentError.message}`);
        }
      }
      if (this.scraperSettings.debug) {
        logger.error(`[DEBUG_MODE] Full error during navigation to ${url}:`, error);
        if (htmlContentOnError) logger.debug(`[DEBUG_MODE] HTML content on navigation error (first 500 chars): ${htmlContentOnError.substring(0,500)}...`);
      }
      if (error instanceof ScraperError) throw error;
      throw new NetworkError(`Navigation to ${url} failed: ${error.message}`, {
        originalErrorName: error.name,
        originalErrorMessage: error.message,
        stack: error.stack,
        htmlContentLength: htmlContentOnError?.length, 
        finalUrlAttempted: page.isClosed() ? url : (page.url() || url) 
      });
    }
  }

  async performInteractions(page) {
    logger.debug('[PuppeteerController performInteractions] Performing generic page interactions.');
    try {
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          const distance = 100;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= scrollHeight - window.innerHeight) {
              clearInterval(timer);
              resolve(true);
            }
          }, 100);
        });
      });
      logger.debug('[PuppeteerController performInteractions] Scrolled to bottom.');

      const interactionDelay = this.scraperSettings.puppeteerInteractionDelay || 2000;
      await page.waitForTimeout(interactionDelay);
      logger.debug(`[PuppeteerController performInteractions] Waited for interactionDelay: ${interactionDelay}ms`);

      logger.info('[PuppeteerController performInteractions] Generic page interactions completed.');
    } catch (error) {
      if (!error.message.includes('Target closed') && !error.message.includes('Navigation failed')) {
        logger.warn(`[PuppeteerController performInteractions] Error during generic page interactions: ${error.message}`);
        if (this.scraperSettings.debug) {
          logger.warn('[DEBUG_MODE] Full error during performInteractions:', error);
        }
      } else {
        logger.debug(`[PuppeteerController performInteractions] Interaction interrupted by navigation/closure: ${error.message}`);
      }
    }
  }

  async getPageContent(page) {
    logger.debug('[PuppeteerController getPageContent] Getting page content.');
    try {
      const content = await page.content();
      logger.info(`[PuppeteerController getPageContent] Page content retrieved. Length: ${content?.length}`);
      if (this.scraperSettings.debug && content) {
        logger.debug(`[PuppeteerController getPageContent] Content snippet (first 200 chars): ${content.substring(0,200)}...`);
      }
      return content;
    } catch (error) {
      logger.error(`[PuppeteerController getPageContent] Failed to get page content: ${error.message}`);
      if (this.scraperSettings.debug) {
        logger.error('[DEBUG_MODE] Full error during getPageContent:', error);
      }
      if (error instanceof ScraperError) throw error;
      throw new NetworkError('Failed to get page content', { originalErrorName: error.name, originalErrorMessage: error.message, stack: error.stack });
    }
  }

  async queryXPathWithDetails(page, xpath) {
    logger.debug(`[PuppeteerController queryXPathWithDetails] Querying XPath: ${xpath}`);
    const result = {
      xpath: xpath,
      element_found_count: 0,
      tagName: null,
      id: null,
      className: null,
      textContentLength: 0,
      innerHTMLSample: '', 
      paragraphCount: 0,
      linkCount: 0,
      imageCount: 0,
      videoCount: 0,
      audioCount: 0,
      pictureCount: 0,
      unwantedTagCount: 0,
      totalDescendantElements: 0,
    };

    try {
      const elements = await page.$x(xpath);
      result.element_found_count = elements.length;

      if (elements.length > 0) {
        const mainElement = elements[0];
        result.tagName = await page.evaluate(el => el.tagName.toLowerCase(), mainElement);
        result.id = await page.evaluate(el => el.id, mainElement);
        result.className = await page.evaluate(el => el.className, mainElement);
        
        const innerHTMLFull = await page.evaluate(el => el.innerHTML, mainElement);
        result.innerHTMLSample = innerHTMLFull.substring(0, 200) + (innerHTMLFull.length > 200 ? '...' : '');

        const innerContentDetails = await page.evaluate(el => {
          const unwantedTags = new Set(['nav', 'footer', 'aside', 'header', 'form', 'script', 'style', 'figcaption', 'figure', 'details', 'summary', 'menu', 'dialog']);
          
          const getTextLength = (node) => {
            let len = 0;
            if (node.nodeType === Node.TEXT_NODE) {
              len += (node.textContent || '').trim().length;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              if (!['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED'].includes(node.tagName.toUpperCase())) {
                for (const child of Array.from(node.childNodes)) {
                  len += getTextLength(child);
                }
              }
            }
            return len;
          };

          const countTags = (parentElement, tagNames) => {
            let count = 0;
            if (!parentElement || typeof parentElement.getElementsByTagName !== 'function') return 0;
            tagNames.forEach(tagName => {
              count += parentElement.getElementsByTagName(tagName).length;
            });
            return count;
          };
          
          let unwantedCount = 0;
          el.querySelectorAll('*').forEach(descendant => {
            if (unwantedTags.has(descendant.tagName.toLowerCase())) {
              unwantedCount++;
            }
          });

          return {
            textContentLength: getTextLength(el),
            paragraphCount: el.getElementsByTagName('p').length,
            linkCount: el.getElementsByTagName('a').length,
            imageCount: el.getElementsByTagName('img').length,
            videoCount: el.getElementsByTagName('video').length,
            audioCount: el.getElementsByTagName('audio').length,
            pictureCount: el.getElementsByTagName('picture').length,
            unwantedTagCount: unwantedCount,
            totalDescendantElements: el.getElementsByTagName('*').length,
          };
        }, mainElement);

        Object.assign(result, innerContentDetails);

        for (const el of elements) {
          await el.dispose();
        }
        logger.debug(`[PuppeteerController queryXPathWithDetails] XPath "${xpath}" details: found=${result.element_found_count}, tagName=${result.tagName}, pCount=${result.paragraphCount}, textLen=${result.textContentLength}`);
      } else {
        logger.debug(`[PuppeteerController queryXPathWithDetails] XPath "${xpath}" found 0 elements.`);
      }
    } catch (error) {
      logger.warn(`[PuppeteerController queryXPathWithDetails] Error querying XPath "${xpath}" on page: ${error.message}`);
      if (this.scraperSettings.debug) {
        logger.warn('[DEBUG_MODE] Full error during queryXPathWithDetails:', error);
      }
    }
    return result;
  }


  async cleanupPuppeteer(browser) {
    if (browser && browser.isConnected()) {
      logger.debug('[PuppeteerController cleanupPuppeteer] Closing Puppeteer browser.');
      try {
        await browser.close();
        logger.info('[PuppeteerController cleanupPuppeteer] Puppeteer browser closed successfully.');
      } catch (error) {
        logger.error(`[PuppeteerController cleanupPuppeteer] Failed to close Puppeteer browser: ${error.message}`);
        if (this.scraperSettings.debug) {
          logger.error('[DEBUG_MODE] Full error during browser close:', error);
        }
      }
    } else {
      logger.debug('[PuppeteerController cleanupPuppeteer] Browser already closed or not provided.');
    }
  }
}

export { PuppeteerController };
