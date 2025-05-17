// src/services/captcha-solver.js

import axios from 'axios';
import { logger } from '../utils/logger.js';
import { CaptchaError, ConfigurationError } from '../utils/error-handler.js';
import { DataDomeSolver } from './datadome-solver.js';
// No need to import captchaSolverConfig directly here if passed in constructor

class CaptchaSolver {
    constructor(captchaConfig, knownSitesManager = null) {
        if (!captchaConfig || !captchaConfig.apiKey || !captchaConfig.service) {
            throw new ConfigurationError('CaptchaSolver: Missing required CAPTCHA configuration', {
                missing: ['apiKey', 'service'].filter(key => !captchaConfig || !captchaConfig[key])
            });
        }
        this.config = captchaConfig;
        this.serviceName = captchaConfig.service.toLowerCase();
        this.knownSitesManager = knownSitesManager;

        // Set up API endpoints based on the service
        if (this.serviceName === '2captcha') {
            // For standard 2Captcha API (reCAPTCHA, hCaptcha, etc.)
            this.twoCaptchaInUrl = this.config.twoCaptcha?.inUrl || 'https://2captcha.com/in.php';
            this.twoCaptchaResUrl = this.config.twoCaptcha?.resUrl || 'https://2captcha.com/res.php';

            // For DataDome and other modern CAPTCHA types that use the new API
            this.twoCaptchaCreateTaskUrl = this.config.twoCaptcha?.createTaskUrl || 'https://api.2captcha.com/createTask';
            this.twoCaptchaGetResultUrl = this.config.twoCaptcha?.getResultUrl || 'https://api.2captcha.com/getTaskResult';

            // Create specialized solvers
            if (this.knownSitesManager) {
                this.dataDomeSolver = new DataDomeSolver(captchaConfig, knownSitesManager);
                logger.info('DataDomeSolver initialized with KnownSitesManager');
            } else {
                this.dataDomeSolver = new DataDomeSolver(captchaConfig, null);
                logger.warn('DataDomeSolver initialized without KnownSitesManager - cookie storage disabled');
            }
        }

        logger.info(`CaptchaSolver initialized for service: ${this.serviceName}`);
    }

    /**
     * Detects if a known CAPTCHA is present on the page and attempts to solve it.
     * This is a high-level conceptual method. Implementation details are crucial.
     * @param {object} page - The Puppeteer page object.
     * @param {string} currentUrl - The URL of the page being checked.
     * @returns {Promise<boolean>} True if a CAPTCHA was detected and successfully solved (or no CAPTCHA found), false otherwise.
     */
    async solveIfPresent(page, currentUrl) {
        logger.info(`Checking for CAPTCHAs on ${currentUrl}`);

        // First, check for DataDome CAPTCHA using the specialized solver
        if (this.dataDomeSolver) {
            try {
                // Try to solve with DataDomeSolver first
                const dataDomeResult = await this.dataDomeSolver.solveIfPresent(page);
                if (dataDomeResult === true) {
                    // Either no DataDome CAPTCHA was found, or it was successfully solved
                    logger.info('DataDome check completed successfully');
                    return true;
                }
                // If we get here, DataDome was detected but couldn't be solved
                // We'll fall through to the general CAPTCHA detection
                logger.warn('DataDome CAPTCHA could not be solved, continuing with general detection');
            } catch (dataDomeError) {
                // If it's a banned IP or other critical error, we should stop
                if (dataDomeError instanceof CaptchaError && dataDomeError.details?.isBanned) {
                    throw dataDomeError;
                }
                logger.warn(`DataDome solver error: ${dataDomeError.message}, continuing with general detection`);
            }
        }

        // 1. Detect other CAPTCHA types (reCAPTCHA v2, hCaptcha, etc.)
        let captchaDetails = null;
        try {
            captchaDetails = await this._detectCaptchaType(page, currentUrl);
        } catch (detectionError) {
            logger.error(`Error during CAPTCHA detection: ${detectionError.message}`);
            throw new CaptchaError('Error during CAPTCHA detection', {
                url: currentUrl
            }, detectionError);
        }

        if (!captchaDetails) {
            logger.info('No known solvable CAPTCHA detected on the page.');
            return true; // No CAPTCHA to solve, so "success" in this context
        }

        // Skip DataDome CAPTCHA as it's already handled by the specialized solver
        if (captchaDetails.type === 'DataDome') {
            logger.warn('DataDome CAPTCHA detected but not solved by specialized solver, this is unexpected');
            return false;
        }

        logger.info(`Detected CAPTCHA: ${captchaDetails.type} with sitekey: ${captchaDetails.sitekey}`);

        // 2. Send CAPTCHA to solving service
        let solutionToken;
        try {
            if (this.serviceName === '2captcha') {
                solutionToken = await this._solveWith2Captcha(captchaDetails, currentUrl);
            } else if (this.serviceName === 'anticaptcha') {
                // solutionToken = await this._solveWithAntiCaptcha(captchaDetails, currentUrl);
                logger.warn('AntiCaptcha solver not yet implemented.');
                throw new CaptchaError('AntiCaptcha solver not yet implemented', {
                    captchaType: captchaDetails.type,
                    url: currentUrl
                });
            } else {
                logger.error(`Unsupported CAPTCHA solving service: ${this.serviceName}`);
                throw new CaptchaError('Unsupported CAPTCHA solving service', {
                    service: this.serviceName,
                    captchaType: captchaDetails.type,
                    url: currentUrl
                });
            }
        } catch (solvingError) {
            // If it's already a CaptchaError, just re-throw it
            if (solvingError instanceof CaptchaError) {
                throw solvingError;
            }

            logger.error(`Error solving CAPTCHA: ${solvingError.message}`);
            throw new CaptchaError('Error solving CAPTCHA', {
                captchaType: captchaDetails.type,
                url: currentUrl
            }, solvingError);
        }

        if (!solutionToken) {
            logger.error('Failed to obtain CAPTCHA solution token.');
            throw new CaptchaError('Failed to obtain CAPTCHA solution token', {
                captchaType: captchaDetails.type,
                url: currentUrl
            });
        }

        logger.info('Successfully obtained CAPTCHA solution token.');

        // 3. Submit solution token back to the page
        try {
            const submissionSuccess = await this._submitCaptchaSolution(page, captchaDetails, solutionToken);
            if (submissionSuccess) {
                logger.info('CAPTCHA solution submitted successfully.');
                // It's crucial to wait for the page to react to the CAPTCHA solution
                // This might involve waiting for navigation, an element to disappear/appear, or network activity.
                await page.waitForTimeout(this.config.postCaptchaSubmitDelay || 5000); // Configurable delay
                return true;
            } else {
                logger.error('Failed to submit CAPTCHA solution to the page.');
                throw new CaptchaError('Failed to submit CAPTCHA solution to the page', {
                    captchaType: captchaDetails.type,
                    url: currentUrl
                });
            }
        } catch (submissionError) {
            // If it's already a CaptchaError, just re-throw it
            if (submissionError instanceof CaptchaError) {
                throw submissionError;
            }

            logger.error(`Error submitting CAPTCHA solution: ${submissionError.message}`);
            throw new CaptchaError('Error submitting CAPTCHA solution', {
                captchaType: captchaDetails.type,
                url: currentUrl
            }, submissionError);
        }
    }

    async _detectCaptchaType(page, currentUrl) {
        // Check for reCAPTCHA v2
        const recaptchaV2Sitekey = await page.evaluate(() => {
            const el = document.querySelector('.g-recaptcha[data-sitekey]');
            return el ? el.getAttribute('data-sitekey') : null;
        });
        if (recaptchaV2Sitekey) {
            return { type: 'reCAPTCHA_v2', sitekey: recaptchaV2Sitekey, url: currentUrl };
        }

        // Check for hCaptcha
        const hcaptchaSitekey = await page.evaluate(() => {
            const el = document.querySelector('.h-captcha[data-sitekey]');
            if (el) return el.getAttribute('data-sitekey');
            // hCaptcha can also be in an iframe
            const iframe = document.querySelector('iframe[src*="hcaptcha.com"]');
            if (iframe) {
                const src = iframe.getAttribute('src');
                const match = src.match(/sitekey=([A-Za-z0-9_-]+)/);
                return match ? match[1] : null;
            }
            return null;
        });
        if (hcaptchaSitekey) {
            return { type: 'hCaptcha', sitekey: hcaptchaSitekey, url: currentUrl };
        }

        // Add detection for other CAPTCHA types (e.g., FunCAPTCHA, Cloudflare Turnstile)
        // Cloudflare Turnstile often uses a div with class 'cf-turnstile' and a data-sitekey
        const turnstileSitekey = await page.evaluate(() => {
            const el = document.querySelector('.cf-turnstile[data-sitekey]');
            return el ? el.getAttribute('data-sitekey') : null;
        });
        if (turnstileSitekey) {
            return { type: 'CloudflareTurnstile', sitekey: turnstileSitekey, url: currentUrl };
        }

        // DataDome CAPTCHA detection is now handled by the specialized DataDomeSolver

        return null; // No known CAPTCHA found
    }

    async _solveWith2Captcha(captchaDetails, pageUrl) {
        // DataDome CAPTCHA is now handled by the specialized DataDomeSolver

        // Standard 2Captcha API for other CAPTCHA types
        const params = {
            key: this.config.apiKey,
            method: captchaDetails.type === 'hCaptcha' ? 'hcaptcha' : 'userrecaptcha', // Differentiate for hCaptcha
            googlekey: captchaDetails.sitekey,
            pageurl: pageUrl,
            json: 1,
            // soft_id: 'YOUR_SOFTWARE_ID', // Optional: Your software ID from 2Captcha
        };

        if (captchaDetails.type === 'CloudflareTurnstile') {
            params.method = 'turnstile';
            // 'data-action' and 'data-cdata' might be needed for Turnstile if available on page
            // params.action = captchaDetails.action;
            // params.data = captchaDetails.cdata;
        }

        logger.debug('Sending CAPTCHA to 2Captcha:', params);
        let captchaId;
        try {
            const initialResponse = await axios.post(this.twoCaptchaInUrl, null, { params, timeout: 20000 });

            if (initialResponse.data.status !== 1) {
                throw new CaptchaError(`2Captcha submission error`, {
                    errorCode: initialResponse.data.request || 'Unknown error',
                    captchaType: captchaDetails.type,
                    url: pageUrl
                });
            }

            captchaId = initialResponse.data.request;
        } catch (error) {
            // If it's not already a CaptchaError, wrap it
            if (!(error instanceof CaptchaError)) {
                throw new CaptchaError('Error submitting to 2Captcha service', {
                    captchaType: captchaDetails.type,
                    url: pageUrl
                }, error);
            }
            throw error;
        }
        logger.info(`CAPTCHA submitted to 2Captcha, ID: ${captchaId}. Polling for solution...`);

        const pollingTimeout = Date.now() + (this.config.defaultTimeout || 120) * 1000;
        const pollingInterval = (this.config.pollingInterval || 5) * 1000;

        while (Date.now() < pollingTimeout) {
            await new Promise(resolve => setTimeout(resolve, pollingInterval));
            try {
                const resultResponse = await axios.get(this.twoCaptchaResUrl, {
                    params: { key: this.config.apiKey, action: 'get', id: captchaId, json: 1 },
                    timeout: 10000
                });
                if (resultResponse.data.status === 1) {
                    return resultResponse.data.request; // This is the solution token
                } else if (resultResponse.data.request === 'CAPCHA_NOT_READY') {
                    logger.debug('2Captcha: CAPCHA_NOT_READY, continuing to poll.');
                } else {
                    throw new Error(`2Captcha polling error: ${resultResponse.data.request || 'Unknown error'}`);
                }
            } catch (pollError) {
                // Handle network errors during polling, but don't necessarily give up immediately
                logger.warn(`2Captcha polling attempt failed: ${pollError.message}. Retrying...`);
            }
        }
        throw new Error('2Captcha solution timed out.');
    }

    // DataDome CAPTCHA handling has been moved to the DataDomeSolver class

    async _submitCaptchaSolution(page, captchaDetails, solutionToken) {
        // This is highly dependent on how the specific CAPTCHA is implemented on the page.
        // For reCAPTCHA v2, it's often setting the value of a hidden textarea and then triggering a callback or submit.
        // For hCaptcha, similar. For Turnstile, it might also involve a callback.
        // DataDome CAPTCHA is now handled by the specialized DataDomeSolver

        if (captchaDetails.type === 'reCAPTCHA_v2' || captchaDetails.type === 'hCaptcha' || captchaDetails.type === 'CloudflareTurnstile') {
            // Common pattern: find the textarea (often g-recaptcha-response or h-captcha-response)
            // and set its value. Then, find the associated callback function or submit button.
            const success = await page.evaluate((token, type) => {
                let textarea;
                if (type === 'reCAPTCHA_v2') {
                    textarea = document.getElementById('g-recaptcha-response') || document.querySelector('textarea[name="g-recaptcha-response"]');
                } else if (type === 'hCaptcha') {
                    textarea = document.querySelector('textarea[name="h-captcha-response"]') || document.querySelector('textarea[name="g-recaptcha-response"]'); // Some sites reuse name
                } else if (type === 'CloudflareTurnstile') {
                    // Turnstile often uses a hidden input with name 'cf-turnstile-response'
                    textarea = document.querySelector('input[name="cf-turnstile-response"]');
                }


                if (textarea) {
                    textarea.value = token;
                    textarea.innerHTML = token; // Sometimes needed
                    textarea.dispatchEvent(new Event('input', { bubbles: true })); // Trigger input event
                    textarea.dispatchEvent(new Event('change', { bubbles: true }));// Trigger change event


                    // Attempt to find and call a callback function or click a submit button
                    // This is the trickiest part and highly site-specific.
                    // 1. Look for a JavaScript callback function (e.g., data-callback attribute on .g-recaptcha)
                    let callbackFunctionName = null;
                    if (type === 'reCAPTCHA_v2') {
                        const recaptchaDiv = document.querySelector('.g-recaptcha');
                        if (recaptchaDiv) callbackFunctionName = recaptchaDiv.getAttribute('data-callback');
                    } else if (type === 'hCaptcha') {
                        const hcaptchaDiv = document.querySelector('.h-captcha');
                        if (hcaptchaDiv) callbackFunctionName = hcaptchaDiv.getAttribute('data-callback');
                    }
                    // Turnstile might also have a callback in data-callback or data-expired-callback

                    if (callbackFunctionName && typeof window[callbackFunctionName] === 'function') {
                        try {
                            window[callbackFunctionName](token);
                            return true;
                        } catch (e) { console.error('Error calling CAPTCHA callback:', e); /* continue to try submit */ }
                    }

                    // 2. Try to find a submit button associated with the form containing the CAPTCHA
                    let form = textarea.closest('form');
                    if (form) {
                        const submitButton = form.querySelector('input[type="submit"], button[type="submit"], button:not([type])');
                        if (submitButton) {
                            submitButton.click();
                            return true;
                        }
                    }
                    // If no form, maybe the CAPTCHA itself has a submit mechanism or is part of a larger JS flow
                    // This indicates that the token was set, but automatic submission might not have occurred.
                    // The calling code might need to wait for other page changes.
                    return true; // Token was set, consider this a partial success for submission
                }
                return false; // Textarea not found
            }, solutionToken, captchaDetails.type);
            return success;
        }
        logger.warn(`Submission logic for CAPTCHA type ${captchaDetails.type} not fully implemented.`);
        return false;
    }

    // DataDome cookie handling has been moved to the DataDomeSolver class
}

export { CaptchaSolver };
