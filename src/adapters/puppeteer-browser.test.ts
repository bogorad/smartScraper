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

  return { browser, launch, page };
});

vi.mock('puppeteer-core', () => ({
  default: {
    launch: mocks.launch
  }
}));

vi.mock('../config.js', () => ({
  getExecutablePath: () => '/usr/bin/chromium',
  getExtensionPaths: () => [],
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
});
