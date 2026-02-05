import puppeteer, { Browser, Page } from 'puppeteer-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { BrowserPort } from '../ports/browser.js';
import type { ElementDetails, LoadPageOptions } from '../domain/models.js';
import { CAPTCHA_TYPES, DEFAULTS, type CaptchaTypeValue } from '../constants.js';
import { getExecutablePath, getExtensionPaths, getProxyServer } from '../config.js';
import { logger } from '../utils/logger.js';

interface PageSession {
  page: Page;
  browser: Browser;
  userDataDir: string;
}

export class PuppeteerBrowserAdapter implements BrowserPort {
  private sessions = new Map<string, PageSession>();
  private pageCounter = 0;

  async open(): Promise<void> {}

  async close(): Promise<void> {
    for (const [pageId] of this.sessions) {
      await this.closePage(pageId);
    }
  }

  async closePage(pageId: string): Promise<void> {
    const session = this.sessions.get(pageId);
    if (!session) return;

    try { await session.page.close(); } catch (e) {
      logger.debug('[BROWSER] Page close failed (may already be closed)', { error: String(e) });
    }
    try { await session.browser.close(); } catch (e) {
      logger.debug('[BROWSER] Browser close failed (may already be closed)', { error: String(e) });
    }
    try { await fs.promises.rm(session.userDataDir, { recursive: true, force: true }); } catch (e) {
      logger.debug('[BROWSER] User data dir cleanup failed', { error: String(e) });
    }
    this.sessions.delete(pageId);
  }

  async loadPage(url: string, options?: LoadPageOptions): Promise<{ pageId: string }> {
    const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'puppeteer-user-data-'));
    const extensionPaths = this.getExtensionPaths();
    const hasExtensions = extensionPaths.length > 0;

    const proxyServer = options?.proxy || getProxyServer();
    let proxyAuth: { username: string; password: string } | null = null;
    
    if (proxyServer) {
      logger.debug('Browser launching with proxy', {
        url,
        proxyRedacted: proxyServer.replace(/:([^:@]+)@/, ':***@'),
        explicit: !!options?.proxy
      }, 'BROWSER');
      
      // Extract auth credentials if present (http://user:pass@host:port)
      try {
        const proxyUrl = new URL(proxyServer);
        if (proxyUrl.username && proxyUrl.password) {
          proxyAuth = {
            username: proxyUrl.username,
            password: proxyUrl.password
          };
          logger.debug('Extracted proxy authentication', { username: proxyAuth.username }, 'BROWSER');
        }
      } catch (e) {
        logger.warn('Failed to parse proxy URL for auth', { error: String(e) }, 'BROWSER');
      }
    } else {
      logger.debug('Browser launching without proxy', { url }, 'BROWSER');
    }

    let browser: Browser | null = null;
    try {
      browser = await puppeteer.launch({
        executablePath: getExecutablePath(),
        headless: true,
        userDataDir,
        args: this.buildLaunchArgs(options?.proxy),
        dumpio: true,
        timeout: options?.timeout || DEFAULTS.TIMEOUT_MS
      });

      const page = await browser.newPage();
      
      // Set proxy authentication if credentials are provided
      if (proxyAuth) {
        await page.authenticate(proxyAuth);
        logger.debug('Proxy authentication set', { username: proxyAuth.username }, 'BROWSER');
      }
      
      page.on('console', msg => {
        const text = msg.text();
        // Ignore 404 errors from the page being scraped
        if (!text.includes('404') && !text.includes('Failed to load resource')) {
          logger.debug(`[BROWSER] ${text}`);
        }
      });
      await page.setUserAgent(DEFAULTS.USER_AGENT);
      await page.setViewport({ width: DEFAULTS.VIEWPORT_WIDTH, height: DEFAULTS.VIEWPORT_HEIGHT });

      if (hasExtensions) {
        await new Promise(r => setTimeout(r, 2000));
        
        // Verify extensions loaded by checking browser targets
        const targets = await browser.targets();
        const extensionTargets = targets.filter(t => t.url().includes('chrome-extension://'));
        logger.debug('Extension targets after launch', { 
          count: extensionTargets.length,
          urls: extensionTargets.map(t => t.url().split('/').slice(0, 4).join('/'))
        }, 'BROWSER');
        
        if (extensionTargets.length === 0) {
          logger.warn('No extension targets found - extensions may not have loaded', {}, 'BROWSER');
        }
      }

      await page.goto(url, {
        waitUntil: options?.waitUntil || 'networkidle2',
        timeout: options?.timeout || DEFAULTS.TIMEOUT_MS
      });

      await page.mouse.move(100, 100);
      await page.evaluate(() => window.scrollBy(0, 200));
      await new Promise(r => setTimeout(r, 1000));

      const pageId = `page-${++this.pageCounter}`;
      this.sessions.set(pageId, { page, browser, userDataDir });

      return { pageId };
    } catch (error) {
      // Cleanup on failure to prevent resource leaks
      if (browser) {
        await browser.close().catch(() => {});
      }
      await fs.promises.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  private getExtensionPaths(): string[] {
    return getExtensionPaths();
  }

  private buildLaunchArgs(explicitProxy?: string): string[] {
    const extensionPaths = this.getExtensionPaths();
    
    // Base args matching reference implementation
    const args = [
      // Security/sandbox
      '--no-sandbox',
      '--disable-setuid-sandbox',
      
      // Performance
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--use-gl=swiftshader',
      
      // Display
      '--window-size=1280,720',
      '--font-render-hinting=none',
      
      // Extension support (Chrome native flags)
      '--enable-extensions',
      '--enable-extension-assets',
      
      // Stability flags from reference
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--disable-notifications',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-web-security',
      
      // Disable images for speed
      '--blink-settings=imagesEnabled=false'
    ];

    // Add extension loading flags if extensions are configured
    // Use Chrome's native --disable-extensions-except and --load-extension flags
    if (extensionPaths.length > 0) {
      const pathList = extensionPaths.join(',');
      args.push(`--disable-extensions-except=${pathList}`);
      args.push(`--load-extension=${pathList}`);
      logger.debug('Extension flags added', { count: extensionPaths.length, paths: extensionPaths }, 'BROWSER');
    }

    // Priority: explicit proxy > global PROXY_SERVER
    const proxyServer = explicitProxy || getProxyServer();
    if (proxyServer) {
      // Extract host:port only (no credentials in --proxy-server flag)
      try {
        const proxyUrl = new URL(proxyServer);
        const proxyHostPort = `${proxyUrl.hostname}:${proxyUrl.port || '80'}`;
        args.push(`--proxy-server=${proxyHostPort}`);
        logger.debug('Added proxy-server arg', { proxyHostPort }, 'BROWSER');
      } catch (e) {
        logger.warn('Failed to parse proxy URL', { proxyServer, error: String(e) }, 'BROWSER');
      }
    }

    return args;
  }

  // XPath validation constants
  private static readonly MAX_XPATH_LENGTH = 500;
  private static readonly ALLOWED_XPATH_PATTERN = /^[\w\-\/\[\]@="'\s\.\(\)\|\*\:,]+$/;

  private validateXPath(xpath: string): boolean {
    if (!xpath || xpath.length > PuppeteerBrowserAdapter.MAX_XPATH_LENGTH) return false;
    return PuppeteerBrowserAdapter.ALLOWED_XPATH_PATTERN.test(xpath);
  }

  async evaluateXPath(pageId: string, xpath: string): Promise<string[] | null> {
    // Validate XPath before processing
    if (!this.validateXPath(xpath)) {
      logger.warn('[BROWSER] Invalid XPath rejected', { xpath: xpath.slice(0, 50) });
      return null;
    }

    const session = this.sessions.get(pageId);
    if (!session) return null;

    try {
      return await session.page.evaluate((xpathSelector) => {
        console.log(`Evaluating XPath: ${xpathSelector}`);
        const body = document.querySelector('body');
        console.log(`Body check: ${!!body}`);

        try {
            // XPathResult.ORDERED_NODE_SNAPSHOT_TYPE = 7
            const result = document.evaluate(xpathSelector, document, null, 7, null);
            const results: string[] = [];
            console.log(`Snapshot length: ${result.snapshotLength}`);

            for (let i = 0; i < result.snapshotLength; i++) {
                const node = result.snapshotItem(i);
                if (!node) continue;
                
                let val: string | null = null;
                if (node.nodeType === 1) val = (node as Element).outerHTML;
                else if (node.nodeType === 2 || node.nodeType === 3) val = node.nodeValue;

                if (val) results.push(val);
            }
            return results;
        } catch (e) {
            console.error('Evaluate error:', e instanceof Error ? e.message : String(e));
            return [];
        }
      }, xpath);
    } catch (e) {
      logger.error('Puppeteer evaluate error:', e);
      return null;
    }
  }

  async getPageHtml(pageId: string): Promise<string> {
    const session = this.sessions.get(pageId);
    if (!session) return '';
    return await session.page.content();
  }

  async detectCaptcha(pageId: string): Promise<import('../ports/browser.js').CaptchaDetectionResult> {
    const session = this.sessions.get(pageId);
    if (!session) return { type: CAPTCHA_TYPES.NONE };

    const html = await session.page.content();

    // DataDome detection - extract iframe URL
    if (html.includes('captcha-delivery.com') || html.includes('geo.captcha-delivery.com')) {
      // Extract the iframe src URL
      const captchaUrl = await session.page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="captcha-delivery.com"]');
        return iframe?.getAttribute('src') || undefined;
      });
      
      logger.debug('DataDome iframe URL extracted', { captchaUrl }, 'CAPTCHA');
      return { type: CAPTCHA_TYPES.DATADOME, captchaUrl };
    }

    // Cloudflare detection
    if (html.includes('cf-turnstile') || 
        html.includes('cf-challenge') || 
        html.includes('challenges.cloudflare.com')) {
      // Extract Turnstile sitekey
      const siteKey = await session.page.evaluate(() => {
        const el = document.querySelector('[data-sitekey]');
        return el?.getAttribute('data-sitekey') || undefined;
      });
      return { type: CAPTCHA_TYPES.CLOUDFLARE, siteKey };
    }

    // Only treat reCAPTCHA/hCaptcha as blocking if it's a challenge page
    // (visible captcha in a minimal page), not just present for comments/login
    if (html.includes('g-recaptcha') || html.includes('h-captcha')) {
      const isBlockingCaptcha = await session.page.evaluate(() => {
        // Check if page has minimal content (likely a challenge page)
        const bodyText = document.body?.innerText?.trim() || '';
        const hasMinimalContent = bodyText.length < 500;
        
        // Check if recaptcha is visible and prominent
        const recaptcha = document.querySelector('.g-recaptcha, .h-captcha, [data-sitekey]');
        if (!recaptcha) return false;
        
        const rect = recaptcha.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;
        
        return hasMinimalContent && isVisible;
      });
      
      if (isBlockingCaptcha) {
        const siteKey = await session.page.evaluate(() => {
          const el = document.querySelector('.g-recaptcha[data-sitekey], .h-captcha[data-sitekey], [data-sitekey]');
          return el?.getAttribute('data-sitekey') || undefined;
        });
        return { type: CAPTCHA_TYPES.GENERIC, siteKey };
      }
    }

    return { type: CAPTCHA_TYPES.NONE };
  }

  async getElementDetails(pageId: string, xpath: string): Promise<ElementDetails | null> {
    const session = this.sessions.get(pageId);
    if (!session) return null;

    try {
      return await session.page.evaluate((xpathSelector) => {
        const result = document.evaluate(xpathSelector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const element = result.singleNodeValue as Element | null;
        if (!element) return null;

        const text = element.textContent || '';
        const links = element.querySelectorAll('a');
        const linkText = Array.from(links).map(a => a.textContent || '').join('');

        return {
          xpath: xpathSelector,
          textLength: text.length,
          linkDensity: text.length > 0 ? linkText.length / text.length : 0,
          paragraphCount: element.querySelectorAll('p').length,
          headingCount: element.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
          hasMedia: element.querySelectorAll('img,video,audio').length > 0,
          domDepth: (() => {
            let depth = 0;
            let el: Element | null = element;
            while (el) { depth++; el = el.parentElement; }
            return depth;
          })(),
          semanticScore: ['article', 'main', 'section'].includes(element.tagName.toLowerCase()) ? 1 : 0,
          unwantedTagScore: ['nav', 'aside', 'footer', 'header'].includes(element.tagName.toLowerCase()) ? 1 : 0
        };
      }, xpath);
    } catch {
      return null;
    }
  }

  async getCookies(pageId: string): Promise<string> {
    const session = this.sessions.get(pageId);
    if (!session) return '';
    const cookies = await session.page.cookies();
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  async setCookies(pageId: string, cookieStr: string): Promise<void> {
    const session = this.sessions.get(pageId);
    if (!session) return;

    const url = session.page.url();
    const domain = new URL(url).hostname;

    const cookies = cookieStr.split(';').map(pair => {
      const [name, ...rest] = pair.trim().split('=');
      return { name, value: rest.join('='), domain };
    });

    await session.page.setCookie(...cookies);
  }

  async reload(pageId: string, timeoutMs?: number): Promise<void> {
    const session = this.sessions.get(pageId);
    if (!session) return;
    await session.page.reload({
      waitUntil: 'networkidle2',
      timeout: timeoutMs ?? DEFAULTS.TIMEOUT_MS
    });
  }

  async injectTurnstileToken(pageId: string, token: string): Promise<void> {
    const session = this.sessions.get(pageId);
    if (!session) return;

    await session.page.evaluate((turnstileToken) => {
      // Try cf-turnstile-response input first
      const cfInput = document.querySelector('input[name="cf-turnstile-response"]');
      if (cfInput) {
        (cfInput as HTMLInputElement).value = turnstileToken;
      }
      
      // Also try g-recaptcha-response for compatibility mode
      const gInput = document.querySelector('input[name="g-recaptcha-response"]');
      if (gInput) {
        (gInput as HTMLInputElement).value = turnstileToken;
      }

      // Try to find and execute callback if available
      if ((window as unknown as { tsCallback?: (token: string) => void }).tsCallback) {
        (window as unknown as { tsCallback: (token: string) => void }).tsCallback(turnstileToken);
      }
    }, token);

    logger.debug('Injected Turnstile token', { pageId }, 'BROWSER');
  }
}
