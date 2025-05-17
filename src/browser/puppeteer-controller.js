// src/browser/puppeteer-controller.js
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { logger } from '../utils/logger.js';
import { NetworkError, ScraperError } from '../utils/error-handler.js'; // Assuming ScraperError is a base or relevant error
import { URL } from 'url';

puppeteer.use(StealthPlugin());

class PuppeteerController {
  constructor(pluginManager, scraperConfig) {
    this.pluginManager = pluginManager;
    this.navigationTimeout = scraperConfig.puppeteerNavigationTimeout || 60000;
    this.defaultTimeout = scraperConfig.puppeteerDefaultTimeout || 30000;
    this.postLoadDelay = scraperConfig.puppeteerPostLoadDelay || 2000;
    this.interactionDelay = scraperConfig.puppeteerInteractionDelay || 1000; // Time for each interaction substep
    this.executablePath = scraperConfig.puppeteerExecutablePath;
    this.headlessMode = scraperConfig.puppeteerHeadlessMode;
    logger.debug('PuppeteerController initialized with timeouts:', {
      nav: this.navigationTimeout,
      default: this.defaultTimeout,
      postLoad: this.postLoadDelay,
      interaction: this.interactionDelay,
      headless: this.headlessMode
    });
  }

  async launchBrowser(proxyDetails = null) {
    const launchOptions = {
      executablePath: this.executablePath,
      headless: this.headlessMode,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Recommended for Docker/CI environments
        '--disable-accelerated-2d-canvas',
        '--disable-gpu', // Often recommended for headless, can sometimes be removed if issues
        '--window-size=1366,768', // A common desktop resolution
        '--ignore-certificate-errors', // Handle potential SSL issues on some sites
        // '--enable-features=NetworkService,NetworkServiceInProcess', // For newer Puppeteer versions
      ],
      dumpio: logger.level === 'debug', // If debug logging is enabled, dump browser IO
      timeout: 90000, // Browser launch timeout
      ignoreHTTPSErrors: true,
    };

    if (proxyDetails && proxyDetails.server) {
      try {
        const parsedProxyUrl = new URL(proxyDetails.server);
        const defaultPort = parsedProxyUrl.protocol === 'https:' ? 443 : 80;
        const port = parsedProxyUrl.port || defaultPort;
        const proxyHostPort = `${parsedProxyUrl.hostname}:${port}`;
        launchOptions.args.push(`--proxy-server=${proxyHostPort}`);
        logger.info(`Puppeteer: Using proxy server ${proxyHostPort}`);
        // Store credentials on the browser context after launch if needed
        if (parsedProxyUrl.username) {
            // This will be applied to the default browser context later
            launchOptions.proxyCredentials = {
                username: decodeURIComponent(parsedProxyUrl.username),
                password: decodeURIComponent(parsedProxyUrl.password || "")
            };
        }
      } catch (e) {
        logger.error(`Invalid proxy server string for Puppeteer: ${proxyDetails.server}. Error: ${e.message}`);
        // Decide if to throw or continue without proxy
        throw new NetworkError(`Invalid proxy server string format for Puppeteer`, { proxyServer: proxyDetails.server, originalError: e.message });
      }
    }

    await this.pluginManager.configureLaunchOptions(launchOptions); // PluginManager modifies launchOptions.args

    let browser;
    try {
      logger.info('Launching Puppeteer browser with options:', launchOptions.args);
      browser = await puppeteer.launch(launchOptions);
      logger.info('Puppeteer browser launched successfully.');
      // If proxy credentials were set in launchOptions, apply them to the default context
      if (launchOptions.proxyCredentials) {
          browser.defaultBrowserContext().proxyCredentials = launchOptions.proxyCredentials;
      }
      return browser;
    } catch (error) {
      logger.error(`Failed to launch Puppeteer browser: ${error.message}`);
      throw new NetworkError('Failed to launch Puppeteer browser', {
        launchOptions: JSON.stringify(launchOptions.args), // Log args for debugging
        originalError: error.message
      });
    }
  }

  async newPage(browser, userAgentString = null) {
    try {
      const page = await browser.newPage();
      if (userAgentString) {
        await page.setUserAgent(userAgentString);
      }
      page.setDefaultNavigationTimeout(this.navigationTimeout);
      page.setDefaultTimeout(this.defaultTimeout); // General timeout for operations like waitForSelector

      // Apply proxy authentication if stored on the context
      const browserContext = page.browserContext();
      if (browserContext.proxyCredentials) {
          logger.debug('Puppeteer: Setting proxy authentication for new page.');
          await page.authenticate(browserContext.proxyCredentials);
      }

      logger.debug('New Puppeteer page created.');
      return page;
    } catch (error) {
      logger.error(`Failed to create new Puppeteer page: ${error.message}`);
      throw new NetworkError('Failed to create new Puppeteer page', {
        originalError: error.message
      });
    }
  }

  async launchAndNavigate(url, proxyDetails = null, userAgentString = null, waitConditions = null, isInitialProbe = false) {
    let browser;
    let page;
    try {
      browser = await this.launchBrowser(proxyDetails);
      page = await this.newPage(browser, userAgentString);

      // Note: Proxy authentication is now handled in newPage if credentials are on browser context
      // from launchBrowser.

      await this.navigate(page, url, waitConditions, isInitialProbe);
      return { browser, page }; // Return both for further operations or cleanup
    } catch (error) {
      logger.error(`Navigation failed in launchAndNavigate for ${url}: ${error.message}`);
      if (browser) { // Ensure browser is cleaned up if launch was successful but navigation failed
        await this.cleanupPuppeteer(browser).catch(e => logger.warn(`Error cleaning up browser during launchAndNavigate failure: ${e.message}`));
      }
      // Re-throw the original error or a wrapped one
      if (error instanceof ScraperError) throw error;
      throw new NetworkError(`Navigation failed for ${url}`, {
        url,
        proxyUsed: !!proxyDetails,
        originalError: error.message,
        htmlContent: error.htmlContent // Propagate HTML if available from navigate
      });
    }
  }

  async navigate(page, url, waitConditions = null, isInitialProbe = false) {
    logger.info(`Navigating to URL: ${url}`);
    let htmlContentOnError = null;
    try {
      const effectiveWaitUntil = waitConditions?.waitUntil || (isInitialProbe ? 'domcontentloaded' : 'networkidle0');
      const timeout = waitConditions?.timeout || this.navigationTimeout;

      await page.goto(url, {
        waitUntil: effectiveWaitUntil,
        timeout: timeout
      });
      logger.info(`Navigation successful to: ${url} (waited for ${effectiveWaitUntil})`);

      // Apply plugin actions after navigation
      await this.pluginManager.applyToPageAfterNavigation(page);

      // Perform interactions only if not an initial probe or if specifically requested
      if (!isInitialProbe || waitConditions?.performInteractions) {
        await this.performInteractions(page);
        await page.waitForTimeout(this.postLoadDelay); // Wait after interactions
      } else {
        await page.waitForTimeout(500); // Brief pause even for probes
      }
    } catch (error) {
      logger.error(`Navigation to ${url} failed: ${error.message}`);
      try {
        htmlContentOnError = await page.content().catch(() => 'Could not retrieve HTML on error.');
      } catch (contentError) {
        htmlContentOnError = 'Failed to get content after navigation error.';
      }
      throw new NetworkError(`Navigation to ${url} failed`, {
        url,
        originalError: error.message,
        htmlContent: htmlContentOnError
      });
    }
  }

  async performInteractions(page) {
    logger.debug('Performing generic page interactions (scroll, mouse move).');
    try {
      if (page.isClosed()) {
        logger.warn('Attempted interactions on a closed page.');
        return;
      }
      // Simulate some mouse movement
      await page.mouse.move(Math.random() * 500 + 100, Math.random() * 500 + 100, { steps: 5 });
      await page.waitForTimeout(this.interactionDelay / 5);

      // Scroll down a bit, then up, then to a random position
      const scrollAmount = Math.floor(Math.random() * 300 + 200);
      await page.evaluate((amount) => window.scrollBy(0, amount), scrollAmount);
      await page.waitForTimeout(this.interactionDelay / 4 + Math.random() * 50);
      await page.evaluate((amount) => window.scrollBy(0, -amount / 2), scrollAmount);
      await page.waitForTimeout(this.interactionDelay / 4 + Math.random() * 50);
      await page.evaluate(() => window.scrollTo(0, Math.random() * document.body.scrollHeight / 3));
      await page.waitForTimeout(this.interactionDelay / 4 + Math.random() * 50);


      // Move mouse again
      await page.mouse.move(Math.random() * 500 + 300, Math.random() * 500 + 300, { steps: 5 });
      await page.waitForTimeout(this.interactionDelay / 5);

      logger.debug('Generic interactions completed.');
    } catch (error) {
      if (!error.message.includes('Target closed')) { // Ignore errors if page closed during interaction
        logger.warn(`Error during generic page interactions: ${error.message}`);
      }
    }
  }

  async getPageContent(page) {
    try {
      if (page.isClosed()) {
        logger.warn('Attempted to get content from a closed page.');
        return null;
      }
      const content = await page.content();
      logger.debug('Page content retrieved.');
      return content;
    } catch (error) {
      logger.error(`Failed to get page content: ${error.message}`);
      throw new NetworkError('Failed to get page content', {
        pageUrl: await page.url().catch(() => 'unknown_url'),
        originalError: error.message
      });
    }
  }

  async queryXPathWithDetails(page, xpath) {
    logger.debug(`Querying XPath: ${xpath}`);
    const result = {
      xpath: xpath, // Include the queried XPath in the result
      element_found_count: 0,
      tagName: null, id: null, className: null,
      textContentLength: 0, innerHTMLSnippet: '', innerHTML: '',
      paragraphCount: 0, linkCount: 0, imageCount: 0,
      totalDescendantElements: 0,
    };

    if (page.isClosed()) {
      logger.warn(`Attempted XPath query on a closed page: ${xpath}`);
      return result; // Return empty result
    }

    let elements = [];
    try {
      elements = await page.$x(xpath);
      result.element_found_count = elements.length;

      if (elements.length > 0) {
        const firstElement = elements[0];
        // Ensure it's an ElementHandle and not some other type
        if (firstElement && typeof firstElement.evaluate === 'function') {
          result.tagName = await firstElement.evaluate(el => el.tagName.toLowerCase());
          result.id = await firstElement.evaluate(el => el.id || null);
          result.className = await firstElement.evaluate(el => el.className || null);

          const textContent = await firstElement.evaluate(el => el.textContent || '');
          result.textContentLength = textContent.trim().length;

          const innerHTML = await firstElement.evaluate(el => el.innerHTML || '');
          result.innerHTML = innerHTML; // Store full innerHTML
          result.innerHTMLSnippet = innerHTML.substring(0, 200) + (innerHTML.length > 200 ? '...' : '');

          result.paragraphCount = (await firstElement.$$('p')).length;
          result.linkCount = (await firstElement.$$('a')).length;
          result.imageCount = (await firstElement.$$('img')).length;
          // video, audio, picture can be added if needed for mediaPresence score
          result.totalDescendantElements = (await firstElement.$$('*')).length;
        } else {
            logger.warn(`XPath "${xpath}" matched but first item is not a valid ElementHandle.`);
        }
      }
    } catch (error) {
      logger.warn(`Error querying XPath "${xpath}" on page: ${error.message}`);
      // Return partial result, error will be handled by caller if critical
    } finally {
      // Dispose of element handles to free up resources
      for (const el of elements) {
        if (el && typeof el.dispose === 'function') {
          await el.dispose().catch(e => logger.warn(`Error disposing element handle: ${e.message}`));
        }
      }
    }
    return result;
  }

  async cleanupPuppeteer(browser) {
    if (browser && browser.isConnected()) {
      try {
        await browser.close();
        logger.info('Puppeteer browser closed successfully.');
      } catch (error) {
        logger.error(`Failed to close Puppeteer browser: ${error.message}`);
        // Don't re-throw, just log, as cleanup is best-effort
      }
    } else {
      logger.debug('Puppeteer browser already closed or not connected.');
    }
  }
}

export { PuppeteerController };
