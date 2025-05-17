// src/browser/puppeteer-controller.js
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { logger } from '../utils/logger.js';
import { NetworkError } from '../utils/error-handler.js';
import { scraperSettings as globalScraperSettings } from '../../config/index.js'; // For default values

// Apply the stealth plugin
puppeteer.use(StealthPlugin());

class PuppeteerController {
  constructor(pluginManager, scraperConfig = {}) {
    this.pluginManager = pluginManager;
    this.executablePath = scraperConfig.puppeteerExecutablePath || globalScraperSettings.puppeteerExecutablePath;
    this.defaultTimeout = scraperConfig.puppeteerDefaultTimeout || globalScraperSettings.puppeteerDefaultTimeout;
    this.navigationTimeout = scraperConfig.puppeteerNavigationTimeout || globalScraperSettings.puppeteerNavigationTimeout;
    this.networkIdleTimeout = scraperConfig.puppeteerNetworkIdleTimeout || globalScraperSettings.puppeteerNetworkIdleTimeout;
    this.postLoadDelay = scraperConfig.puppeteerPostLoadDelay || globalScraperSettings.puppeteerPostLoadDelay;
    this.interactionDelay = scraperConfig.puppeteerInteractionDelay || globalScraperSettings.puppeteerInteractionDelay;

    logger.debug('PuppeteerController initialized with timeouts:', {
        default: this.defaultTimeout,
        navigation: this.navigationTimeout,
        networkIdle: this.networkIdleTimeout
    });
  }

  async launchBrowser(proxyDetails = null) {
    const launchOptions = {
      headless: process.env.PUPPETEER_HEADLESS === 'false' ? false : (process.env.PUPPETEER_HEADLESS || 'new'),
      executablePath: this.executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        // '--single-process', // Linux only, can cause issues
        '--disable-gpu',
        '--window-size=1920,1080'
      ],
      ignoreHTTPSErrors: true,
      defaultViewport: {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        isLandscape: false,
      },
    };

    if (proxyDetails && proxyDetails.server) {
      try {
        const parsedProxyUrl = new URL(proxyDetails.server);
        const proxyHostPort = `${parsedProxyUrl.hostname}:${parsedProxyUrl.port || (parsedProxyUrl.protocol === 'https:' ? '443' : '80')}`;
        launchOptions.args.push(`--proxy-server=${proxyHostPort}`);
        logger.info(`Puppeteer: Using proxy server ${proxyHostPort}`);
      } catch (e) {
        logger.error(`Invalid proxy server string for Puppeteer: ${proxyDetails.server}. Error: ${e.message}`);
        // Decide if to throw or continue without proxy
      }
    }
    
    if (this.pluginManager) {
      await this.pluginManager.configureLaunchOptions(launchOptions);
    }

    logger.info('Launching Puppeteer browser with options:', launchOptions.args);
    try {
      const browser = await puppeteer.launch(launchOptions);
      logger.info('Puppeteer browser launched successfully.');
      return browser;
    } catch (error) {
      logger.error(`Failed to launch Puppeteer browser: ${error.message}`);
      throw new NetworkError('Failed to launch Puppeteer browser', {
        launchOptions: JSON.stringify(launchOptions.args), // Only log args for brevity
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
      page.setDefaultTimeout(this.defaultTimeout);
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
    let browser = null; // Define browser here to ensure it's in scope for finally
    try {
      browser = await this.launchBrowser(proxyDetails);
      const page = await this.newPage(browser, userAgentString);

      if (proxyDetails && proxyDetails.server) {
        const parsedProxyUrl = new URL(proxyDetails.server);
        if (parsedProxyUrl.username || parsedProxyUrl.password) {
            await page.authenticate({
                username: decodeURIComponent(parsedProxyUrl.username),
                password: decodeURIComponent(parsedProxyUrl.password)
            });
            logger.info('Puppeteer: Proxy authentication set.');
        }
      }
      
      await this.navigate(page, url, waitConditions, isInitialProbe);
      return { browser, page }; // Return both so caller can manage browser or page can be detached
    } catch (error) {
      logger.error(`Navigation failed in launchAndNavigate for ${url}: ${error.message}`);
      if (browser) { // Ensure browser is closed if launchAndNavigate fails partway
        await this.cleanupPuppeteer(browser).catch(e => logger.warn(`Error cleaning up browser during launchAndNavigate failure: ${e.message}`));
      }
      if (error instanceof NetworkError) throw error;
      throw new NetworkError(`Navigation failed for ${url}`, {
        url,
        originalError: error.message
      });
    }
  }

  async navigate(page, url, waitConditions = null, isInitialProbe = false) {
    logger.info(`Navigating to URL: ${url}`);
    const effectiveWaitUntil = waitConditions?.waitUntil || (isInitialProbe ? 'domcontentloaded' : 'networkidle2');
    
    try {
      await page.goto(url, {
        waitUntil: effectiveWaitUntil,
        timeout: this.navigationTimeout,
      });
      logger.info(`Navigation successful to: ${url} (waited for ${effectiveWaitUntil})`);

      if (this.pluginManager) {
        await this.pluginManager.applyToPageAfterNavigation(page);
      }
      
      if (!isInitialProbe) { // Perform more interactions if not just a quick probe
        await this.performInteractions(page);
        await page.waitForTimeout(this.postLoadDelay);
      } else {
        await page.waitForTimeout(500); // Shorter delay for probes
      }

    } catch (error) {
      logger.error(`Navigation to ${url} failed: ${error.message}`);
      throw new NetworkError(`Navigation to ${url} failed`, {
        url,
        waitUntil: effectiveWaitUntil,
        originalError: error.message
      });
    }
  }

  async performInteractions(page) {
    logger.debug('Performing generic page interactions (scroll, mouse move).');
    try {
      await page.evaluate(async (delay) => {
        for (let i = 0; i < 5; i++) { // Scroll down a few times
          window.scrollBy(0, window.innerHeight / 2);
          await new Promise(resolve => setTimeout(resolve, delay / 5 + Math.random() * 50));
        }
        window.scrollTo(0, 0); // Scroll back to top
      }, this.interactionDelay);

      await page.mouse.move(Math.random() * 500 + 100, Math.random() * 500 + 100);
      await page.waitForTimeout(this.interactionDelay / 4);
      logger.debug('Generic interactions completed.');
    } catch (error) {
      logger.warn(`Error during generic page interactions: ${error.message}`);
    }
  }

  async getPageContent(page) {
    try {
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
      xpath,
      element_found_count: 0,
      tagName: null,
      id: null,
      className: null,
      textContentLength: 0,
      innerHTMLSnippet: null,
      paragraphCount: 0,
      linkCount: 0,
      imageCount: 0,
      totalDescendantElements: 0,
    };

    let elements = [];
    try {
      elements = await page.$x(xpath);
      result.element_found_count = elements.length;

      if (elements.length > 0) {
        const firstElement = elements[0];
        result.tagName = await page.evaluate(el => el.tagName.toLowerCase(), firstElement);
        result.id = await page.evaluate(el => el.id || null, firstElement);
        result.className = await page.evaluate(el => el.className || null, firstElement);
        
        const textContent = await page.evaluate(el => el.textContent || '', firstElement);
        result.textContentLength = textContent.trim().length;
        
        const innerHTML = await page.evaluate(el => el.innerHTML || '', firstElement);
        result.innerHTMLSnippet = innerHTML.substring(0, 200) + (innerHTML.length > 200 ? '...' : '');
        result.innerHTML = innerHTML; // Store full innerHTML for scoring if needed

        result.paragraphCount = (await firstElement.$$('p')).length;
        result.linkCount = (await firstElement.$$('a')).length;
        result.imageCount = (await firstElement.$$('img')).length;
        result.totalDescendantElements = (await firstElement.$$('*')).length;
      }
    } catch (error) {
      logger.warn(`Error querying XPath "${xpath}" on page: ${error.message}`);
      result.error = error.message; // Add error to result for feedback
    } finally {
      for (const el of elements) { // Dispose all element handles
        await el.dispose();
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
      }
    } else {
      logger.debug('Puppeteer browser already closed or not connected.');
    }
  }
}

export { PuppeteerController };
