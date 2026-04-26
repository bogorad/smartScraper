import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from "vitest";
import axios from "axios";
import { OpenRouterLlmAdapter } from "./openrouter-llm.js";

const mockConfig = vi.hoisted(() => ({
  openrouterApiKey: "test-api-key",
}));

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("axios");
vi.mock("../config.js", () => ({
  getOpenrouterApiKey: () => mockConfig.openrouterApiKey,
  getLlmModel: () => "test-model",
  getLlmTemperature: () => 0,
  getLlmHttpReferer: () => "https://example.com",
  getLlmXTitle: () => "Test App",
}));
vi.mock("../utils/logger.js", () => ({
  logger: loggerMock,
}));

describe("OpenRouterLlmAdapter", () => {
  let adapter: OpenRouterLlmAdapter;
  const mockAxios = vi.mocked(axios);

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.openrouterApiKey = "test-api-key";
    adapter = new OpenRouterLlmAdapter();
  });

  describe("suggestXPaths", () => {
    it("should return XPath suggestions from valid API response", async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        data: {
          choices: [
            {
              message: {
                content:
                  '["//article[@class=\'main\']", "//div[@id=\'content\']", "//main"]',
              },
            },
          ],
        },
      });

      const result = await adapter.suggestXPaths({
        simplifiedDom:
          '<html><body><article class="main">Content</article></body></html>',
        snippets: ["Sample content text"],
        url: "https://example.com/article",
      });

      expect(result).toHaveLength(3);
      expect(result[0].xpath).toBe(
        "//article[@class='main']",
      );
      expect(result[1].xpath).toBe("//div[@id='content']");
      expect(result[2].xpath).toBe("//main");
    });

    it("should return empty array when API response is not JSON", async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
        status: 200,
        data: {
          choices: [
            { message: { content: '["//article"]' } },
          ],
        },
      });

      const result = await adapter.suggestXPaths({
        simplifiedDom:
          "<html><body><article>Content</article></body></html>",
        snippets: [],
        url: "https://example.com/article",
      });

      expect(result).toEqual([]);
    });

    it("should send correct request to OpenRouter API", async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          choices: [
            { message: { content: '["//article"]' } },
          ],
        },
      });

      await adapter.suggestXPaths({
        simplifiedDom:
          "<html><body><article>Content</article></body></html>",
        snippets: ["Sample text"],
        url: "https://example.com/article",
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/chat/completions",
        expect.objectContaining({
          model: "test-model",
          temperature: 0,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
            expect.objectContaining({ role: "user" }),
          ]),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
            "Content-Type": "application/json",
          }),
          timeout: 30000,
        }),
      );
    });

    it("should include snippets in user prompt", async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          choices: [
            { message: { content: '["//article"]' } },
          ],
        },
      });

      await adapter.suggestXPaths({
        simplifiedDom:
          "<html><body><article>Content</article></body></html>",
        snippets: ["First snippet", "Second snippet"],
        url: "https://example.com/article",
      });

      const calls = (mockAxios.post as any).mock.calls;
      const userMessage = calls[0][1].messages[1].content;

      expect(userMessage).toContain("First snippet");
      expect(userMessage).toContain("Second snippet");
    });

    it("should include URL in user prompt", async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          choices: [
            { message: { content: '["//article"]' } },
          ],
        },
      });

      const testUrl = "https://example.com/test-article";
      await adapter.suggestXPaths({
        simplifiedDom:
          "<html><body><article>Content</article></body></html>",
        snippets: [],
        url: testUrl,
      });

      const calls = (mockAxios.post as any).mock.calls;
      const userMessage = calls[0][1].messages[1].content;

      expect(userMessage).toContain(testUrl);
    });

    it("should include previous failure reason if provided", async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          choices: [
            { message: { content: '["//article"]' } },
          ],
        },
      });

      await adapter.suggestXPaths({
        simplifiedDom:
          "<html><body><article>Content</article></body></html>",
        snippets: [],
        url: "https://example.com/article",
        previousFailureReason:
          "XPath returned empty result",
      });

      const calls = (mockAxios.post as any).mock.calls;
      const userMessage = calls[0][1].messages[1].content;

      expect(userMessage).toContain(
        "XPath returned empty result",
      );
    });

    it("should return empty array when API response has no content", async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          choices: [{ message: {} }],
        },
      });

      const result = await adapter.suggestXPaths({
        simplifiedDom:
          "<html><body><article>Content</article></body></html>",
        snippets: [],
        url: "https://example.com/article",
      });

      expect(result).toEqual([]);
    });

    it("should return empty array when API response is malformed", async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {},
      });

      const result = await adapter.suggestXPaths({
        simplifiedDom:
          "<html><body><article>Content</article></body></html>",
        snippets: [],
        url: "https://example.com/article",
      });

      expect(result).toEqual([]);
    });

    it("should handle API errors gracefully", async () => {
      mockAxios.post = vi
        .fn()
        .mockRejectedValue(new Error("Network error"));
      (mockAxios.isAxiosError as any) = vi
        .fn()
        .mockReturnValue(false);

      const result = await adapter.suggestXPaths({
        simplifiedDom:
          "<html><body><article>Content</article></body></html>",
        snippets: [],
        url: "https://example.com/article",
      });

      expect(result).toEqual([]);
    });

    it("should handle rate limiting errors", async () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 429,
          headers: { "retry-after": "60" },
          data: { error: "Rate limited" },
        },
      };

      mockAxios.post = vi.fn().mockRejectedValue(error);
      (mockAxios.isAxiosError as any) = vi
        .fn()
        .mockReturnValue(true);

      const result = await adapter.suggestXPaths({
        simplifiedDom:
          "<html><body><article>Content</article></body></html>",
        snippets: [],
        url: "https://example.com/article",
      });

      expect(result).toEqual([]);
      expect(loggerMock.error).toHaveBeenCalledWith(
        "[LLM] API error",
        {
          status: 429,
          retryAfter: "60",
          providerError: {
            message: "Rate limited",
          },
        },
      );
    });

    it("should log sanitized provider errors without raw response data", async () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 400,
          headers: {},
          data: {
            error: {
              code: "invalid_request",
              message: "Bad request",
              prompt: "raw prompt must not be logged",
            },
          },
        },
      };

      mockAxios.post = vi.fn().mockRejectedValue(error);
      (mockAxios.isAxiosError as any) = vi
        .fn()
        .mockReturnValue(true);

      const result = await adapter.suggestXPaths({
        simplifiedDom:
          "<html><body><article>Content</article></body></html>",
        snippets: [],
        url: "https://example.com/article",
      });

      expect(result).toEqual([]);
      expect(loggerMock.error).toHaveBeenCalledWith(
        "[LLM] API error",
        {
          status: 400,
          retryAfter: "",
          providerError: {
            code: "invalid_request",
            message: "Bad request",
          },
        },
      );
    });

    it("should log missing API key through the centralized logger", async () => {
      mockConfig.openrouterApiKey = "";
      adapter = new OpenRouterLlmAdapter();

      const result = await adapter.suggestXPaths({
        simplifiedDom:
          "<html><body><article>Content</article></body></html>",
        snippets: [],
        url: "https://example.com/article",
      });

      expect(result).toEqual([]);
      expect(loggerMock.warn).toHaveBeenCalledWith(
        "[LLM] OPENROUTER_API_KEY not set",
      );
      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it("should handle timeout errors", async () => {
      const error = {
        isAxiosError: true,
        code: "ECONNABORTED",
        message: "timeout of 30000ms exceeded",
      };

      mockAxios.post = vi.fn().mockRejectedValue(error);
      (mockAxios.isAxiosError as any) = vi
        .fn()
        .mockReturnValue(true);

      const result = await adapter.suggestXPaths({
        simplifiedDom:
          "<html><body><article>Content</article></body></html>",
        snippets: [],
        url: "https://example.com/article",
      });

      expect(result).toEqual([]);
    });

    it("should parse various XPath response formats", async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content:
                  'Here are the XPaths:\n["//article", "//main", "//div[@id=\'content\']"]',
              },
            },
          ],
        },
      });

      const result = await adapter.suggestXPaths({
        simplifiedDom:
          "<html><body><article>Content</article></body></html>",
        snippets: [],
        url: "https://example.com/article",
      });

      expect(result).toHaveLength(3);
      expect(result[0].xpath).toBe("//article");
    });
  });
});
