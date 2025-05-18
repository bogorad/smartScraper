// src/browser/puppeteer-controller.ts
import puppeteerDefault, { 
    Browser, 
    Page, 
    PuppeteerLaunchOptions as DefaultPuppeteerLaunchOptions,
    HTTPRequest, 
    HTTPResponse, 
    PuppeteerLifeCycleEvent, 
    Target,
    ElementHandle,
    Protocol // Import Protocol for CookieParam if needed elsewhere, though not directly here
} from 'puppeteer';
import puppeteer from 'puppeteer-extra'; // Use puppeteer-extra for .use()
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { URL } from 'url';
import { logger } from '../utils/logger.js';
import { PluginManager } from './plugin-manager.js';
import { ScraperSettings } from '../../config/scraper-settings.js'; // Direct import of interface
import { NetworkError, ConfigurationError, ScraperError } from '../utils/error-handler.js';

(puppeteer as any).use(StealthPlugin());

// Custom type for launch options to explicitly allow 'new' for headless
// and ensure 'args' is available.
type CustomPuppeteerLaunchOptions = Omit<DefaultPuppeteerLaunchOptions, 'headless'> & {
    headless?: boolean | 'new' | 'shell'; 
    args?: string[];
};

export interface ProxyDetails {
  server: string;
  username?: string;
  password?: string;
}

export interface XPathQueryDetails {
  xpath: string;
  element_found_count: number;
  tagName: string | null;
  id: string | null;
  className: string | null;
  innerHTMLSample: string;
  textContentLength: number;
  paragraphCount: number;
  linkCount: number;
  imageCount: number;
  videoCount: number;
  audioCount: number;
  pictureCount: number;
  unwantedTagCount: number;
  totalDescendantElements: number;
}


class PuppeteerController {
  private pluginManager: PluginManager;
  private scraperSettings: ScraperSettings;

  constructor(pluginManager: PluginManager, scraperSettings: ScraperSettings) {
    this.pluginManager = pluginManager;
    this.scraperSettings = scraperSettings;

    if (!this.scraperSettings) {
        const errMsg = '[PuppeteerController CONSTRUCTOR] scraperSettings is undefined.';
        logger.error(errMsg);
        throw new ConfigurationError(errMsg, { reason: 'constructor_settings_missing' });
    }
    if (!this.scraperSettings.puppeteerViewport) {
        const errMsg = `[PuppeteerController CONSTRUCTOR] scraperSettings.puppeteerViewport is undefined.`;
        logger.error(errMsg);
        if (logger.isDebugging()) {
            logger.debug('[DEBUG_MODE] scraperSettings at time of viewport error in constructor:', JSON.stringify(this.scraperSettings, null, 2));
        }
        throw new ConfigurationError(errMsg, { reason: 'constructor_viewport_missing' });
    }
    if (typeof this.scraperSettings.puppeteerViewport.width !== 'number' || typeof this.scraperSettings.puppeteerViewport.height !== 'number') {
        const errMsg = `[PuppeteerController CONSTRUCTOR] scraperSettings.puppeteerViewport.width or .height is not a number. Viewport: ${JSON.stringify(this.scraperSettings.puppeteerViewport)}`;
        logger.error(errMsg);
        if (logger.isDebugging()) {
            logger.debug('[DEBUG_MODE] scraperSettings at time of viewport type error in constructor:', JSON.stringify(this.scraperSettings, null, 2));
        }
        throw new ConfigurationError(errMsg, { reason: 'constructor_viewport_type_error' });
    }
    if (logger.isDebugging()) {
        logger.debug('[PuppeteerController CONSTRUCTOR] Initialized with valid scraperSettings.');
    }
  }

  async launchBrowser(proxyDetails: ProxyDetails | null = null): Promise<Browser> {
    logger.debug(`[PuppeteerController launchBrowser] Launching browser. Proxy: ${proxyDetails ? 'Yes' : 'No'}`);
    
    if (!this.scraperSettings?.puppeteerViewport?.width || !this.scraperSettings?.puppeteerViewport?.height) {
        const errorMsg = `Puppeteer viewport configuration is missing or invalid in scraperSettings. Viewport: ${JSON.stringify(this.scraperSettings?.puppeteerViewport)}`;
        logger.error(`[PuppeteerController launchBrowser] ${errorMsg}`);
        if (logger.isDebugging()) {
            logger.debug('[DEBUG_MODE] scraperSettings at time of viewport error in launchBrowser:', JSON.stringify(this.scraperSettings, null, 2));
        }
        throw new ConfigurationError(errorMsg, {
            reason: "viewport_config_invalid_launchbrowser",
            viewport: this.scraperSettings?.puppeteerViewport
        });
    }

    const launchOptions: CustomPuppeteerLaunchOptions = {
      // Pass the headless value directly; cast to `any` to satisfy TS if "new" is not in official types
      // but is supported by the runtime version of Puppeteer.
      headless: this.scraperSettings.puppeteerHeadless as any,
      executablePath: this.scraperSettings.puppeteerExecutablePath,
      timeout: this.scraperSettings.puppeteerLaunchTimeout,
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
    };

    if (proxyDetails && proxyDetails.server) {
      try {
        const parsedProxyUrl = new URL(proxyDetails.server);
        const proxyHostPort = `${parsedProxyUrl.hostname}:${parsedProxyUrl.port || (parsedProxyUrl.protocol === 'https:' ? '443' : '80')}`;
        if (launchOptions.args) {
            launchOptions.args.push(`--proxy-server=${proxyHostPort}`);
        }
        logger.info(`[PuppeteerController launchBrowser] Using proxy for Puppeteer: ${proxyHostPort}`);
      } catch (e: any) {
        logger.error(`[PuppeteerController launchBrowser] Invalid proxy server string for Puppeteer: ${proxyDetails.server}. Error: ${e.message}`);
        throw new ConfigurationError(`Invalid proxy server string format for Puppeteer`, { proxyServer: proxyDetails.server, originalErrorName: e.name, originalErrorMessage: e.message });
      }
    }

    await this.pluginManager.configureLaunchOptions(launchOptions as DefaultPuppeteerLaunchOptions);
    if (logger.isDebugging()) {
        logger.debug('[PuppeteerController launchBrowser] Effective launch options after PluginManager:', launchOptions);
    }

    try {
      const browser = await puppeteer.launch(launchOptions as DefaultPuppeteerLaunchOptions);
      logger.info('[PuppeteerController launchBrowser] Puppeteer browser launched successfully.');
      if (logger.isDebugging()) {
        logger.debug(`[PuppeteerController launchBrowser] Browser version: ${await browser.version()}, Endpoint: ${browser.wsEndpoint()}`);
      }
      return browser;
    } catch (error: any) {
      logger.error(`[PuppeteerController launchBrowser] Failed to launch Puppeteer browser: ${error.message}`);
      if (logger.isDebugging()) {
        logger.error('[DEBUG_MODE] Full error during Puppeteer browser launch:', error);
      }
      throw new NetworkError('Failed to launch Puppeteer browser', { originalErrorName: error.name, originalErrorMessage: error.message, stack: error.stack });
    }
  }

  async newPage(browser: Browser, userAgentString: string | null = null): Promise<Page> {
    logger.debug('[PuppeteerController newPage] Creating new page.');
    try {
      const page = await browser.newPage();
      
      if (!this.scraperSettings?.puppeteerViewport?.width || !this.scraperSettings?.puppeteerViewport?.height) {
        const errorMsg = `Puppeteer viewport configuration is missing or invalid in newPage. Viewport: ${JSON.stringify(this.scraperSettings?.puppeteerViewport)}`;
        logger.error(`[PuppeteerController newPage] ${errorMsg}`);
        throw new ConfigurationError(errorMsg, { reason: "viewport_config_invalid_newpage" });
      }

      await page.setViewport({
        width: this.scraperSettings.puppeteerViewport.width,
        height: this.scraperSettings.puppeteerViewport.height,
        deviceScaleFactor: this.scraperSettings.puppeteerViewport.deviceScaleFactor || 1,
        isMobile: this.scraperSettings.puppeteerViewport.isMobile || false,
        hasTouch: this.scraperSettings.puppeteerViewport.hasTouch || false,
        isLandscape: this.scraperSettings.puppeteerViewport.isLandscape || false,
      });

      const uaToSet = userAgentString || this.scraperSettings.defaultUserAgent;
      await page.setUserAgent(uaToSet);
      logger.info(`[PuppeteerController newPage] New page created. User-Agent set to: ${uaToSet}`);
      if (logger.isDebugging()) {
        const target = page.target() as Target & { _targetId?: string };
        logger.debug(`[PuppeteerController newPage] Page target ID: ${target._targetId}`);
      }

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        // @ts-ignore
        delete navigator.__proto__.webdriver;
        
        Object.defineProperty(navigator, 'plugins', {
            get: () => [
                { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format", mimeTypes: [{ type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format" }] },
                { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "", mimeTypes: [{ type: "application/pdf", suffixes: "pdf", description: "" }] },
                { name: "Native Client", filename: "internal-nacl-plugin", description: "", mimeTypes: [{ type: "application/x-nacl", suffixes: "", description: "Native Client Executable" },{ type: "application/x-pnacl", suffixes: "", description: "Portable Native Client Executable" }] }
            ],
        });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      });
      if (logger.isDebugging()) {
        logger.debug('[PuppeteerController newPage] Anti-detection measures applied.');
      }

      return page;
    } catch (error: any) {
      logger.error(`[PuppeteerController newPage] Failed to create new Puppeteer page: ${error.message}`);
      if (logger.isDebugging()) {
        logger.error('[DEBUG_MODE] Full error during newPage creation:', error);
      }
      throw new NetworkError('Failed to create new Puppeteer page', { originalErrorName: error.name, originalErrorMessage: error.message, stack: error.stack });
    }
  }

  async launchAndNavigate(
    url: string,
    proxyDetails: ProxyDetails | null = null,
    userAgentString: string | null = null,
    waitConditions: PuppeteerLifeCycleEvent | PuppeteerLifeCycleEvent[] | null = null,
    isInitialProbe: boolean = false
  ): Promise<{ browser: Browser; page: Page }> {
    logger.debug(`[PuppeteerController launchAndNavigate] Entry. URL: ${url}, isInitialProbe: ${isInitialProbe}`);
    let browser: Browser | null = null;
    let page: Page | null = null;
    try {
      browser = await this.launchBrowser(proxyDetails);
      page = await this.newPage(browser, userAgentString);

      if (proxyDetails && proxyDetails.username && proxyDetails.password) {
        if (logger.isDebugging()) {
            logger.debug('[PuppeteerController launchAndNavigate] Authenticating proxy...');
        }
        await page.authenticate({
          username: decodeURIComponent(proxyDetails.username),
          password: decodeURIComponent(proxyDetails.password),
        });
        logger.info('[PuppeteerController launchAndNavigate] Proxy authentication set.');
      }

      await this.navigate(page, url, waitConditions, isInitialProbe);
      logger.info(`[PuppeteerController launchAndNavigate] Successfully launched and navigated to ${url}`);
      return { browser, page };
    } catch (error: any) {
      logger.error(`[PuppeteerController launchAndNavigate] Launch or navigation failed for ${url}: ${error.message} (Error Name: ${error.name})`);
      if (logger.isDebugging()) {
        logger.error(`[DEBUG_MODE] Full error in launchAndNavigate for ${url}:`, error);
        if (error.stack) logger.debug(`[DEBUG_MODE] Stack: ${error.stack}`);
      }
      if (page && !page.isClosed()) {
        try { await page.close(); logger.debug('[PuppeteerController launchAndNavigate] Page closed during error handling.'); }
        catch (closeError: any) { logger.warn(`[PuppeteerController launchAndNavigate] Error closing page during error handling: ${closeError.message}`); }
      }
      if (browser && browser.isConnected()) {
        try { await browser.close(); logger.debug('[PuppeteerController launchAndNavigate] Browser closed during error handling.'); }
        catch (browserCloseError: any) { logger.warn(`[PuppeteerController launchAndNavigate] Error closing browser during error handling: ${browserCloseError.message}`); }
      }
      if (error instanceof ScraperError) throw error;
      throw new NetworkError(`Unexpected error during launch and navigation for ${url}: ${error.message}`, { originalErrorName: error.name, originalErrorMessage: error.message, stack: error.stack });
    }
  }

  async navigate(
    page: Page,
    url: string,
    waitConditions: PuppeteerLifeCycleEvent | PuppeteerLifeCycleEvent[] | null = null,
    isInitialProbe: boolean = false
  ): Promise<HTTPResponse | null> {
    logger.debug(`[PuppeteerController navigate] Navigating to: ${url}. isInitialProbe: ${isInitialProbe}`);
    let htmlContentOnError: string | null = null;
    try {
      const navigationOptions = {
        waitUntil: waitConditions || (isInitialProbe ? (['domcontentloaded', 'networkidle2'] as PuppeteerLifeCycleEvent[]) : (['load', 'networkidle0'] as PuppeteerLifeCycleEvent[])),
        timeout: this.scraperSettings.puppeteerNavigationTimeout,
      };
      if (logger.isDebugging()) {
        logger.debug(`[PuppeteerController navigate] Navigation options: ${JSON.stringify(navigationOptions)}`);
      }
      const response = await page.goto(url, navigationOptions);
      logger.info(`[PuppeteerController navigate] Successfully navigated to ${url}. Status: ${response ? response.status() : 'N/A'}`);
      if (logger.isDebugging() && response) {
        logger.debug(`[PuppeteerController navigate] Final URL: ${page.url()}, Response headers (sample):`, response.headers()['content-type']);
      }

      await this.pluginManager.applyToPageAfterNavigation(page);
      if (logger.isDebugging()) {
        logger.debug('[PuppeteerController navigate] Post-navigation plugins applied.');
      }

      if (this.scraperSettings.puppeteerPostLoadDelay > 0) {
        if (logger.isDebugging()) {
            logger.debug(`[PuppeteerController navigate] Waiting for postLoadDelay: ${this.scraperSettings.puppeteerPostLoadDelay}ms`);
        }
        await new Promise(resolve => setTimeout(resolve, this.scraperSettings.puppeteerPostLoadDelay));
      }
      return response;
    } catch (error: any) {
      logger.error(`[PuppeteerController navigate] Navigation to ${url} failed: ${error.message}`);
      try {
        if (!page.isClosed()) {
            htmlContentOnError = await page.content();
        }
      } catch (contentError: any) {
        logger.warn(`[PuppeteerController navigate] Could not get page content after navigation error: ${contentError.message}`);
      }
      if (logger.isDebugging()) {
        logger.error(`[DEBUG_MODE] Full error during navigation to ${url}:`, error);
        if (htmlContentOnError) logger.debug(`[DEBUG_MODE] HTML content on navigation error (first 500 chars): ${htmlContentOnError.substring(0,500)}...`);
      }
      throw new NetworkError(`Navigation to ${url} failed: ${error.message}`, {
        originalErrorName: error.name,
        originalErrorMessage: error.message,
        htmlContent: htmlContentOnError ? htmlContentOnError.substring(0, 200) + '...' : undefined,
        statusCode: (error as any).response?.status(),
        finalUrlAttempted: page.isClosed() ? url : (page.url() || url)
      });
    }
  }

  async performInteractions(page: Page): Promise<void> {
    logger.debug('[PuppeteerController performInteractions] Performing generic page interactions.');
    const interactionDelay = this.scraperSettings.puppeteerInteractionDelay;
    try {
      await page.evaluate(async () => {
        await new Promise<boolean>((resolve) => {
          let totalHeight = 0;
          const distance = 100;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= scrollHeight) {
              clearInterval(timer);
              resolve(true);
            }
          }, 100);
        });
      });
      if (logger.isDebugging()) {
        logger.debug('[PuppeteerController performInteractions] Scrolled to bottom.');
      }
      if (interactionDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, interactionDelay));
        if (logger.isDebugging()) {
            logger.debug(`[PuppeteerController performInteractions] Waited for interactionDelay: ${interactionDelay}ms`);
        }
      }
      logger.info('[PuppeteerController performInteractions] Generic page interactions completed.');
    } catch (error: any) {
      if (!error.message.includes('Target closed') && !error.message.includes('Navigation failed')) {
        logger.warn(`[PuppeteerController performInteractions] Error during generic page interactions: ${error.message}`);
        if (logger.isDebugging()) {
            logger.warn('[DEBUG_MODE] Full error during performInteractions:', error);
        }
      } else {
        if (logger.isDebugging()) {
            logger.debug(`[PuppeteerController performInteractions] Interaction interrupted by navigation/closure: ${error.message}`);
        }
      }
    }
  }

  async getPageContent(page: Page): Promise<string> {
    logger.debug('[PuppeteerController getPageContent] Getting page content.');
    try {
      const content = await page.content();
      logger.info(`[PuppeteerController getPageContent] Page content retrieved. Length: ${content?.length}`);
      if (logger.isDebugging() && content) {
        logger.debug(`[PuppeteerController getPageContent] Content snippet (first 200 chars): ${content.substring(0,200)}...`);
      }
      return content;
    } catch (error: any) {
      logger.error(`[PuppeteerController getPageContent] Failed to get page content: ${error.message}`);
      if (logger.isDebugging()) {
        logger.error('[DEBUG_MODE] Full error during getPageContent:', error);
      }
      throw new NetworkError('Failed to get page content', { originalErrorName: error.name, originalErrorMessage: error.message, stack: error.stack });
    }
  }

  async queryXPathWithDetails(page: Page, xpath: string): Promise<XPathQueryDetails> {
    logger.debug(`[PuppeteerController queryXPathWithDetails] Querying XPath: ${xpath}`);
    const result: XPathQueryDetails = {
      xpath,
      element_found_count: 0,
      tagName: null,
      id: null,
      className: null,
      innerHTMLSample: '',
      textContentLength: 0,
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
      // Use a type assertion for $x if it's not found on the Page type directly
      const elements: ElementHandle<Node>[] = await (page as any).$x(xpath);
      result.element_found_count = elements.length;

      if (elements.length > 0) {
        const mainElement = elements[0];
        result.tagName = await page.evaluate(el => (el as Element).tagName.toLowerCase(), mainElement);
        result.id = await page.evaluate(el => (el as Element).id, mainElement);
        result.className = await page.evaluate(el => (el as Element).className, mainElement);
        
        const innerHTMLFull = await page.evaluate(el => (el as Element).innerHTML, mainElement);
        result.innerHTMLSample = innerHTMLFull.substring(0, 200) + (innerHTMLFull.length > 200 ? '...' : '');

        const innerContentDetails = await page.evaluate(elHandle => {
            const el = elHandle as Element;
            const unwantedTags = new Set(['nav', 'footer', 'aside', 'header', 'form', 'script', 'style', 'figcaption', 'figure', 'details', 'summary', 'menu', 'dialog']);
            let unwantedCount = 0;

            const getTextLength = (node: Node): number => {
                let len = 0;
                if (node.nodeType === Node.TEXT_NODE) {
                    len += (node.textContent || '').trim().length;
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    if (!['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED'].includes((node as Element).tagName.toUpperCase())) {
                        for (const child of Array.from(node.childNodes)) {
                            len += getTextLength(child);
                        }
                    }
                }
                return len;
            };
            
            const countTags = (parentElement: Element, tagNames: string[]): number => {
                let count = 0;
                tagNames.forEach(tagName => {
                    count += parentElement.getElementsByTagName(tagName).length;
                });
                return count;
            };

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
      }
      if (logger.isDebugging()) {
        logger.debug(`[PuppeteerController queryXPathWithDetails] XPath "${xpath}" details: found=${result.element_found_count}, tagName=${result.tagName}, pCount=${result.paragraphCount}, textLen=${result.textContentLength}`);
      }
    } catch (error: any) {
      logger.warn(`[PuppeteerController queryXPathWithDetails] Error querying XPath "${xpath}" on page: ${error.message}`);
      if (logger.isDebugging()) {
        logger.warn('[DEBUG_MODE] Full error during queryXPathWithDetails:', error);
      }
    }
    return result;
  }

  async cleanupPuppeteer(browser: Browser | null): Promise<void> {
    if (browser && browser.isConnected()) {
      logger.debug('[PuppeteerController cleanupPuppeteer] Closing Puppeteer browser.');
      try {
        await browser.close();
        logger.info('[PuppeteerController cleanupPuppeteer] Puppeteer browser closed successfully.');
      } catch (error: any) {
        logger.error(`[PuppeteerController cleanupPuppeteer] Failed to close Puppeteer browser: ${error.message}`);
        if (logger.isDebugging()) {
            logger.error('[DEBUG_MODE] Full error during browser close:', error);
        }
      }
    } else {
        if (logger.isDebugging()) {
            logger.debug('[PuppeteerController cleanupPuppeteer] Browser already closed or not provided.');
        }
    }
  }
}

export { PuppeteerController };
