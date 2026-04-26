import axios from "axios";
import type { CaptchaPort } from "../ports/captcha.js";
import type {
  CaptchaSolveInput,
  CaptchaSolveResult,
} from "../domain/models.js";
import { CAPTCHA_TYPES, DEFAULTS } from "../constants.js";
import {
  getTwocaptchaApiKey,
  getCaptchaDefaultTimeout,
  getCaptchaPollingInterval,
} from "../config.js";
import { parseProxyUrl } from "../utils/proxy.js";
import { logger } from "../utils/logger.js";

function sanitizeTwoCaptchaLogData(data: any): any {
  if (Array.isArray(data)) {
    return data.map(sanitizeTwoCaptchaLogData);
  }

  if (!data || typeof data !== "object") {
    return data;
  }

  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      /clientKey|proxyPassword|cookie|set-cookie|authorization/i.test(
        key,
      )
        ? "[REDACTED]"
        : sanitizeTwoCaptchaLogData(value),
    ]),
  );
}

export class TwoCaptchaAdapter implements CaptchaPort {
  private apiKey: string;
  private timeout: number;
  private pollingInterval: number;

  constructor() {
    this.apiKey = getTwocaptchaApiKey();
    this.timeout = getCaptchaDefaultTimeout();
    this.pollingInterval = getCaptchaPollingInterval();
  }

  async solveIfPresent(
    input: CaptchaSolveInput,
  ): Promise<CaptchaSolveResult> {
    if (input.captchaTypeHint === CAPTCHA_TYPES.DATADOME) {
      if (!this.apiKey) {
        return {
          solved: false,
          reason: "TWOCAPTCHA_API_KEY not configured",
        };
      }

      return this.solveDataDome(input);
    }

    const unsupportedCaptchaType =
      this.unsupportedCaptchaType(input.captchaTypeHint);
    if (unsupportedCaptchaType) {
      return {
        solved: false,
        reason: `${unsupportedCaptchaType} CAPTCHA solving is unsupported in this pass`,
      };
    }

    return {
      solved: false,
      reason: "Unknown CAPTCHA type",
    };
  }

  private async solveDataDome(
    input: CaptchaSolveInput,
  ): Promise<CaptchaSolveResult> {
    if (!input.proxyDetails?.server) {
      return {
        solved: false,
        reason:
          "DataDome solver proxy configuration error: DATADOME_PROXY_* credentials are required for DataDome CAPTCHA solving",
      };
    }

    try {
      const proxyFields = this.buildProxyFields(
        input.proxyDetails.server,
      );
      if (!proxyFields) {
        return {
          solved: false,
          reason:
            "DataDome solver proxy configuration error: failed to parse DataDome proxy URL",
        };
      }

      const taskPayload = {
        clientKey: this.apiKey,
        task: {
          type: "DataDomeSliderTask",
          websiteURL: input.pageUrl,
          captchaUrl: input.captchaUrl || input.pageUrl,
          userAgent:
            input.userAgentString || DEFAULTS.USER_AGENT,
          ...proxyFields,
        },
      };

      // Log the payload (redact API key)
      logger.debug("[2CAPTCHA] Creating DataDome task:", {
        task: sanitizeTwoCaptchaLogData({
          ...taskPayload.task,
          type: taskPayload.task.type,
          websiteURL: taskPayload.task.websiteURL,
        }),
      });

      const createResponse = await axios.post(
        "https://api.2captcha.com/createTask",
        taskPayload,
      );

      logger.debug("[2CAPTCHA] Create response:", {
        data: sanitizeTwoCaptchaLogData(
          createResponse.data,
        ),
      });

      const taskId = createResponse.data?.taskId;
      if (!taskId) {
        return {
          solved: false,
          reason: this.formatFatalError(
            createResponse.data,
            "Failed to create DataDome task",
          ),
        };
      }

      const startTime = Date.now();
      while (Date.now() - startTime < this.timeout * 1000) {
        await new Promise((r) =>
          setTimeout(r, this.pollingInterval),
        );

        const resultResponse = await axios.post(
          "https://api.2captcha.com/getTaskResult",
          {
            clientKey: this.apiKey,
            taskId,
          },
        );

        // Log polling result
        logger.debug(
          `[2CAPTCHA] Poll result for task ${taskId}:`,
          {
            data: sanitizeTwoCaptchaLogData(
              resultResponse.data,
            ),
          },
        );

        if (resultResponse.data?.status === "ready") {
          const cookie =
            resultResponse.data?.solution?.cookie;
          if (cookie) {
            return { solved: true, updatedCookie: cookie };
          }
          return {
            solved: false,
            reason: "Solution missing cookie",
          };
        }

        // Check for fatal errors (including errorCode regardless of status)
        const hasError =
          resultResponse.data?.status === "error" ||
          (resultResponse.data?.errorId &&
            resultResponse.data.errorId !== 0) ||
          resultResponse.data?.errorCode;

        if (hasError) {
          const errorCode = resultResponse.data?.errorCode;
          const errorDesc =
            resultResponse.data?.errorDescription;

          return {
            solved: false,
            reason: this.formatFatalError(
              { errorCode, errorDescription: errorDesc },
              "Unknown DataDome solver error",
            ),
          };
        }
      }

      return {
        solved: false,
        reason: "Timeout waiting for solution",
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown error";
      return { solved: false, reason: message };
    }
  }

  private unsupportedCaptchaType(
    captchaTypeHint: string | undefined,
  ): string | null {
    switch (captchaTypeHint) {
      case "generic":
        return "Generic";
      case "cloudflare":
      case "turnstile":
        return "Turnstile";
      case "recaptcha":
        return "reCAPTCHA";
      case "hcaptcha":
        return "hCaptcha";
      default:
        return null;
    }
  }

  private formatFatalError(
    data: any,
    fallback: string,
  ): string {
    const errorCode = data?.errorCode;
    const errorDesc = data?.errorDescription;
    const fatalErrors: Record<string, string> = {
      ERROR_BAD_PROXY:
        "DataDome solver proxy configuration error",
      ERROR_PROXY_CONNECTION_FAILED:
        "DataDome solver proxy connection failed",
      ERROR_PROXY_NOT_AUTHORIZED:
        "DataDome solver proxy authentication failed",
      ERROR_CAPTCHA_UNSOLVABLE:
        "CAPTCHA could not be solved",
      ERROR_WRONG_CAPTCHA_ID: "Invalid CAPTCHA ID",
      ERROR_BAD_TOKEN_OR_PAGEURL:
        "Invalid token or page URL",
      ERROR_EMPTY_ACTION: "Empty action parameter",
    };

    const prefix = fatalErrors[errorCode] || fallback;
    if (errorCode && errorDesc) {
      return `${prefix} (${errorCode}): ${errorDesc}`;
    }
    if (errorCode) {
      return prefix;
    }
    return errorDesc || fallback;
  }

  private buildProxyFields(
    proxyUrl: string,
  ): Record<string, string | number> | null {
    const parsed = parseProxyUrl(proxyUrl);
    if (!parsed) return null;

    return {
      proxyType: parsed.protocol,
      proxyAddress: parsed.host,
      proxyPort: parsed.port,
      ...(parsed.username && {
        proxyLogin: parsed.username,
      }),
      ...(parsed.password && {
        proxyPassword: parsed.password,
      }),
    };
  }
}
