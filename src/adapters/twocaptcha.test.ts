import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from "vitest";
import axios from "axios";
import { TwoCaptchaAdapter } from "./twocaptcha.js";
import { CAPTCHA_TYPES } from "../constants.js";

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("axios");
vi.mock("../config.js", () => ({
  getTwocaptchaApiKey: () => "test-api-key",
  getCaptchaDefaultTimeout: () => 120,
  getCaptchaPollingInterval: () => 100,
  getLogLevel: () => "NONE",
}));
vi.mock("../utils/logger.js", () => ({
  logger: loggerMock,
}));

describe("TwoCaptchaAdapter", () => {
  let adapter: TwoCaptchaAdapter;
  const mockAxios = vi.mocked(axios);
  const datadomeProxyDetails = {
    server: "http://proxy.example.com:8080",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TwoCaptchaAdapter();
  });

  describe("solveIfPresent", () => {
    it("should return unsolved for unknown CAPTCHA type", async () => {
      const result = await adapter.solveIfPresent({
        pageId: "page-123",
        pageUrl: "https://example.com",
        captchaTypeHint: CAPTCHA_TYPES.NONE,
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toContain(
        "Unknown CAPTCHA type",
      );
    });

    it("should return unsupported for generic CAPTCHA without submitting to solver", async () => {
      const result = await adapter.solveIfPresent({
        pageId: "page-123",
        pageUrl: "https://example.com",
        captchaTypeHint: "generic" as any,
        siteKey: "test-site-key",
      });

      expect(result).toEqual({
        solved: false,
        reason:
          "Generic CAPTCHA solving is unsupported in this pass",
      });
      expect(mockAxios.get).not.toHaveBeenCalled();
      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it("should delegate to solveDataDome for DataDome CAPTCHA", async () => {
      mockAxios.post = vi
        .fn()
        .mockResolvedValueOnce({
          data: { taskId: "task-123" },
        })
        .mockResolvedValueOnce({
          data: {
            status: "ready",
            solution: { cookie: "datadome=abc" },
          },
        });

      await adapter.solveIfPresent({
        pageId: "page-123",
        pageUrl: "https://example.com",
        captchaTypeHint: CAPTCHA_TYPES.DATADOME,
        proxyDetails: datadomeProxyDetails,
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        "https://api.2captcha.com/createTask",
        expect.objectContaining({
          clientKey: "test-api-key",
          task: expect.objectContaining({
            type: "DataDomeSliderTask",
            websiteURL: "https://example.com",
          }),
        }),
      );
    });
  });

  describe("unsupported CAPTCHA types", () => {
    it.each([
      [
        "generic",
        "Generic CAPTCHA solving is unsupported in this pass",
      ],
      [
        "cloudflare",
        "Turnstile CAPTCHA solving is unsupported in this pass",
      ],
      [
        "turnstile",
        "Turnstile CAPTCHA solving is unsupported in this pass",
      ],
      [
        "recaptcha",
        "reCAPTCHA CAPTCHA solving is unsupported in this pass",
      ],
      [
        "hcaptcha",
        "hCaptcha CAPTCHA solving is unsupported in this pass",
      ],
    ] as const)(
      "should reject %s without submitting to solver",
      async (captchaTypeHint, reason) => {
        const result = await adapter.solveIfPresent({
          pageId: "page-123",
          pageUrl: "https://example.com",
          captchaTypeHint: captchaTypeHint as any,
          siteKey: "test-site-key",
        });

        expect(result).toEqual({ solved: false, reason });
        expect(mockAxios.get).not.toHaveBeenCalled();
        expect(mockAxios.post).not.toHaveBeenCalled();
      },
    );
  });

  describe("solveDataDome", () => {
    it("should fail clearly when DataDome proxy details are missing", async () => {
      const result = await adapter.solveIfPresent({
        pageId: "page-123",
        pageUrl: "https://example.com",
        captchaTypeHint: CAPTCHA_TYPES.DATADOME,
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toContain(
        "DataDome solver proxy configuration error",
      );
      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it("should successfully solve DataDome CAPTCHA", async () => {
      mockAxios.post = vi
        .fn()
        .mockResolvedValueOnce({
          data: { taskId: "task-123" },
        })
        .mockResolvedValueOnce({
          data: {
            status: "ready",
            solution: { cookie: "datadome=abc123" },
          },
        });

      const result = await adapter.solveIfPresent({
        pageId: "page-123",
        pageUrl: "https://example.com",
        captchaTypeHint: CAPTCHA_TYPES.DATADOME,
        proxyDetails: datadomeProxyDetails,
      });

      expect(result.solved).toBe(true);
      expect(result.updatedCookie).toBe("datadome=abc123");
      expect(loggerMock.debug).toHaveBeenCalledWith(
        "[2CAPTCHA] Poll result for task task-123:",
        {
          data: {
            status: "ready",
            solution: { cookie: "[REDACTED]" },
          },
        },
      );
    });

    it("should not pass solver secrets or cookies into ready response logs", async () => {
      mockAxios.post = vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            taskId: "task-123",
            clientKey: "test-api-key",
          },
        })
        .mockResolvedValueOnce({
          data: {
            status: "ready",
            solution: {
              cookie: "datadome=secret-cookie",
            },
          },
        });

      const result = await adapter.solveIfPresent({
        pageId: "page-123",
        pageUrl: "https://example.com",
        captchaTypeHint: CAPTCHA_TYPES.DATADOME,
        proxyDetails: {
          server:
            "http://proxy-user:proxy-password@proxy.example.com:8080",
        },
      });

      expect(result.solved).toBe(true);
      const loggedData = loggerMock.debug.mock.calls.map(
        (call) => JSON.stringify(call),
      );
      expect(loggedData.join("\n")).not.toContain(
        "test-api-key",
      );
      expect(loggedData.join("\n")).not.toContain(
        "proxy-password",
      );
      expect(loggedData.join("\n")).not.toContain(
        "datadome=secret-cookie",
      );
      expect(loggedData.join("\n")).toContain(
        '"proxyPassword":"[REDACTED]"',
      );
      expect(loggedData.join("\n")).toContain(
        '"cookie":"[REDACTED]"',
      );
    });

    it("should include proxy details when provided", async () => {
      mockAxios.post = vi
        .fn()
        .mockResolvedValueOnce({
          data: { taskId: "task-123" },
        })
        .mockResolvedValueOnce({
          data: {
            status: "ready",
            solution: { cookie: "datadome=abc" },
          },
        });

      await adapter.solveIfPresent({
        pageId: "page-123",
        pageUrl: "https://example.com",
        captchaTypeHint: CAPTCHA_TYPES.DATADOME,
        proxyDetails: datadomeProxyDetails,
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        "https://api.2captcha.com/createTask",
        expect.objectContaining({
          task: expect.objectContaining({
            proxyType: "http",
            proxyAddress: "proxy.example.com",
            proxyPort: 8080,
          }),
        }),
      );
    });

    it("should handle task creation failure", async () => {
      mockAxios.post = vi.fn().mockResolvedValueOnce({
        data: { errorDescription: "Invalid client key" },
      });

      const result = await adapter.solveIfPresent({
        pageId: "page-123",
        pageUrl: "https://example.com",
        captchaTypeHint: CAPTCHA_TYPES.DATADOME,
        proxyDetails: datadomeProxyDetails,
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toContain("Invalid client key");
    });

    it("should report 2Captcha bad proxy as a DataDome proxy configuration error", async () => {
      mockAxios.post = vi.fn().mockResolvedValueOnce({
        data: {
          errorId: 130,
          errorCode: "ERROR_BAD_PROXY",
          errorDescription:
            "Incorrect proxy parameters or can not establish connection through the proxy.",
        },
      });

      const result = await adapter.solveIfPresent({
        pageId: "page-123",
        pageUrl: "https://example.com",
        captchaTypeHint: CAPTCHA_TYPES.DATADOME,
        proxyDetails: datadomeProxyDetails,
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toBe(
        "DataDome solver proxy configuration error (ERROR_BAD_PROXY): Incorrect proxy parameters or can not establish connection through the proxy.",
      );
    });

    it("should poll until task is ready", async () => {
      mockAxios.post = vi
        .fn()
        .mockResolvedValueOnce({
          data: { taskId: "task-123" },
        })
        .mockResolvedValueOnce({
          data: { status: "processing" },
        })
        .mockResolvedValueOnce({
          data: { status: "processing" },
        })
        .mockResolvedValueOnce({
          data: {
            status: "ready",
            solution: { cookie: "datadome=abc" },
          },
        });

      const result = await adapter.solveIfPresent({
        pageId: "page-123",
        pageUrl: "https://example.com",
        captchaTypeHint: CAPTCHA_TYPES.DATADOME,
        proxyDetails: datadomeProxyDetails,
      });

      expect(result.solved).toBe(true);
      expect(mockAxios.post).toHaveBeenCalledTimes(4);
    });

    it("should handle error status from task result", async () => {
      mockAxios.post = vi
        .fn()
        .mockResolvedValueOnce({
          data: { taskId: "task-123" },
        })
        .mockResolvedValueOnce({
          data: {
            status: "error",
            errorDescription: "Task failed",
          },
        });

      const result = await adapter.solveIfPresent({
        pageId: "page-123",
        pageUrl: "https://example.com",
        captchaTypeHint: CAPTCHA_TYPES.DATADOME,
        proxyDetails: datadomeProxyDetails,
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toContain("Task failed");
      expect(loggerMock.debug).toHaveBeenCalledWith(
        "[2CAPTCHA] Poll result for task task-123:",
        {
          data: {
            status: "error",
            errorDescription: "Task failed",
          },
        },
      );
    });

    it("should handle missing cookie in solution", async () => {
      mockAxios.post = vi
        .fn()
        .mockResolvedValueOnce({
          data: { taskId: "task-123" },
        })
        .mockResolvedValueOnce({
          data: { status: "ready", solution: {} },
        });

      const result = await adapter.solveIfPresent({
        pageId: "page-123",
        pageUrl: "https://example.com",
        captchaTypeHint: CAPTCHA_TYPES.DATADOME,
        proxyDetails: datadomeProxyDetails,
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toContain("missing cookie");
    });

    it("should timeout when DataDome solving takes too long", async () => {
      mockAxios.post = vi
        .fn()
        .mockResolvedValueOnce({
          data: { taskId: "task-123" },
        })
        .mockResolvedValue({
          data: { status: "processing" },
        });

      vi.useFakeTimers();

      const promise = adapter.solveIfPresent({
        pageId: "page-123",
        pageUrl: "https://example.com",
        captchaTypeHint: CAPTCHA_TYPES.DATADOME,
        proxyDetails: datadomeProxyDetails,
      });

      await vi.advanceTimersByTimeAsync(130000);

      const result = await promise;

      expect(result.solved).toBe(false);
      expect(result.reason).toContain("Timeout");

      vi.useRealTimers();
    });

    it("should map known error codes to user-friendly messages", async () => {
      mockAxios.post = vi
        .fn()
        .mockResolvedValueOnce({
          data: { taskId: "task-123" },
        })
        .mockResolvedValueOnce({
          data: {
            errorCode: "ERROR_CAPTCHA_UNSOLVABLE",
            errorId: 1,
          },
        });

      const result = await adapter.solveIfPresent({
        pageId: "page-123",
        pageUrl: "https://example.com",
        captchaTypeHint: CAPTCHA_TYPES.DATADOME,
        proxyDetails: datadomeProxyDetails,
      });

      expect(result.solved).toBe(false);
      expect(result.reason).toBe(
        "CAPTCHA could not be solved",
      );
    });
  });
});
