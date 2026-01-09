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

    try { await session.page.close(); } catch {}
    try { await session.browser.close(); } catch {}
    try { await fs.promises.rm(session.userDataDir, { recursive: true, force: true }); } catch {}
    this.sessions.delete(pageId);
  }

  async loadPage(url: string, options?: LoadPageOptions): Promise<{ pageId: string }> {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puppeteer-user-data-'));
    const extensionPaths = this.getExtensionPaths();
    const hasExtensions = extensionPaths.length > 0;

    const browser = await puppeteer.launch({
      executablePath: getExecutablePath(),
      headless: true,
      pipe: true,
      userDataDir,
      args: this.buildLaunchArgs(),
      timeout: options?.timeout || DEFAULTS.TIMEOUT_MS,
      ...(hasExtensions && { enableExtensions: extensionPaths })
    });

    const page = await browser.newPage();
    page.on('console', msg => logger.debug(`[BROWSER] ${msg.text()}`));
    await page.setUserAgent(DEFAULTS.USER_AGENT);
    await page.setViewport({ width: DEFAULTS.VIEWPORT_WIDTH, height: DEFAULTS.VIEWPORT_HEIGHT });

    if (hasExtensions) {
      await new Promise(r => setTimeout(r, 2000));
    }

    await page.goto(url, {
      waitUntil: options?.waitUntil || 'networkidle2',
      timeout: options?.timeout || 45000
    });

    await page.mouse.move(100, 100);
    await page.evaluate(() => window.scrollBy(0, 200));
    await new Promise(r => setTimeout(r, 1000));

    const pageId = `page-${++this.pageCounter}`;
    this.sessions.set(pageId, { page, browser, userDataDir });

    return { pageId };
  }

  private getExtensionPaths(): string[] {
    return getExtensionPaths();
  }

  private buildLaunchArgs(): string[] {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--use-gl=swiftshader',
      '--window-size=1280,720',
      '--font-render-hinting=none'
    ];

    const proxyServer = getProxyServer();
    if (proxyServer) {
      args.push(`--proxy-server=${proxyServer}`);
    }

    return args;
  }

  async evaluateXPath(pageId: string, xpath: string): Promise<string[] | null> {
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

  async detectCaptcha(pageId: string): Promise<CaptchaTypeValue> {
    const session = this.sessions.get(pageId);
    if (!session) return CAPTCHA_TYPES.NONE;

    const html = await session.page.content();

    if (html.includes('captcha-delivery.com') || html.includes('geo.captcha-delivery.com')) {
      return CAPTCHA_TYPES.DATADOME;
    }

    if (html.includes('g-recaptcha') || html.includes('h-captcha') || html.includes('cf-turnstile')) {
      return CAPTCHA_TYPES.GENERIC;
    }

    return CAPTCHA_TYPES.NONE;
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

  async reload(pageId: string): Promise<void> {
    const session = this.sessions.get(pageId);
    if (!session) return;
    await session.page.reload({ waitUntil: 'networkidle2' });
  }
}
