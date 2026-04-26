import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { CAPTCHA_TYPES } from '../constants.js';

const mocks = vi.hoisted(() => {
  const page = {
    authenticate: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    setViewport: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue(''),
    mouse: {
      move: vi.fn().mockResolvedValue(undefined)
    },
    evaluate: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  };
  const browser = {
    newPage: vi.fn().mockResolvedValue(page),
    targets: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined)
  };
  const launch = vi.fn().mockResolvedValue(browser);
  const config = {
    browserConsoleCapture: false,
    browserDumpio: false,
    browserExtensionContentMaxWaitMs: 15000,
    browserExtensionContentMinLength: 1000,
    browserExtensionInitWaitMs: 2000,
    browserNonExtensionPostNavWaitMs: 3000,
    browserUnsafeNoSandbox: false,
    extensionPaths: [] as string[],
    proxyServer: undefined as string | undefined
  };

  return { browser, config, launch, page };
});

vi.mock('puppeteer-core', () => ({
  default: {
    launch: mocks.launch
  }
}));

vi.mock('../config.js', () => ({
  getBrowserConsoleCapture: () => mocks.config.browserConsoleCapture,
  getBrowserDumpio: () => mocks.config.browserDumpio,
  getBrowserExtensionContentMaxWaitMs: () => mocks.config.browserExtensionContentMaxWaitMs,
  getBrowserExtensionContentMinLength: () => mocks.config.browserExtensionContentMinLength,
  getBrowserExtensionInitWaitMs: () => mocks.config.browserExtensionInitWaitMs,
  getBrowserNonExtensionPostNavWaitMs: () => mocks.config.browserNonExtensionPostNavWaitMs,
  getBrowserUnsafeNoSandbox: () => mocks.config.browserUnsafeNoSandbox,
  getExecutablePath: () => '/usr/bin/chromium',
  getExtensionPaths: () => mocks.config.extensionPaths,
  getProxyServer: () => mocks.config.proxyServer
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('PuppeteerBrowserAdapter', () => {
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.browserConsoleCapture = false;
    mocks.config.browserDumpio = false;
    mocks.config.browserExtensionContentMaxWaitMs = 15000;
    mocks.config.browserExtensionContentMinLength = 1000;
    mocks.config.browserExtensionInitWaitMs = 2000;
    mocks.config.browserNonExtensionPostNavWaitMs = 3000;
    mocks.config.browserUnsafeNoSandbox = false;
    mocks.config.extensionPaths = [];
    mocks.config.proxyServer = undefined;
    mocks.page.content.mockResolvedValue('');
    mocks.page.evaluate.mockResolvedValue(undefined);
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: (...args: unknown[]) => void,
      _timeout?: number,
      ...args: unknown[]
    ) => {
      callback(...args);
      return 0;
    }) as typeof setTimeout);
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
  });

  it('applies custom user-agent and headers before navigation', async () => {
    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    await adapter.loadPage('https://example.com/article', {
      userAgentString: 'Custom UA',
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Test': 'yes'
      }
    });

    expect(mocks.page.setUserAgent).toHaveBeenCalledWith('Custom UA');
    expect(mocks.page.setExtraHTTPHeaders).toHaveBeenCalledWith({
      'Accept-Language': 'en-US,en;q=0.9',
      'X-Test': 'yes'
    });
    expect(mocks.page.setUserAgent.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.page.goto.mock.invocationCallOrder[0]
    );
    expect(mocks.page.setExtraHTTPHeaders.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.page.goto.mock.invocationCallOrder[0]
    );
  });

  it('keeps noisy browser output disabled by default', async () => {
    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    await adapter.loadPage('https://example.com/article');

    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({ dumpio: false }));
    expect(mocks.page.on).not.toHaveBeenCalledWith('console', expect.any(Function));
  });

  it('enables dumpio and page console capture when configured', async () => {
    mocks.config.browserConsoleCapture = true;
    mocks.config.browserDumpio = true;

    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    await adapter.loadPage('https://example.com/article');

    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({ dumpio: true }));
    expect(mocks.page.on).toHaveBeenCalledWith('console', expect.any(Function));
  });

  it('preserves the SOCKS5 scheme in the Chromium proxy argument', async () => {
    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    await adapter.loadPage('https://example.com/article', {
      proxy: 'socks5://r5s.bruc:10801'
    });

    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['--proxy-server=socks5://r5s.bruc:10801'])
    }));
  });

  it('keeps Chromium sandbox and web security enabled by default', async () => {
    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    await adapter.loadPage('https://example.com/article');

    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.not.arrayContaining([
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security'
      ])
    }));
  });

  it('allows explicit unsafe Chromium sandbox disablement', async () => {
    mocks.config.browserUnsafeNoSandbox = true;

    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    await adapter.loadPage('https://example.com/article');

    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security'
      ])
    }));
  });

  it('uses the configured default proxy when no page proxy option is set', async () => {
    mocks.config.proxyServer = 'socks5://default.example:1080';

    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    await adapter.loadPage('https://example.com/article');

    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['--proxy-server=socks5://default.example:1080'])
    }));
  });

  it('can disable the configured default proxy for one page load', async () => {
    mocks.config.proxyServer = 'socks5://default.example:1080';

    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    await adapter.loadPage('https://example.com/article', {
      proxy: false
    });

    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.not.arrayContaining(['--proxy-server=socks5://default.example:1080'])
    }));
  });

  it('rejects malformed proxy URLs before launching Chromium', async () => {
    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    await expect(adapter.loadPage('https://example.com/article', {
      proxy: 'socks5://r5s.bruc'
    })).rejects.toThrow('Invalid proxy configuration');

    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it('uses configured non-extension post-navigation wait', async () => {
    mocks.config.browserNonExtensionPostNavWaitMs = 4500;

    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    await adapter.loadPage('https://example.com/article');

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 4500);
  });

  it('uses configured extension initialization and content waits', async () => {
    mocks.config.extensionPaths = ['/tmp/ext'];
    mocks.config.browserExtensionInitWaitMs = 2500;
    mocks.config.browserExtensionContentMaxWaitMs = 16000;
    mocks.config.browserExtensionContentMinLength = 1200;
    mocks.page.evaluate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(1300);

    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    await adapter.loadPage('https://example.com/article');

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2500);
    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 3000);
  });

  it('classifies visible Turnstile without using the legacy Cloudflare solve path', async () => {
    mocks.page.content.mockResolvedValue('<div class="cf-turnstile" data-sitekey="turnstile-key"></div>');
    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    const { pageId } = await adapter.loadPage('https://example.com/challenge');
    mocks.page.evaluate.mockResolvedValueOnce('turnstile-key');
    const result = await adapter.detectCaptcha(pageId);

    expect(result).toEqual({
      type: CAPTCHA_TYPES.TURNSTILE,
      siteKey: 'turnstile-key'
    });
  });

  it('classifies visible reCAPTCHA challenge pages', async () => {
    mocks.page.content.mockResolvedValue('<div class="g-recaptcha" data-sitekey="recaptcha-key"></div>');
    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    const { pageId } = await adapter.loadPage('https://example.com/challenge');
    mocks.page.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ type: 'recaptcha', siteKey: 'recaptcha-key' });
    const result = await adapter.detectCaptcha(pageId);

    expect(result).toEqual({
      type: CAPTCHA_TYPES.RECAPTCHA,
      siteKey: 'recaptcha-key'
    });
  });

  it('classifies visible hCaptcha challenge pages', async () => {
    mocks.page.content.mockResolvedValue('<div class="h-captcha" data-sitekey="hcaptcha-key"></div>');
    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    const { pageId } = await adapter.loadPage('https://example.com/challenge');
    mocks.page.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ type: 'hcaptcha', siteKey: 'hcaptcha-key' });
    const result = await adapter.detectCaptcha(pageId);

    expect(result).toEqual({
      type: CAPTCHA_TYPES.HCAPTCHA,
      siteKey: 'hcaptcha-key'
    });
  });

  it('uses shared XPath validation for accepted xpath values', async () => {
    const acceptedXPaths = [
      "//article[@class='post-content']",
      "//div[contains(@class, 'article-body')]",
      "//main/descendant::section[1]"
    ];
    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();
    const { pageId } = await adapter.loadPage('https://example.com/article');

    for (const xpath of acceptedXPaths) {
      mocks.page.evaluate.mockClear();
      mocks.page.evaluate.mockResolvedValueOnce(['<article>content</article>']);

      const result = await adapter.evaluateXPath(pageId, xpath);

      expect(result).toEqual(['<article>content</article>']);
      expect(mocks.page.evaluate).toHaveBeenCalledWith(expect.any(Function), xpath);
    }
  });

  it('uses shared XPath validation for rejected xpath values', async () => {
    const rejectedXPaths = [
      '',
      '//div<script>',
      "//article[@class='content'",
      '//article" trailing',
      'not an xpath'
    ];
    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    for (const xpath of rejectedXPaths) {
      mocks.page.evaluate.mockClear();

      const result = await adapter.evaluateXPath('page-1', xpath);

      expect(result).toBeNull();
      expect(mocks.page.evaluate).not.toHaveBeenCalled();
    }
  });

  it('uses shared XPath validation before reading element details', async () => {
    const { PuppeteerBrowserAdapter } = await import('./puppeteer-browser.js');
    const adapter = new PuppeteerBrowserAdapter();

    const result = await adapter.getElementDetails('page-1', '//div<script>');

    expect(result).toBeNull();
    expect(mocks.page.evaluate).not.toHaveBeenCalled();
  });
});
