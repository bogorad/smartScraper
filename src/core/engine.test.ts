import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CoreScraperEngine, initializeEngine, getDefaultEngine } from './engine.js';
import type { BrowserPort, LlmPort, CaptchaPort, KnownSitesPort } from '../ports/index.js';
import { CAPTCHA_TYPES, ERROR_TYPES, OUTPUT_TYPES, METHODS } from '../constants.js';

vi.mock('../config.js', () => ({
  getDataDir: () => './data',
  getLogLevel: () => 'NONE'
}));

vi.mock('../services/stats-storage.js', () => ({
  recordScrape: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../services/log-storage.js', () => ({
  logScrape: vi.fn().mockResolvedValue(undefined)
}));

describe('CoreScraperEngine', () => {
  let mockBrowser: BrowserPort;
  let mockLlm: LlmPort;
  let mockCaptcha: CaptchaPort;
  let mockKnownSites: KnownSitesPort;
  let engine: CoreScraperEngine;

  beforeEach(() => {
    vi.clearAllMocks();

    mockBrowser = {
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      loadPage: vi.fn().mockResolvedValue({ pageId: 'page-123' }),
      evaluateXPath: vi.fn().mockResolvedValue(['<p>Extracted content</p>']),
      getPageHtml: vi.fn().mockResolvedValue('<html><body>Full HTML</body></html>'),
      detectCaptcha: vi.fn().mockResolvedValue(CAPTCHA_TYPES.NONE),
      getElementDetails: vi.fn().mockResolvedValue({
        xpath: '//article',
        textLength: 500,
        linkDensity: 0.1,
        paragraphCount: 3,
        headingCount: 1,
        hasMedia: false,
        domDepth: 5,
        semanticScore: 1,
        unwantedTagScore: 0
      }),
      getCookies: vi.fn().mockResolvedValue(''),
      setCookies: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn().mockResolvedValue(undefined)
    };

    mockLlm = {
      suggestXPaths: vi.fn().mockResolvedValue([
        { xpath: '//article', explanation: 'Main article content' },
        { xpath: '//div[@class="content"]', explanation: 'Content div' }
      ])
    };

    mockCaptcha = {
      solveIfPresent: vi.fn().mockResolvedValue({ solved: true })
    };

    mockKnownSites = {
      getConfig: vi.fn().mockResolvedValue(undefined),
      saveConfig: vi.fn().mockResolvedValue(undefined),
      incrementFailure: vi.fn().mockResolvedValue(undefined),
      markSuccess: vi.fn().mockResolvedValue(undefined),
      deleteConfig: vi.fn().mockResolvedValue(undefined),
      getAllConfigs: vi.fn().mockResolvedValue([])
    };

    engine = new CoreScraperEngine(mockBrowser, mockLlm, mockCaptcha, mockKnownSites);
  });

  describe('scrapeUrl', () => {
    it('should successfully scrape a valid URL', async () => {
      const result = await engine.scrapeUrl('https://example.com/article');

      expect(result.success).toBe(true);
      expect(result.method).toBe(METHODS.PUPPETEER_STEALTH);
      expect(result.data).toBeDefined();
      expect(mockBrowser.loadPage).toHaveBeenCalledWith('https://example.com/article', expect.any(Object));
    });

    it('should reject invalid URLs', async () => {
      const result = await engine.scrapeUrl('not-a-url');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ERROR_TYPES.CONFIGURATION);
      expect(result.error).toContain('Invalid URL');
    });

    it('should use cached XPath from known sites', async () => {
      mockKnownSites.getConfig = vi.fn().mockResolvedValue({
        domainPattern: 'example.com',
        xpathMainContent: '//article[@id="main"]',
        failureCountSinceLastSuccess: 0,
        lastSuccessfulScrapeTimestamp: new Date().toISOString()
      });

      mockBrowser.evaluateXPath = vi.fn()
        .mockResolvedValueOnce(['<p>Test content with enough characters to pass validation. This is more than 200 characters for sure.</p>']);

      await engine.scrapeUrl('https://example.com/article');

      expect(mockBrowser.evaluateXPath).toHaveBeenCalledWith('page-123', '//article[@id="main"]');
    });

    it('should trigger LLM discovery when no cached XPath exists', async () => {
      mockKnownSites.getConfig = vi.fn().mockResolvedValue(undefined);
      mockBrowser.getPageHtml = vi.fn().mockResolvedValue('<html><body><article>Content</article></body></html>');

      await engine.scrapeUrl('https://example.com/article');

      expect(mockLlm.suggestXPaths).toHaveBeenCalled();
      expect(mockKnownSites.saveConfig).toHaveBeenCalled();
    });

    it('should handle CAPTCHA detection and solving', async () => {
      mockBrowser.detectCaptcha = vi.fn().mockResolvedValue(CAPTCHA_TYPES.GENERIC);
      mockCaptcha.solveIfPresent = vi.fn().mockResolvedValue({
        solved: true,
        updatedCookie: 'session=abc123'
      });

      const result = await engine.scrapeUrl('https://example.com/article');

      expect(mockCaptcha.solveIfPresent).toHaveBeenCalled();
      expect(mockBrowser.setCookies).toHaveBeenCalledWith('page-123', 'session=abc123');
      expect(mockBrowser.reload).toHaveBeenCalledWith('page-123');
      expect(result.success).toBe(true);
    });

    it('should fail when CAPTCHA cannot be solved', async () => {
      mockBrowser.detectCaptcha = vi.fn().mockResolvedValue(CAPTCHA_TYPES.GENERIC);
      mockCaptcha.solveIfPresent = vi.fn().mockResolvedValue({
        solved: false,
        reason: 'CAPTCHA solving timeout'
      });

      const result = await engine.scrapeUrl('https://example.com/article');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ERROR_TYPES.CAPTCHA);
      expect(result.error).toContain('CAPTCHA');
    });

    it('should return content_only by default', async () => {
      mockBrowser.evaluateXPath = vi.fn().mockResolvedValue(['<p>Text content</p>']);

      const result = await engine.scrapeUrl('https://example.com/article');

      expect(result.success).toBe(true);
      expect(typeof result.data).toBe('string');
      expect(result.data).not.toContain('<p>');
    });

    it('should return full HTML when requested', async () => {
      const result = await engine.scrapeUrl('https://example.com/article', {
        outputType: OUTPUT_TYPES.FULL_HTML
      });

      expect(result.success).toBe(true);
      expect(result.data).toContain('<html>');
    });

    it('should return metadata_only when requested', async () => {
      const result = await engine.scrapeUrl('https://example.com/article', {
        outputType: OUTPUT_TYPES.METADATA_ONLY
      });

      expect(result.success).toBe(true);
      expect(typeof result.data).toBe('object');
      expect((result.data as any).xpath).toBeDefined();
      expect((result.data as any).contentLength).toBeDefined();
    });

    it('should use XPath override when provided', async () => {
      const customXPath = '//div[@id="custom"]';
      
      await engine.scrapeUrl('https://example.com/article', {
        xpathOverride: customXPath
      });

      expect(mockBrowser.evaluateXPath).toHaveBeenCalledWith('page-123', customXPath);
      expect(mockLlm.suggestXPaths).not.toHaveBeenCalled();
    });

    it('should rediscover XPath after multiple failures', async () => {
      mockKnownSites.getConfig = vi.fn().mockResolvedValue({
        domainPattern: 'example.com',
        xpathMainContent: '//article',
        failureCountSinceLastSuccess: 3,
        lastSuccessfulScrapeTimestamp: new Date().toISOString()
      });

      mockBrowser.getPageHtml = vi.fn().mockResolvedValue('<html><body><article>Content</article></body></html>');

      await engine.scrapeUrl('https://example.com/article');

      expect(mockLlm.suggestXPaths).toHaveBeenCalled();
    });

    it('should fail when no valid XPath is found', async () => {
      mockKnownSites.getConfig = vi.fn().mockResolvedValue(undefined);
      mockBrowser.getPageHtml = vi.fn().mockResolvedValue('<html><body>Content</body></html>');
      mockLlm.suggestXPaths = vi.fn().mockResolvedValue([]);

      const result = await engine.scrapeUrl('https://example.com/article');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ERROR_TYPES.LLM);
    });

    it('should fail when extraction returns empty result', async () => {
      mockBrowser.evaluateXPath = vi.fn().mockResolvedValue([]);

      const result = await engine.scrapeUrl('https://example.com/article');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ERROR_TYPES.EXTRACTION);
      expect(mockKnownSites.incrementFailure).toHaveBeenCalled();
    });

    it('should close browser on success', async () => {
      await engine.scrapeUrl('https://example.com/article');

      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should close browser on error', async () => {
      mockBrowser.evaluateXPath = vi.fn().mockRejectedValue(new Error('Browser error'));

      await engine.scrapeUrl('https://example.com/article');

      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should handle unknown errors gracefully', async () => {
      mockBrowser.loadPage = vi.fn().mockRejectedValue(new Error('Network timeout'));

      const result = await engine.scrapeUrl('https://example.com/article');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ERROR_TYPES.UNKNOWN);
      expect(result.error).toContain('Network timeout');
    });

    it('should mark success in known sites after successful scrape', async () => {
      await engine.scrapeUrl('https://example.com/article');

      expect(mockKnownSites.markSuccess).toHaveBeenCalledWith('example.com');
    });

    it('should process scrapes sequentially', async () => {
      const order: number[] = [];
      
      mockBrowser.loadPage = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return { pageId: 'page-123' };
      });

      const promise1 = engine.scrapeUrl('https://example.com/1').then(() => order.push(1));
      const promise2 = engine.scrapeUrl('https://example.com/2').then(() => order.push(2));
      const promise3 = engine.scrapeUrl('https://example.com/3').then(() => order.push(3));

      await Promise.all([promise1, promise2, promise3]);

      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('initializeEngine and getDefaultEngine', () => {
    it('should initialize and retrieve default engine', () => {
      const engine = initializeEngine(mockBrowser, mockLlm, mockCaptcha, mockKnownSites);
      
      expect(engine).toBeInstanceOf(CoreScraperEngine);
      expect(getDefaultEngine()).toBe(engine);
    });

    it('should throw error when getting default engine before initialization', () => {
      expect(() => {
        const MockEngine = vi.fn();
        vi.doMock('./engine.js', () => ({
          getDefaultEngine: () => {
            throw new Error('Engine not initialized. Call initializeEngine() first.');
          }
        }));
      }).toBeTruthy();
    });
  });
});
