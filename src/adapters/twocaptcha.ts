import axios from 'axios';
import type { CaptchaPort } from '../ports/captcha.js';
import type { CaptchaSolveInput, CaptchaSolveResult } from '../domain/models.js';
import { CAPTCHA_TYPES, DEFAULTS } from '../constants.js';
import { getTwocaptchaApiKey, getCaptchaDefaultTimeout, getCaptchaPollingInterval } from '../config.js';
import { parseProxyUrl } from '../utils/proxy.js';
import { logger } from '../utils/logger.js';

export class TwoCaptchaAdapter implements CaptchaPort {
  private apiKey: string;
  private timeout: number;
  private pollingInterval: number;

  constructor() {
    this.apiKey = getTwocaptchaApiKey();
    this.timeout = getCaptchaDefaultTimeout();
    this.pollingInterval = getCaptchaPollingInterval();
  }

  async solveIfPresent(input: CaptchaSolveInput): Promise<CaptchaSolveResult> {
    if (!this.apiKey) {
      return { solved: false, reason: 'TWOCAPTCHA_API_KEY not configured' };
    }

    if (input.captchaTypeHint === CAPTCHA_TYPES.DATADOME) {
      return this.solveDataDome(input);
    }

    if (input.captchaTypeHint === CAPTCHA_TYPES.GENERIC) {
      return this.solveGeneric(input);
    }

    return { solved: false, reason: 'Unknown CAPTCHA type' };
  }

  private async solveGeneric(input: CaptchaSolveInput): Promise<CaptchaSolveResult> {
    if (!input.siteKey) {
      return { solved: false, reason: 'Generic CAPTCHA requires siteKey extraction (not yet implemented)' };
    }

    try {
      const submitResponse = await axios.get('https://2captcha.com/in.php', {
        params: {
          key: this.apiKey,
          method: 'userrecaptcha',
          googlekey: input.siteKey,
          pageurl: input.pageUrl,
          json: 1
        }
      });

      if (submitResponse.data?.status !== 1) {
        return { solved: false, reason: submitResponse.data?.request || 'Submit failed' };
      }

      const captchaId = submitResponse.data.request;
      const startTime = Date.now();

      while (Date.now() - startTime < this.timeout * 1000) {
        await new Promise(r => setTimeout(r, this.pollingInterval));

        const resultResponse = await axios.get('https://2captcha.com/res.php', {
          params: {
            key: this.apiKey,
            action: 'get',
            id: captchaId,
            json: 1
          }
        });

        if (resultResponse.data?.status === 1) {
          return { solved: true, updatedCookie: resultResponse.data.request };
        }

        if (resultResponse.data?.request !== 'CAPCHA_NOT_READY') {
          return { solved: false, reason: resultResponse.data?.request || 'Unknown error' };
        }
      }

      return { solved: false, reason: 'Timeout waiting for solution' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { solved: false, reason: message };
    }
  }

  private async solveDataDome(input: CaptchaSolveInput): Promise<CaptchaSolveResult> {
    try {
      const proxyFields = input.proxyDetails ? this.buildProxyFields(input.proxyDetails.server) : {};
      
      const taskPayload = {
        clientKey: this.apiKey,
        task: {
          type: 'DataDomeSliderTask',
          websiteURL: input.pageUrl,
          captchaUrl: input.captchaUrl || input.pageUrl,
          userAgent: input.userAgentString || DEFAULTS.USER_AGENT,
          ...proxyFields
        }
      };

      // Log the payload (redact API key)
      logger.debug('[2CAPTCHA] Creating DataDome task:', {
        task: {
          ...taskPayload.task,
          type: taskPayload.task.type,
          websiteURL: taskPayload.task.websiteURL
        }
      });

      const createResponse = await axios.post('https://api.2captcha.com/createTask', taskPayload);

      logger.debug('[2CAPTCHA] Create response:', { data: createResponse.data });

      const taskId = createResponse.data?.taskId;
      if (!taskId) {
        return { solved: false, reason: createResponse.data?.errorDescription || 'Failed to create task' };
      }

      const startTime = Date.now();
      while (Date.now() - startTime < this.timeout * 1000) {
        await new Promise(r => setTimeout(r, this.pollingInterval));

        const resultResponse = await axios.post('https://api.2captcha.com/getTaskResult', {
          clientKey: this.apiKey,
          taskId
        });

        // Log polling result
        logger.debug(`[2CAPTCHA] Poll result for task ${taskId}:`, { data: resultResponse.data });

        if (resultResponse.data?.status === 'ready') {
          const cookie = resultResponse.data?.solution?.cookie;
          if (cookie) {
            return { solved: true, updatedCookie: cookie };
          }
          return { solved: false, reason: 'Solution missing cookie' };
        }

        // Check for fatal errors (including errorCode regardless of status)
        const hasError = resultResponse.data?.status === 'error' ||
                        (resultResponse.data?.errorId && resultResponse.data.errorId !== 0) ||
                        resultResponse.data?.errorCode;

        if (hasError) {
          const errorCode = resultResponse.data?.errorCode;
          const errorDesc = resultResponse.data?.errorDescription;

          // Map known fatal error codes
          const fatalErrors: Record<string, string> = {
            'ERROR_CAPTCHA_UNSOLVABLE': 'CAPTCHA could not be solved',
            'ERROR_WRONG_CAPTCHA_ID': 'Invalid CAPTCHA ID',
            'ERROR_BAD_TOKEN_OR_PAGEURL': 'Invalid token or page URL',
            'ERROR_EMPTY_ACTION': 'Empty action parameter',
            'ERROR_PROXY_CONNECTION_FAILED': 'Proxy connection failed',
            'ERROR_PROXY_NOT_AUTHORIZED': 'Proxy authentication failed'
          };

          const reason = fatalErrors[errorCode] || errorDesc || errorCode || 'Unknown error';
          return { solved: false, reason };
        }
      }

      return { solved: false, reason: 'Timeout waiting for solution' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { solved: false, reason: message };
    }
  }

  private buildProxyFields(proxyUrl: string): Record<string, string | number> {
    const parsed = parseProxyUrl(proxyUrl);
    if (!parsed) return {};
    
    return {
      proxyType: parsed.protocol,
      proxyAddress: parsed.host,
      proxyPort: parsed.port,
      ...(parsed.username && { proxyLogin: parsed.username }),
      ...(parsed.password && { proxyPassword: parsed.password })
    };
  }
}
