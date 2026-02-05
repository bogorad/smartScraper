import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { TwoCaptchaAdapter } from './twocaptcha.js';
import { CAPTCHA_TYPES } from '../constants.js';

vi.mock('axios');
vi.mock('../config.js', () => ({
  getTwocaptchaApiKey: () => 'test-api-key',
  getCaptchaDefaultTimeout: () => 120,
  getCaptchaPollingInterval: () => 100,
  getLogLevel: () => 'NONE'
}));

describe('TwoCaptchaAdapter', () => {
  let adapter: TwoCaptchaAdapter;
  const mockAxios = vi.mocked(axios);

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TwoCaptchaAdapter();
  });

  describe('solveIfPresent', () => {
    it('should return unsolved for unknown CAPTCHA type', async () => {
      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.NONE
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toContain('Unknown CAPTCHA type');
    });

    it('should delegate to solveGeneric for generic CAPTCHA', async () => {
      mockAxios.get = vi.fn()
        .mockResolvedValueOnce({ data: { status: 1, request: 'captcha-123' } })
        .mockResolvedValueOnce({ data: { status: 1, request: 'solution-token' } });

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.GENERIC,
        siteKey: 'test-site-key'
      });

      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://2captcha.com/in.php',
        expect.objectContaining({
          params: expect.objectContaining({
            key: 'test-api-key',
            method: 'userrecaptcha',
            googlekey: 'test-site-key',
            pageurl: 'https://example.com'
          })
        })
      );
    });

    it('should delegate to solveDataDome for DataDome CAPTCHA', async () => {
      mockAxios.post = vi.fn()
        .mockResolvedValueOnce({ data: { taskId: 'task-123' } })
        .mockResolvedValueOnce({ data: { status: 'ready', solution: { cookie: 'datadome=abc' } } });

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.DATADOME
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://api.2captcha.com/createTask',
        expect.objectContaining({
          clientKey: 'test-api-key',
          task: expect.objectContaining({
            type: 'DataDomeSliderTask',
            websiteURL: 'https://example.com'
          })
        })
      );
    });
  });

  describe('solveGeneric', () => {
    it('should successfully solve generic CAPTCHA', async () => {
      mockAxios.get = vi.fn()
        .mockResolvedValueOnce({ data: { status: 1, request: 'captcha-123' } })
        .mockResolvedValueOnce({ data: { status: 1, request: 'solution-token' } });

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.GENERIC,
        siteKey: 'test-site-key'
      });

      expect(result.solved).toBe(true);
      expect(result.updatedCookie).toBe('solution-token');
    });

    it('should fail when siteKey is missing', async () => {
      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.GENERIC
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toContain('siteKey');
    });

    it('should handle submit failure', async () => {
      mockAxios.get = vi.fn().mockResolvedValueOnce({
        data: { status: 0, request: 'ERROR_ZERO_BALANCE' }
      });

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.GENERIC,
        siteKey: 'test-site-key'
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toBe('ERROR_ZERO_BALANCE');
    });

    it('should poll until solution is ready', async () => {
      mockAxios.get = vi.fn()
        .mockResolvedValueOnce({ data: { status: 1, request: 'captcha-123' } })
        .mockResolvedValueOnce({ data: { request: 'CAPCHA_NOT_READY' } })
        .mockResolvedValueOnce({ data: { request: 'CAPCHA_NOT_READY' } })
        .mockResolvedValueOnce({ data: { status: 1, request: 'solution-token' } });

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.GENERIC,
        siteKey: 'test-site-key'
      });

      expect(result.solved).toBe(true);
      expect(mockAxios.get).toHaveBeenCalledTimes(4);
    });

    it('should timeout when solution takes too long', async () => {
      mockAxios.get = vi.fn()
        .mockResolvedValueOnce({ data: { status: 1, request: 'captcha-123' } })
        .mockResolvedValue({ data: { request: 'CAPCHA_NOT_READY' } });

      vi.useFakeTimers();
      
      const promise = adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.GENERIC,
        siteKey: 'test-site-key'
      });

      await vi.advanceTimersByTimeAsync(130000);
      
      const result = await promise;

      expect(result.solved).toBe(false);
      expect(result.reason).toContain('Timeout');

      vi.useRealTimers();
    });

    it('should handle API errors', async () => {
      mockAxios.get = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.GENERIC,
        siteKey: 'test-site-key'
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toContain('Network error');
    });
  });

  describe('solveDataDome', () => {
    it('should successfully solve DataDome CAPTCHA', async () => {
      mockAxios.post = vi.fn()
        .mockResolvedValueOnce({ data: { taskId: 'task-123' } })
        .mockResolvedValueOnce({ data: { status: 'ready', solution: { cookie: 'datadome=abc123' } } });

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.DATADOME
      });

      expect(result.solved).toBe(true);
      expect(result.updatedCookie).toBe('datadome=abc123');
    });

    it('should include proxy details when provided', async () => {
      mockAxios.post = vi.fn()
        .mockResolvedValueOnce({ data: { taskId: 'task-123' } })
        .mockResolvedValueOnce({ data: { status: 'ready', solution: { cookie: 'datadome=abc' } } });

      await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.DATADOME,
        proxyDetails: { server: 'http://proxy.example.com:8080' }
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://api.2captcha.com/createTask',
        expect.objectContaining({
          task: expect.objectContaining({
            proxyType: 'http',
            proxyAddress: 'proxy.example.com',
            proxyPort: 8080
          })
        })
      );
    });

    it('should handle task creation failure', async () => {
      mockAxios.post = vi.fn().mockResolvedValueOnce({
        data: { errorDescription: 'Invalid client key' }
      });

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.DATADOME
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toContain('Invalid client key');
    });

    it('should poll until task is ready', async () => {
      mockAxios.post = vi.fn()
        .mockResolvedValueOnce({ data: { taskId: 'task-123' } })
        .mockResolvedValueOnce({ data: { status: 'processing' } })
        .mockResolvedValueOnce({ data: { status: 'processing' } })
        .mockResolvedValueOnce({ data: { status: 'ready', solution: { cookie: 'datadome=abc' } } });

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.DATADOME
      });

      expect(result.solved).toBe(true);
      expect(mockAxios.post).toHaveBeenCalledTimes(4);
    });

    it('should handle error status from task result', async () => {
      mockAxios.post = vi.fn()
        .mockResolvedValueOnce({ data: { taskId: 'task-123' } })
        .mockResolvedValueOnce({ data: { status: 'error', errorDescription: 'Task failed' } });

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.DATADOME
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toContain('Task failed');
    });

    it('should handle missing cookie in solution', async () => {
      mockAxios.post = vi.fn()
        .mockResolvedValueOnce({ data: { taskId: 'task-123' } })
        .mockResolvedValueOnce({ data: { status: 'ready', solution: {} } });

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.DATADOME
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toContain('missing cookie');
    });

    it('should timeout when DataDome solving takes too long', async () => {
      mockAxios.post = vi.fn()
        .mockResolvedValueOnce({ data: { taskId: 'task-123' } })
        .mockResolvedValue({ data: { status: 'processing' } });

      vi.useFakeTimers();
      
      const promise = adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.DATADOME
      });

      await vi.advanceTimersByTimeAsync(130000);
      
      const result = await promise;

      expect(result.solved).toBe(false);
      expect(result.reason).toContain('Timeout');

      vi.useRealTimers();
    });

    it('should map known error codes to user-friendly messages', async () => {
      mockAxios.post = vi.fn()
        .mockResolvedValueOnce({ data: { taskId: 'task-123' } })
        .mockResolvedValueOnce({ data: { errorCode: 'ERROR_CAPTCHA_UNSOLVABLE', errorId: 1 } });

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.DATADOME
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toBe('CAPTCHA could not be solved');
    });
  });

  describe('solveTurnstile', () => {
    it('should successfully solve Turnstile CAPTCHA', async () => {
      mockAxios.post = vi.fn()
        .mockResolvedValueOnce({ data: { taskId: 'task-123' } })
        .mockResolvedValueOnce({ data: { status: 'ready', solution: { token: 'turnstile-token-abc' } } });

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.CLOUDFLARE,
        siteKey: 'test-site-key'
      });

      expect(result.solved).toBe(true);
      expect(result.token).toBe('turnstile-token-abc');
    });

    it('should fail when siteKey is missing', async () => {
      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.CLOUDFLARE
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toContain('siteKey');
    });

    it('should create Turnstile task with correct parameters', async () => {
      mockAxios.post = vi.fn()
        .mockResolvedValueOnce({ data: { taskId: 'task-123' } })
        .mockResolvedValueOnce({ data: { status: 'ready', solution: { token: 'token' } } });

      await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.CLOUDFLARE,
        siteKey: 'turnstile-site-key'
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://api.2captcha.com/createTask',
        expect.objectContaining({
          clientKey: 'test-api-key',
          task: expect.objectContaining({
            type: 'TurnstileTaskProxyless',
            websiteURL: 'https://example.com',
            websiteKey: 'turnstile-site-key'
          })
        })
      );
    });

    it('should map known error codes to user-friendly messages', async () => {
      mockAxios.post = vi.fn()
        .mockResolvedValueOnce({ data: { taskId: 'task-123' } })
        .mockResolvedValueOnce({ data: { errorCode: 'ERROR_CAPTCHA_UNSOLVABLE', errorId: 1 } });

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.CLOUDFLARE,
        siteKey: 'test-site-key'
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toBe('CAPTCHA could not be solved');
    });

    it('should map proxy error codes correctly', async () => {
      mockAxios.post = vi.fn()
        .mockResolvedValueOnce({ data: { taskId: 'task-123' } })
        .mockResolvedValueOnce({ data: { errorCode: 'ERROR_PROXY_CONNECTION_FAILED', errorId: 1 } });

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.CLOUDFLARE,
        siteKey: 'test-site-key'
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toBe('Proxy connection failed');
    });

    it('should fall back to errorDescription when code is unknown', async () => {
      mockAxios.post = vi.fn()
        .mockResolvedValueOnce({ data: { taskId: 'task-123' } })
        .mockResolvedValueOnce({ data: { errorCode: 'NEW_ERROR_CODE', errorDescription: 'Custom error message', errorId: 1 } });

      const result = await adapter.solveIfPresent({
        pageId: 'page-123',
        pageUrl: 'https://example.com',
        captchaTypeHint: CAPTCHA_TYPES.CLOUDFLARE,
        siteKey: 'test-site-key'
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toBe('Custom error message');
    });
  });
});
