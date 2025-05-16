// src/browser/puppeteer-controller.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import logger from '../utils/logger.js';
// import { scraperSettings } from '../../config/index.js'; // If specific settings are needed directly

// Apply the stealth plugin
puppeteer.use(StealthPlugin());


class PuppeteerController {
    constructor(pluginManager, scraperConfig = {}) { // scraperConfig from core engine
        this.pluginManager = pluginManager; // For more advanced/custom plugin management
        this.defaultTimeout = scraperConfig.puppeteerDefaultTimeout || 30000;
        this.navigationTimeout = scraperConfig.puppeteerNavigationTimeout || 60000;
        this.networkIdleTimeout = scraperConfig.puppeteerNetworkIdleTimeout || 5000;
        this.postLoadDelay = scraperConfig.puppeteerPostLoadDelay || 2000;
        this.interactionDelay = scraperConfig.puppeteerInteractionDelay || 2000;
        this.executablePath = scraperConfig.puppeteerExecutablePath || undefined; // From config if specified
    }

    async launchBrowser(proxyDetails = null) {
        const launchOptions = {
            headless: 'new', // Or true, or false for debugging
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Common for Docker/CI environments
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                // '--single-process', // Linux only, can cause issues
                '--disable-gpu',
                // Consider adding '--window-size=1920,1080' or a common resolution
            ],
            ignoreHTTPSErrors: true, // Can be risky, but sometimes needed for problematic sites
            defaultViewport: { // A common desktop viewport
                width: 1920,
                height: 1080,
                isMobile: false,
                hasTouch: false,
                isLandscape: true
            }
        };

        if (this.executablePath) {
            launchOptions.executablePath = this.executablePath;
        }

        if (proxyDetails && proxyDetails.server) {
            launchOptions.args.push(`--proxy-server=${proxyDetails.server}`);
        }

        // Allow PluginManager to modify launch options (e.g., load extensions)
        if (this.pluginManager) {
            this.pluginManager.configureLaunchOptions(launchOptions);
        }

        logger.info('Launching Puppeteer browser with options:', launchOptions.args);
        try {
            const browser = await puppeteer.launch(launchOptions);
            logger.info('Puppeteer browser launched successfully.');
            return browser;
        } catch (error) {
            logger.error(`Failed to launch Puppeteer browser: ${error.message}`);
            throw error;
        }
    }

    async newPage(browser, userAgentString = null) {
        try {
            const page = await browser.newPage();
            if (userAgentString) {
                await page.setUserAgent(userAgentString);
            }
            // Set default timeout for operations on the page
            page.setDefaultNavigationTimeout(this.navigationTimeout);
            page.setDefaultTimeout(this.defaultTimeout);

            // Optional: Intercept requests to block resource types (images, css, fonts) for speed
            // await page.setRequestInterception(true);
            // page.on('request', (req) => {
            //     if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
            //         req.abort();
            //     } else {
            //         req.continue();
            //     }
            // });

            logger.debug('New Puppeteer page created.');
            return page;
        } catch (error) {
            logger.error(`Failed to create new Puppeteer page: ${error.message}`);
            throw error;
        }
    }

    async launchAndNavigate(url, proxyDetails = null, userAgentString = null, waitConditions = null, isInitialProbe = false) {
        const browser = await this.launchBrowser(proxyDetails);
        const page = await this.newPage(browser, userAgentString);

        try {
            await this.navigate(page, url, waitConditions, isInitialProbe);
            return { browser, page };
        } catch (error) {
            logger.error(`Navigation failed in launchAndNavigate for ${url}: ${error.message}`);
            await this.cleanupPuppeteer(browser); // Clean up if navigation fails
            throw error; // Re-throw to be caught by the engine
        }
    }

    async navigate(page, url, waitConditions = null, isInitialProbe = false) {
        logger.info(`Navigating to URL: ${url}`);
        try {
            const effectiveWaitUntil = waitConditions?.waitUntil || (isInitialProbe ? 'domcontentloaded' : 'networkidle2');
            const effectiveTimeout = waitConditions?.timeout || this.navigationTimeout;

            await page.goto(url, {
                waitUntil: effectiveWaitUntil,
                timeout: effectiveTimeout,
            });
            logger.info(`Navigation successful to: ${url} (waited for ${effectiveWaitUntil})`);

            if (!isInitialProbe) {
                // Allow PluginManager to perform actions after navigation (e.g., click GDPR)
                if (this.pluginManager) {
                    await this.pluginManager.applyToPageAfterNavigation(page);
                }
                // Perform generic interactions only if not a quick probe
                await this.performInteractions(page);
                await page.waitForTimeout(this.postLoadDelay); // Final delay
            }


        } catch (error) {
            logger.error(`Navigation to ${url} failed: ${error.message}`);
            throw error;
        }
    }

    async performInteractions(page) {
        logger.debug('Performing generic page interactions (scroll, mouse move).');
        try {
            // Simulate some scrolling
            await page.evaluate(async (delay) => {
                for (let i = 0; i < document.body.scrollHeight / 100; i += 100) {
                    window.scrollBy(0, 100);
                    await new Promise(resolve => setTimeout(resolve, 50)); // Small delay between scrolls
                }
                window.scrollTo(0, 0); // Scroll back to top
            }, this.interactionDelay / 10); // Distribute delay

            // Simulate some mouse movement
            await page.mouse.move(Math.random() * 500, Math.random() * 500);
            await page.waitForTimeout(this.interactionDelay / 4);
            await page.mouse.move(Math.random() * 500, Math.random() * 500);

            logger.debug('Generic interactions completed.');
        } catch (error) {
            logger.warn(`Error during generic page interactions: ${error.message}`);
            // Don't necessarily throw, as these are best-effort
        }
    }


    async getPageContent(page) {
        try {
            const content = await page.content();
            logger.debug('Page content retrieved.');
            return content;
        } catch (error) {
            logger.error(`Failed to get page content: ${error.message}`);
            throw error;
        }
    }

    async queryXPathWithDetails(page, xpath) {
        logger.debug(`Querying XPath: ${xpath}`);
        const result = {
            xpath: xpath,
            element_found_count: 0,
            tagName: null,
            id: null,
            className: null,
            textContentLength: 0,
            innerHTMLSnippet: null, // A snippet of innerHTML
            // Add other details needed by ContentScoringEngine
            paragraphCount: 0,
            linkCount: 0,
            imageCount: 0,
            totalDescendantElements: 0,
        };

        try {
            const elements = await page.$x(xpath);
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

                result.paragraphCount = (await firstElement.$$('p')).length;
                result.linkCount = (await firstElement.$$('a')).length;
                result.imageCount = (await firstElement.$$('img')).length;
                result.totalDescendantElements = (await firstElement.$$('*')).length;

                // Dispose of element handles to free up resources
                for (const el of elements) {
                    await el.dispose();
                }
            }
        } catch (error) {
            logger.warn(`Error querying XPath "${xpath}": ${error.message}`);
            // Don't throw, just return details with count 0 or partial info
        }
        return result;
    }

    async cleanupPuppeteer(browser) {
        if (browser) {
            try {
                await browser.close();
                logger.info('Puppeteer browser closed successfully.');
            } catch (error) {
                logger.error(`Failed to close Puppeteer browser: ${error.message}`);
                // May need to forcefully kill process if close hangs, but that's more complex
            }
        }
    }
}

export { PuppeteerController };
