// src/services/captcha-solver.ts
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { CaptchaError, ConfigurationError } from '../utils/error-handler.js';
import { DataDomeSolver, DataDomeCaptchaDetails } from './datadome-solver.js';
import { KnownSitesManager } from '../storage/known-sites-manager.js';
import { captchaSolverConfig as importedCaptchaConfig, CaptchaSolverConfig } from '../../config/index.js';
import { Page } from 'puppeteer';

export interface GeneralCaptchaDetails {
  type: 'reCAPTCHAv2' | 'hCaptcha' | 'Turnstile' | 'DataDome';
  sitekey: string;
  pageUrl: string;
  captchaUrl?: string;
}

class CaptchaSolver {
  private config: CaptchaSolverConfig;
  private knownSitesManager?: KnownSitesManager;
  private dataDomeSolver: DataDomeSolver | null;
  private serviceName: string;
  private twoCaptchaInUrl: string;
  private twoCaptchaResUrl: string;

  constructor(captchaConfig?: CaptchaSolverConfig, knownSitesManager?: KnownSitesManager) {
    this.config = captchaConfig || importedCaptchaConfig;
    this.knownSitesManager = knownSitesManager;

    if (!this.config || !this.config.service || !this.config.apiKey) {
      throw new ConfigurationError('CaptchaSolver: Missing required CAPTCHA configuration', {
        missing: ['apiKey', 'service'].filter(key => !this.config || !(this.config as any)[key])
      });
    }
    this.serviceName = this.config.service.toLowerCase();

    if (this.serviceName === '2captcha' || (this.config.dataDomeDomains && this.config.dataDomeDomains.length > 0)) {
        // Pass userAgent from scraperSettings if available, or a default
        const defaultUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        this.dataDomeSolver = new DataDomeSolver(this.config, this.knownSitesManager);
        logger.info('DataDomeSolver initialized within CaptchaSolver.');
    } else {
        logger.warn(`DataDomeSolver not initialized; service is ${this.serviceName} and no specific DataDome domains configured.`);
        this.dataDomeSolver = null;
    }
    
    this.twoCaptchaInUrl = this.config.twoCaptchaInUrl || 'https://2captcha.com/in.php';
    this.twoCaptchaResUrl = this.config.twoCaptchaResUrl || 'https://2captcha.com/res.php';

    logger.info(`CaptchaSolver initialized for service: ${this.serviceName}`);
  }

  // Added userAgent parameter
  async solveIfPresent(page: Page, currentUrl: string, userAgent: string): Promise<boolean> {
    logger.info(`[CaptchaSolver solveIfPresent] Checking for CAPTCHAs on ${currentUrl}`);
    if (this.dataDomeSolver) {
        if (logger.isDebugging()) {
            logger.debug(`[CaptchaSolver solveIfPresent] Current page URL: ${page.url()}`);
            logger.debug('[CaptchaSolver solveIfPresent] Attempting DataDome specialized solver first.');
        }
        try {
            // Pass userAgent to DataDomeSolver's solveIfPresent
            const dataDomeResult = await this.dataDomeSolver.solveIfPresent(page, userAgent);
            if (dataDomeResult) { 
                logger.info('[CaptchaSolver solveIfPresent] DataDome check completed successfully (either no DD CAPTCHA or solved/bypassed).');
                return true; 
            } else {
                logger.warn('[CaptchaSolver solveIfPresent] DataDome CAPTCHA detected but could not be solved by specialized solver (or solver indicated no CAPTCHA).');
            }
        } catch (dataDomeError: any) {
            if (dataDomeError instanceof CaptchaError && dataDomeError.details?.reason === 'banned_ip') {
                 logger.error(`[CaptchaSolver solveIfPresent] DataDome indicates banned IP for ${currentUrl}. Aborting CAPTCHA solve. Error: ${dataDomeError.message}`);
                 throw dataDomeError; 
            }
            logger.warn(`[CaptchaSolver solveIfPresent] DataDome solver error: ${dataDomeError.message}, continuing with general CAPTCHA detection.`);
            const debugEnabled = this.config.debug || (importedCaptchaConfig && importedCaptchaConfig.debug);
            if (debugEnabled && logger.isDebugging()) { 
                logger.error(`[DEBUG_MODE] Full error from DataDomeSolver:`, dataDomeError);
            }
        }
    }

    let captchaDetails: GeneralCaptchaDetails | DataDomeCaptchaDetails | null = null;
    try {
        if (this.dataDomeSolver) {
            const ddDetails = await this.dataDomeSolver.detectCaptcha(page);
            if (ddDetails && ddDetails.isCaptchaPresent) {
                logger.info("[CaptchaSolver solveIfPresent] DataDome CAPTCHA detected by specialized detector. Attempting solve with DataDomeSolver.");
                // Pass userAgent to DataDomeSolver's solve
                return this.dataDomeSolver.solve(page, ddDetails, userAgent); 
            }
        }
        captchaDetails = await this._detectCaptchaType(page, currentUrl);
    } catch (detectionError: any) {
        logger.error(`[CaptchaSolver solveIfPresent] Error during general CAPTCHA detection: ${detectionError.message}`);
        const debugEnabled = this.config.debug || (importedCaptchaConfig && importedCaptchaConfig.debug);
        if (debugEnabled && logger.isDebugging()) {
            logger.error(`[DEBUG_MODE] Full error during _detectCaptchaType:`, detectionError);
        }
        throw new CaptchaError('Error during general CAPTCHA detection', { originalError: detectionError.message, url: currentUrl });
    }
    
    if (!captchaDetails) {
      logger.info('[CaptchaSolver solveIfPresent] No known solvable general CAPTCHA detected on the page.');
      return true; 
    }

    if (captchaDetails.type === 'DataDome') {
        logger.warn('[CaptchaSolver solveIfPresent] DataDome CAPTCHA detected by general detection but not handled by specialized solver. This is unexpected.');
        if (this.dataDomeSolver && captchaDetails.captchaUrl) {
            const ddCompatibleDetails: DataDomeCaptchaDetails = {
                isCaptchaPresent: true,
                captchaUrl: captchaDetails.captchaUrl,
                sitekey: captchaDetails.sitekey,
                type: 'DataDome',
                mainPageUrl: page.url()
            };
            // Pass userAgent
            return this.dataDomeSolver.solve(page, ddCompatibleDetails, userAgent);
        }
        throw new CaptchaError('DataDome detected but no specialized solver available/triggered or captchaUrl missing.', { captchaDetails });
    }

    logger.info(`[CaptchaSolver solveIfPresent] Detected general CAPTCHA: ${captchaDetails.type} with sitekey: ${captchaDetails.sitekey}`);
    let solutionToken: string | null = null;

    try {
        if (this.serviceName === '2captcha') {
          // Pass userAgent to _solveWith2Captcha for general CAPTCHAs too, if 2Captcha supports it for them
          solutionToken = await this._solveWith2Captcha(captchaDetails as GeneralCaptchaDetails, currentUrl, userAgent);
        } else {
          logger.error(`[CaptchaSolver solveIfPresent] Unsupported CAPTCHA solving service: ${this.serviceName}`);
          throw new CaptchaError('Unsupported CAPTCHA solving service', { service: this.serviceName });
        }
    } catch (solvingError: any) {
        logger.error(`[CaptchaSolver solveIfPresent] Error solving general CAPTCHA: ${solvingError.message}`);
        const debugEnabled = this.config.debug || (importedCaptchaConfig && importedCaptchaConfig.debug);
        if (debugEnabled && logger.isDebugging()) {
            logger.error(`[DEBUG_MODE] Full error during general CAPTCHA solving call:`, solvingError);
        }
        throw new CaptchaError('Error solving general CAPTCHA', { originalError: solvingError.message, type: captchaDetails.type });
    }
    
    if (!solutionToken) {
      logger.error('[CaptchaSolver solveIfPresent] Failed to obtain general CAPTCHA solution token.');
      throw new CaptchaError('Failed to obtain general CAPTCHA solution token', { type: captchaDetails.type });
    }
    logger.info(`[CaptchaSolver solveIfPresent] Successfully obtained general CAPTCHA solution token: ${solutionToken.substring(0,30)}...`);

    try {
        const submissionSuccess = await this._submitCaptchaSolution(page, captchaDetails as GeneralCaptchaDetails, solutionToken);
        if (submissionSuccess) {
          logger.info('[CaptchaSolver solveIfPresent] General CAPTCHA solution submitted successfully.');
          await new Promise(resolve => setTimeout(resolve, this.config.postCaptchaSubmitDelay || 5000));
          logger.debug(`[CaptchaSolver solveIfPresent] Waited for postCaptchaSubmitDelay.`);
          return true;
        } else {
          logger.error('[CaptchaSolver solveIfPresent] Failed to submit general CAPTCHA solution to the page.');
          throw new CaptchaError('Failed to submit general CAPTCHA solution to the page', { type: captchaDetails.type });
        }
    } catch (submissionError: any) {
        logger.error(`[CaptchaSolver solveIfPresent] Error submitting general CAPTCHA solution: ${submissionError.message}`);
        const debugEnabled = this.config.debug || (importedCaptchaConfig && importedCaptchaConfig.debug);
        if (debugEnabled && logger.isDebugging()) {
            logger.error(`[DEBUG_MODE] Full error during general CAPTCHA solution submission:`, submissionError);
        }
        throw new CaptchaError('Error submitting general CAPTCHA solution', { originalError: submissionError.message, type: captchaDetails.type });
    }
  }

  private async _detectCaptchaType(page: Page, currentUrl: string): Promise<GeneralCaptchaDetails | null> {
    // ... (implementation remains the same)
    logger.debug(`[CaptchaSolver _detectCaptchaType] Detecting general CAPTCHA types on ${currentUrl}`);
    const recaptchaV2Sitekey = await page.evaluate(() => {
        const el = document.querySelector('.g-recaptcha[data-sitekey]');
        return el ? el.getAttribute('data-sitekey') : null;
    });
    if (recaptchaV2Sitekey) {
        logger.debug(`[CaptchaSolver _detectCaptchaType] Found reCAPTCHA v2 with sitekey: ${recaptchaV2Sitekey}`);
        return { type: 'reCAPTCHAv2', sitekey: recaptchaV2Sitekey, pageUrl: currentUrl };
    }

    const hcaptchaSitekey = await page.evaluate(() => {
        const el = document.querySelector('.h-captcha[data-sitekey]');
        if (el) return el.getAttribute('data-sitekey');
        const iframe = document.querySelector('iframe[src*="hcaptcha.com"]');
        if (iframe) {
            const src = iframe.getAttribute('src');
            const match = src ? src.match(/sitekey=([A-Za-z0-9_-]+)/) : null;
            return match ? match[1] : null;
        }
        return null;
    });
    if (hcaptchaSitekey) {
        logger.debug(`[CaptchaSolver _detectCaptchaType] Found hCaptcha with sitekey: ${hcaptchaSitekey}`);
        return { type: 'hCaptcha', sitekey: hcaptchaSitekey, pageUrl: currentUrl };
    }
    
    const turnstileSitekey = await page.evaluate(() => {
        const el = document.querySelector('.cf-turnstile[data-sitekey]');
        return el ? el.getAttribute('data-sitekey') : null;
    });
    if (turnstileSitekey) {
        logger.debug(`[CaptchaSolver _detectCaptchaType] Found Cloudflare Turnstile with sitekey: ${turnstileSitekey}`);
        return { type: 'Turnstile', sitekey: turnstileSitekey, pageUrl: currentUrl };
    }

    logger.debug(`[CaptchaSolver _detectCaptchaType] No common general CAPTCHA types found.`);
    return null;
  }

  // Added userAgent parameter
  private async _solveWith2Captcha(captchaDetails: GeneralCaptchaDetails, pageUrl: string, userAgent: string): Promise<string | null> {
    logger.debug(`[CaptchaSolver _solveWith2Captcha] Solving ${captchaDetails.type} for ${pageUrl} with 2Captcha. UA: ${userAgent.substring(0,30)}...`);
    if (captchaDetails.type === 'DataDome') {
        logger.warn('[CaptchaSolver _solveWith2Captcha] _solveWith2Captcha called for DataDome, but should be handled by DataDomeSolver.');
        return null; 
    }

    const params: Record<string, string | number | undefined> = {
      key: this.config.apiKey,
      method: captchaDetails.type === 'reCAPTCHAv2' ? 'userrecaptcha' : captchaDetails.type.toLowerCase(),
      pageurl: pageUrl,
      json: 1,
      soft_id: 'YOUR_SOFT_ID', // Replace if you have one
      userAgent: userAgent // Pass userAgent if the CAPTCHA type supports/benefits from it
    };

    if (captchaDetails.type === 'Turnstile') {
        params.method = 'turnstile';
        params.sitekey = captchaDetails.sitekey; 
    } else if (captchaDetails.type === 'hCaptcha') {
        params.method = 'hcaptcha';
        params.sitekey = captchaDetails.sitekey;
    } else { // reCAPTCHAv2
        params.googlekey = captchaDetails.sitekey;
    }


    const debugEnabled = this.config.debug || (importedCaptchaConfig && importedCaptchaConfig.debug);
    if (debugEnabled && logger.isDebugging()) {
        logger.debug('[DEBUG_MODE] Sending general CAPTCHA to 2Captcha with params:', params);
    }
    
    let initialResponse;
    try {
        initialResponse = await axios.post(this.twoCaptchaInUrl, null, { params, timeout: 20000 });
    } catch (error: any) {
        logger.error(`[CaptchaSolver _solveWith2Captcha] Error on initial submission to 2Captcha: ${error.message}`);
        if (debugEnabled && logger.isDebugging()) {
            logger.error(`[DEBUG_MODE] Full error during 2Captcha initial submission:`, error);
        }
        throw new CaptchaError('Error submitting to 2Captcha service', { originalError: error.message, details: error.response?.data });
    }
    
    if (initialResponse.data.status !== 1) {
      logger.error(`[CaptchaSolver _solveWith2Captcha] 2Captcha submission error: ${initialResponse.data.request}`);
      throw new CaptchaError(`2Captcha submission error`, { details: initialResponse.data.request });
    }

    const captchaId = initialResponse.data.request;
    logger.info(`[CaptchaSolver _solveWith2Captcha] CAPTCHA submitted to 2Captcha, ID: ${captchaId}. Polling for solution...`);

    const pollingInterval = this.config.pollingInterval || 5000;
    const pollingTimeout = Date.now() + (this.config.defaultTimeout || 120) * 1000;

    while (Date.now() < pollingTimeout) {
      await new Promise(resolve => setTimeout(resolve, pollingInterval));
      logger.debug(`[CaptchaSolver _solveWith2Captcha] Polling 2Captcha for ID: ${captchaId}...`);
      try {
        const resultResponse = await axios.get(this.twoCaptchaResUrl, {
          params: { key: this.config.apiKey, action: 'get', id: captchaId, json: 1 },
          timeout: 10000
        });

        if (resultResponse.data.status === 1) {
          logger.info(`[CaptchaSolver _solveWith2Captcha] 2Captcha solution received for ID: ${captchaId}. Token: ${resultResponse.data.request.substring(0,30)}...`);
          return resultResponse.data.request; 
        } else if (resultResponse.data.request === 'CAPCHA_NOT_READY') {
          logger.debug('[CaptchaSolver _solveWith2Captcha] 2Captcha: CAPCHA_NOT_READY, continuing to poll.');
        } else {
          logger.error(`[CaptchaSolver _solveWith2Captcha] 2Captcha polling error: ${resultResponse.data.request || 'Unknown error'}`);
          throw new CaptchaError('2Captcha polling error', { details: resultResponse.data.request });
        }
      } catch (pollError: any) {
        logger.warn(`[CaptchaSolver _solveWith2Captcha] 2Captcha polling attempt failed: ${pollError.message}. Retrying...`);
        if (debugEnabled && logger.isDebugging()) {
            logger.warn(`[DEBUG_MODE] Full error during 2Captcha polling:`, pollError);
        }
      }
    }
    logger.error(`[CaptchaSolver _solveWith2Captcha] 2Captcha solution timed out for ID: ${captchaId}.`);
    throw new CaptchaError('2Captcha solution timed out.', { captchaId });
  }

  private async _submitCaptchaSolution(page: Page, captchaDetails: GeneralCaptchaDetails, solutionToken: string): Promise<boolean> {
    // ... (implementation remains the same)
    logger.info(`[CaptchaSolver _submitCaptchaSolution] Attempting to submit CAPTCHA token for type: ${captchaDetails.type}`);
    const debugEnabled = this.config.debug || (importedCaptchaConfig && importedCaptchaConfig.debug);
    if (debugEnabled && logger.isDebugging()) {
        logger.debug(`[CaptchaSolver _submitCaptchaSolution] Token: ${solutionToken.substring(0,30)}...`);
    }

    const success = await page.evaluate((token: string, type: string) => {
        let textarea: HTMLTextAreaElement | HTMLInputElement | null = null;
        let callbackFunctionName: string | null | undefined;

        if (type === 'reCAPTCHAv2') {
            textarea = document.getElementById('g-recaptcha-response') as HTMLTextAreaElement || document.querySelector('textarea[name="g-recaptcha-response"]');
            const recaptchaDiv = document.querySelector('.g-recaptcha');
            if (recaptchaDiv) callbackFunctionName = recaptchaDiv.getAttribute('data-callback');
        } else if (type === 'hCaptcha') {
            textarea = document.querySelector('textarea[name="h-captcha-response"]') || document.querySelector('textarea[name="g-recaptcha-response"]');
            const hcaptchaDiv = document.querySelector('.h-captcha');
            if (hcaptchaDiv) callbackFunctionName = hcaptchaDiv.getAttribute('data-callback');
        } else if (type === 'Turnstile') {
            textarea = document.querySelector('input[name="cf-turnstile-response"]'); 
            const turnstileDiv = document.querySelector('.cf-turnstile');
            if (turnstileDiv) callbackFunctionName = turnstileDiv.getAttribute('data-callback');
        }

        if (textarea) {
            textarea.value = token;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));

            if (callbackFunctionName && typeof (window as any)[callbackFunctionName] === 'function') {
                try {
                    (window as any)[callbackFunctionName](token);
                } catch (e) { console.error('Error calling CAPTCHA callback:', e); }
            } else {
                let form = textarea.closest('form');
                if (form) {
                    const submitButton = form.querySelector('input[type="submit"], button[type="submit"], button:not([type])') as HTMLElement;
                    if (submitButton) {
                        submitButton.click();
                    }
                }
            }
            return true;
        }
        return false;
    }, solutionToken, captchaDetails.type);

    if (!success) {
        logger.warn(`[CaptchaSolver _submitCaptchaSolution] Failed to find standard textarea for ${captchaDetails.type} or execute standard submission mechanism.`);
    } else {
        logger.debug(`[CaptchaSolver _submitCaptchaSolution] Token set for ${captchaDetails.type}. Further page interaction/navigation might be needed.`);
    }
    return success;
  }
}

export { CaptchaSolver };
