import { describe, it, expect, beforeEach, vi } from 'vitest';
import { scrapeRouter } from './scrape.js';

vi.mock('../../config.js', () => ({
  getApiToken: () => 'test-api-token'
}));

vi.mock('../../core/engine.js', () => ({
  getDefaultEngine: () => ({
    scrapeUrl: vi.fn().mockResolvedValue({
      success: true,
      method: 'puppeteer_stealth',
      xpath: '//article',
      data: 'Extracted content'
    })
  })
}));

describe('scrape route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject requests without authorization', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: 'https://example.com' })
    });

    const res = await scrapeRouter.request(req);
    
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('should accept requests with valid bearer token', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-api-token'
      },
      body: JSON.stringify({ url: 'https://example.com' })
    });

    const res = await scrapeRouter.request(req);
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
  });

  it('should validate URL format', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-api-token'
      },
      body: JSON.stringify({ url: 'not-a-valid-url' })
    });

    const res = await scrapeRouter.request(req);
    
    expect(res.status).toBe(400);
  });

  it('should accept optional parameters', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-api-token'
      },
      body: JSON.stringify({
        url: 'https://example.com',
        outputType: 'markdown',
        proxyServer: 'http://proxy.example.com:8080',
        userAgent: 'Custom User Agent',
        timeoutMs: 30000,
        xpath: '//article[@id="main"]',
        debug: true
      })
    });

    const res = await scrapeRouter.request(req);
    
    expect(res.status).toBe(200);
  });

  it('should reject invalid outputType', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-api-token'
      },
      body: JSON.stringify({
        url: 'https://example.com',
        outputType: 'invalid_type'
      })
    });

    const res = await scrapeRouter.request(req);
    
    expect(res.status).toBe(400);
  });

  it('should handle all valid outputType values', async () => {
    const outputTypes = ['content_only', 'markdown', 'cleaned_html', 'full_html', 'metadata_only'];
    
    for (const outputType of outputTypes) {
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-api-token'
        },
        body: JSON.stringify({
          url: 'https://example.com',
          outputType
        })
      });

      const res = await scrapeRouter.request(req);
      expect(res.status).toBe(200);
    }
  });

  it('should require POST method', async () => {
    const req = new Request('http://localhost/', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer test-api-token'
      }
    });

    const res = await scrapeRouter.request(req);
    
    expect(res.status).toBe(404);
  });

  it('should handle missing request body', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-api-token'
      }
    });

    const res = await scrapeRouter.request(req);
    
    expect(res.status).toBe(400);
  });

  it('should handle malformed JSON', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-api-token'
      },
      body: 'not valid json'
    });

    const res = await scrapeRouter.request(req);
    
    expect(res.status).toBe(400);
  });
});
