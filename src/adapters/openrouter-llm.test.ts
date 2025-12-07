import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { OpenRouterLlmAdapter } from './openrouter-llm.js';

vi.mock('axios');
vi.mock('../config.js', () => ({
  getOpenrouterApiKey: () => 'test-api-key',
  getLlmModel: () => 'test-model',
  getLlmTemperature: () => 0,
  getLlmHttpReferer: () => 'https://example.com',
  getLlmXTitle: () => 'Test App'
}));

describe('OpenRouterLlmAdapter', () => {
  let adapter: OpenRouterLlmAdapter;
  const mockAxios = vi.mocked(axios);

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenRouterLlmAdapter();
  });

  describe('suggestXPaths', () => {
    it('should return XPath suggestions from valid API response', async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content: '["//article[@class=\'main\']", "//div[@id=\'content\']", "//main"]'
              }
            }
          ]
        }
      });

      const result = await adapter.suggestXPaths({
        simplifiedDom: '<html><body><article class="main">Content</article></body></html>',
        snippets: ['Sample content text'],
        url: 'https://example.com/article'
      });

      expect(result).toHaveLength(3);
      expect(result[0].xpath).toBe("//article[@class='main']");
      expect(result[1].xpath).toBe("//div[@id='content']");
      expect(result[2].xpath).toBe('//main');
    });

    it('should send correct request to OpenRouter API', async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          choices: [{ message: { content: '["//article"]' } }]
        }
      });

      await adapter.suggestXPaths({
        simplifiedDom: '<html><body><article>Content</article></body></html>',
        snippets: ['Sample text'],
        url: 'https://example.com/article'
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          model: 'test-model',
          temperature: 0,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ role: 'user' })
          ])
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          }),
          timeout: 30000
        })
      );
    });

    it('should include snippets in user prompt', async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          choices: [{ message: { content: '["//article"]' } }]
        }
      });

      await adapter.suggestXPaths({
        simplifiedDom: '<html><body><article>Content</article></body></html>',
        snippets: ['First snippet', 'Second snippet'],
        url: 'https://example.com/article'
      });

      const calls = (mockAxios.post as any).mock.calls;
      const userMessage = calls[0][1].messages[1].content;
      
      expect(userMessage).toContain('First snippet');
      expect(userMessage).toContain('Second snippet');
    });

    it('should include URL in user prompt', async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          choices: [{ message: { content: '["//article"]' } }]
        }
      });

      const testUrl = 'https://example.com/test-article';
      await adapter.suggestXPaths({
        simplifiedDom: '<html><body><article>Content</article></body></html>',
        snippets: [],
        url: testUrl
      });

      const calls = (mockAxios.post as any).mock.calls;
      const userMessage = calls[0][1].messages[1].content;
      
      expect(userMessage).toContain(testUrl);
    });

    it('should include previous failure reason if provided', async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          choices: [{ message: { content: '["//article"]' } }]
        }
      });

      await adapter.suggestXPaths({
        simplifiedDom: '<html><body><article>Content</article></body></html>',
        snippets: [],
        url: 'https://example.com/article',
        previousFailureReason: 'XPath returned empty result'
      });

      const calls = (mockAxios.post as any).mock.calls;
      const userMessage = calls[0][1].messages[1].content;
      
      expect(userMessage).toContain('XPath returned empty result');
    });

    it('should return empty array when API response has no content', async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          choices: [{ message: {} }]
        }
      });

      const result = await adapter.suggestXPaths({
        simplifiedDom: '<html><body><article>Content</article></body></html>',
        snippets: [],
        url: 'https://example.com/article'
      });

      expect(result).toEqual([]);
    });

    it('should return empty array when API response is malformed', async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {}
      });

      const result = await adapter.suggestXPaths({
        simplifiedDom: '<html><body><article>Content</article></body></html>',
        snippets: [],
        url: 'https://example.com/article'
      });

      expect(result).toEqual([]);
    });

    it('should handle API errors gracefully', async () => {
      mockAxios.post = vi.fn().mockRejectedValue(new Error('Network error'));
      (mockAxios.isAxiosError as any) = vi.fn().mockReturnValue(false);

      const result = await adapter.suggestXPaths({
        simplifiedDom: '<html><body><article>Content</article></body></html>',
        snippets: [],
        url: 'https://example.com/article'
      });

      expect(result).toEqual([]);
    });

    it('should handle rate limiting errors', async () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 429,
          headers: { 'retry-after': '60' },
          data: { error: 'Rate limited' }
        }
      };

      mockAxios.post = vi.fn().mockRejectedValue(error);
      (mockAxios.isAxiosError as any) = vi.fn().mockReturnValue(true);

      const result = await adapter.suggestXPaths({
        simplifiedDom: '<html><body><article>Content</article></body></html>',
        snippets: [],
        url: 'https://example.com/article'
      });

      expect(result).toEqual([]);
    });

    it('should handle timeout errors', async () => {
      const error = {
        isAxiosError: true,
        code: 'ECONNABORTED',
        message: 'timeout of 30000ms exceeded'
      };

      mockAxios.post = vi.fn().mockRejectedValue(error);
      (mockAxios.isAxiosError as any) = vi.fn().mockReturnValue(true);

      const result = await adapter.suggestXPaths({
        simplifiedDom: '<html><body><article>Content</article></body></html>',
        snippets: [],
        url: 'https://example.com/article'
      });

      expect(result).toEqual([]);
    });

    it('should parse various XPath response formats', async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content: 'Here are the XPaths:\n["//article", "//main", "//div[@id=\'content\']"]'
              }
            }
          ]
        }
      });

      const result = await adapter.suggestXPaths({
        simplifiedDom: '<html><body><article>Content</article></body></html>',
        snippets: [],
        url: 'https://example.com/article'
      });

      expect(result).toHaveLength(3);
      expect(result[0].xpath).toBe('//article');
    });
  });
});
