// src/services/captcha-solver.js
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { CaptchaError, ConfigurationError } from '../utils/error-handler.js';
import { DataDomeSolver } from './datadome-solver.js';
import { KnownSitesManager } from '../storage/known-sites-manager.js';
// Corrected import path
import { captchaSolverConfig as importedCaptchaConfig } from '../../config/index.js'; 

class CaptchaSolver {
  constructor(captchaConfig, knownSitesManager) {
    this.config = captchaConfig || importedCaptchaConfig; 
    this.knownSitesManager = knownSitesManager;

    if (!this.config || !this.config.service || !this.config.apiKey) {
      throw new ConfigurationError('CaptchaSolver: Missing required CAPTCHA configuration', {
        missing: ['apiKey', 'service'].filter(key => !this.config || !this.config[key])
      });
    }
    this.serviceName = this.config.service.toLowerCase();

    if (this.serviceName === '2captcha' || (this.config.dataDomeDomains && this.config.dataDomeDomains.length > 0)) {
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

  async solveIfPresent(page, currentUrl) {
    // ... (method content as provided in your dump)
    logger.info(`[CaptchaSolver solveIfPresent] Checking for CAPTCHAs on ${currentUrl}`);
    if (this.dataDomeSolver) {
        logger.debug(`[CaptchaSolver solveIfPresent] Current page URL: ${page.url()}`);
        logger.debug('[CaptchaSolver solveIfPresent] Attempting DataDome specialized solver first.');
        try {
            const dataDomeResult = await this.dataDomeSolver.solveIfPresent(page);
            if (dataDomeResult) { 
                logger.info('[CaptchaSolver solveIfPresent] DataDome check completed successfully (either no DD CAPTCHA or solved/bypassed).');
                return true; 
            } else {
                logger.warn('[CaptchaSolver solveIfPresent] DataDome CAPTCHA detected but could not be solved by specialized solver.');
                return false; 
            }
        } catch (dataDomeError) {
            if (dataDomeError instanceof CaptchaError && dataDomeError.details?.reason === 'banned_ip') {
                 logger.error(`[CaptchaSolver solveIfPresent] DataDome indicates banned IP for ${currentUrl}. Aborting CAPTCHA solve. Error: ${dataDomeError.message}`);
                 throw dataDomeError; 
            }
            logger.warn(`[CaptchaSolver solveIfPresent] DataDome solver error: ${dataDomeError.message}, continuing with general CAPTCHA detection.`);
            // Check a debug flag from the config that CaptchaSolver holds
            const debugEnabled = this.config.debug || (importedCaptchaConfig && importedCaptchaConfig.debug);
            if (debugEnabled) { 
                logger.error(`[DEBUG_MODE] Full error from DataDomeSolver:`, dataDomeError);
            }
        }
    }

    let captchaDetails = null;
    try {
        if (this.dataDomeSolver && await this.dataDomeSolver.detectCaptcha(page)) {
            logger.info("[CaptchaSolver solveIfPresent] DataDome CAPTCHA still present or re-appeared after initial attempt. Relying on DataDomeSolver's outcome.");
            const finalDDSolve = await this.dataDomeSolver.solveIfPresent(page);
            return finalDDSolve; 
        }
        captchaDetails = await this._detectCaptchaType(page, currentUrl);
    } catch (detectionError) {
        logger.error(`[CaptchaSolver solveIfPresent] Error during general CAPTCHA detection: ${detectionError.message}`);
        const debugEnabled = this.config.debug || (importedCaptchaConfig && importedCaptchaConfig.debug);
        if (debugEnabled) {
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
        if (this.dataDomeSolver) return this.dataDomeSolver.solve(page, captchaDetails);
        throw new CaptchaError('DataDome detected but no specialized solver available/triggered.', { captchaDetails });
    }

    logger.info(`[CaptchaSolver solveIfPresent] Detected general CAPTCHA: ${captchaDetails.type} with sitekey: ${captchaDetails.sitekey}`);
    let solutionToken = null;

    try {
        if (this.serviceName === '2captcha') {
          solutionToken = await this._solveWith2Captcha(captchaDetails, currentUrl);
        } else {
          logger.error(`[CaptchaSolver solveIfPresent] Unsupported CAPTCHA solving service: ${this.serviceName}`);
          throw new CaptchaError('Unsupported CAPTCHA solving service', { service: this.serviceName });
        }
    } catch (solvingError) {
        logger.error(`[CaptchaSolver solveIfPresent] Error solving general CAPTCHA: ${solvingError.message}`);
        const debugEnabled = this.config.debug || (importedCaptchaConfig && importedCaptchaConfig.debug);
        if (debugEnabled) {
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
        const submissionSuccess = await this._submitCaptchaSolution(page, captchaDetails, solutionToken);
        if (submissionSuccess) {
          logger.info('[CaptchaSolver solveIfPresent] General CAPTCHA solution submitted successfully.');
          await page.waitForTimeout(this.config.postCaptchaSubmitDelay || 5000);
          logger.debug(`[CaptchaSolver solveIfPresent] Waited for postCaptchaSubmitDelay.`);
          return true;
        } else {
          logger.error('[CaptchaSolver solveIfPresent] Failed to submit general CAPTCHA solution to the page.');
          throw new CaptchaError('Failed to submit general CAPTCHA solution to the page', { type: captchaDetails.type });
        }
    } catch (submissionError) {
        logger.error(`[CaptchaSolver solveIfPresent] Error submitting general CAPTCHA solution: ${submissionError.message}`);
        const debugEnabled = this.config.debug || (importedCaptchaConfig && importedCaptchaConfig.debug);
        if (debugEnabled) {
            logger.error(`[DEBUG_MODE] Full error during general CAPTCHA solution submission:`, submissionError);
        }
        throw new CaptchaError('Error submitting general CAPTCHA solution', { originalError: submissionError.message, type: captchaDetails.type });
    }
  }

  async _detectCaptchaType(page, currentUrl) {
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
            // @ts-ignore
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

  async _solveWith2Captcha(captchaDetails, pageUrl) {
    logger.debug(`[CaptchaSolver _solveWith2Captcha] Solving ${captchaDetails.type} for ${pageUrl} with 2Captcha.`);
    if (captchaDetails.type === 'DataDome') {
        logger.warn('[CaptchaSolver _solveWith2Captcha] _solveWith2Captcha called for DataDome, but should be handled by DataDomeSolver.');
        return null; 
    }

    const params = {
      key: this.config.apiKey,
      method: captchaDetails.type === 'reCAPTCHAv2' ? 'userrecaptcha' : captchaDetails.type.toLowerCase(),
      googlekey: captchaDetails.sitekey,
      pageurl: pageUrl,
      json: 1,
      soft_id: 'YOUR_SOFT_ID' 
    };

    if (captchaDetails.type === 'Turnstile') {
        params.method = 'turnstile';
        params.sitekey = captchaDetails.sitekey; 
        delete params.googlekey; 
    }

    const debugEnabled = this.config.debug || (importedCaptchaConfig && importedCaptchaConfig.debug);
    if (debugEnabled) {
        logger.debug('[DEBUG_MODE] Sending general CAPTCHA to 2Captcha with params:', params);
    }
    
    let initialResponse;
    try {
        initialResponse = await axios.post(this.twoCaptchaInUrl, null, { params, timeout: 20000 });
    } catch (error) {
        logger.error(`[CaptchaSolver _solveWith2Captcha] Error on initial submission to 2Captcha: ${error.message}`);
        if (debugEnabled) {
            logger.error(`[DEBUG_MODE] Full error during 2Captcha initial submission:`, error);
        }
        throw new CaptchaError('Error submitting to 2Captcha service', { originalError: error.message, details: error.response?.data });
    }
    

    if (initialResponse.data.status !== 1) {
      logger.error(`[CaptchaSolver _solveWith2Captcha] 2Captcha submission error: ${initialResponse.data.request}`);
      throw new CaptchaError(\`2Captcha submission error\`, { details: initialResponse.data.request });
    }

    const captchaId = initialResponse.data.request;
    logger.info(\`[CaptchaSolver _solveWith2Captcha] CAPTCHA submitted to 2Captcha, ID: \${captchaId}. Polling for solution...\`);

    const pollingInterval = this.config.pollingInterval || 5000;
    const pollingTimeout = Date.now() + (this.config.defaultTimeout || 120) * 1000;

    while (Date.now() < pollingTimeout) {
      await new Promise(resolve => setTimeout(resolve, pollingInterval));
      logger.debug(\`[CaptchaSolver _solveWith2Captcha] Polling 2Captcha for ID: \${captchaId}...\`);
      try {
        const resultResponse = await axios.get(this.twoCaptchaResUrl, {
          params: { key: this.config.apiKey, action: 'get', id: captchaId, json: 1 },
          timeout: 10000
        });

        if (resultResponse.data.status === 1) {
          logger.info(\`[CaptchaSolver _solveWith2Captcha] 2Captcha solution received for ID: \${captchaId}. Token: \${resultResponse.data.request.substring(0,30)}...\`);
          return resultResponse.data.request; 
        } else if (resultResponse.data.request === 'CAPCHA_NOT_READY') {
          logger.debug('[CaptchaSolver _solveWith2Captcha] 2Captcha: CAPCHA_NOT_READY, continuing to poll.');
        } else {
          logger.error(\`[CaptchaSolver _solveWith2Captcha] 2Captcha polling error: \${resultResponse.data.request || 'Unknown error'}\`);
          throw new CaptchaError('2Captcha polling error', { details: resultResponse.data.request });
        }
      } catch (pollError) {
        logger.warn(\`[CaptchaSolver _solveWith2Captcha] 2Captcha polling attempt failed: \${pollError.message}. Retrying...\`);
        if (debugEnabled) {
            logger.warn(\`[DEBUG_MODE] Full error during 2Captcha polling:\`, pollError);
        }
      }
    }
    logger.error(\`[CaptchaSolver _solveWith2Captcha] 2Captcha solution timed out for ID: \${captchaId}.\`);
    throw new CaptchaError('2Captcha solution timed out.', { captchaId });
  }

  async _submitCaptchaSolution(page, captchaDetails, solutionToken) {
    logger.info(\`[CaptchaSolver _submitCaptchaSolution] Attempting to submit CAPTCHA token for type: \${captchaDetails.type}\`);
    const debugEnabled = this.config.debug || (importedCaptchaConfig && importedCaptchaConfig.debug);
    if (debugEnabled) {
        logger.debug(\`[CaptchaSolver _submitCaptchaSolution] Token: \${solutionToken.substring(0,30)}...\`);
    }

    const success = await page.evaluate((token, type) => {
        let textarea;
        let callbackFunctionName;

        if (type === 'reCAPTCHAv2') {
            textarea = document.getElementById('g-recaptcha-response') || document.querySelector('textarea[name="g-recaptcha-response"]');
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
            // @ts-ignore
            textarea.value = token;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));

            if (callbackFunctionName && typeof window[callbackFunctionName] === 'function') {
                try {
                    // @ts-ignore
                    window[callbackFunctionName](token);
                } catch (e) { console.error('Error calling CAPTCHA callback:', e); }
            } else {
                // @ts-ignore
                let form = textarea.closest('form');
                if (form) {
                    const submitButton = form.querySelector('input[type="submit"], button[type="submit"], button:not([type])');
                    if (submitButton) {
                        // @ts-ignore
                        submitButton.click();
                    }
                }
            }
            return true;
        }
        return false;
    }, solutionToken, captchaDetails.type);

    if (!success) {
        logger.warn(\`[CaptchaSolver _submitCaptchaSolution] Failed to find standard textarea for \${captchaDetails.type} or execute standard submission mechanism.\`);
    } else {
        logger.debug(\`[CaptchaSolver _submitCaptchaSolution] Token set for \${captchaDetails.type}. Further page interaction/navigation might be needed.\`);
    }
    return success;
  }
}

export { CaptchaSolver };
