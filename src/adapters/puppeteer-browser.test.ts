import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const page = {
    authenticate: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    setViewport: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
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
    extensionPaths: [] as string[]
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
  getExecutablePath: () => '/usr/bin/chromium',
  getExtensionPaths: () => mocks.config.extensionPaths,
  getProxyServer: () => undefined
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
    mocks.config.extensionPaths = [];
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
});
