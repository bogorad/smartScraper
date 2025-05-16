// src/services/captcha-solver.js

import axios from 'axios';
import logger from '../utils/logger.js';
// No need to import captchaSolverConfig directly here if passed in constructor

class CaptchaSolver {
    constructor(captchaConfig) {
        if (!captchaConfig || !captchaConfig.apiKey || !captchaConfig.service) {
            throw new Error('CaptchaSolver: Missing required CAPTCHA configuration (apiKey, service).');
        }
        this.config = captchaConfig;
        this.serviceName = captchaConfig.service.toLowerCase();
        // Base URLs and specific paths would depend on the service
        // Example for 2Captcha:
        this.twoCaptchaInUrl = 'https://2captcha.com/in.php';
        this.twoCaptchaResUrl = 'https://2captcha.com/res.php';

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

        // 1. Detect CAPTCHA type (reCAPTCHA v2, hCaptcha, etc.)
        // This requires inspecting the DOM for specific elements/iframes.
        let captchaDetails = null;
        try {
            captchaDetails = await this._detectCaptchaType(page, currentUrl);
        } catch (detectionError) {
            logger.error(`Error during CAPTCHA detection: ${detectionError.message}`);
            return false; // Cannot proceed if detection fails
        }


        if (!captchaDetails) {
            logger.info('No known solvable CAPTCHA detected on the page.');
            return true; // No CAPTCHA to solve, so "success" in this context
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
                return false;
            } else {
                logger.error(`Unsupported CAPTCHA solving service: ${this.serviceName}`);
                return false;
            }
        } catch (solvingError) {
            logger.error(`Error solving CAPTCHA: ${solvingError.message}`);
            return false;
        }


        if (!solutionToken) {
            logger.error('Failed to obtain CAPTCHA solution token.');
            return false;
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
                // You might need more sophisticated waits here.
                return true;
            } else {
                logger.error('Failed to submit CAPTCHA solution to the page.');
                return false;
            }
        } catch (submissionError) {
            logger.error(`Error submitting CAPTCHA solution: ${submissionError.message}`);
            return false;
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


        return null; // No known CAPTCHA found
    }

    async _solveWith2Captcha(captchaDetails, pageUrl) {
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
        const initialResponse = await axios.post(this.twoCaptchaInUrl, null, { params, timeout: 20000 });

        if (initialResponse.data.status !== 1) {
            throw new Error(`2Captcha submission error: ${initialResponse.data.request || 'Unknown error'}`);
        }
        const captchaId = initialResponse.data.request;
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

    async _submitCaptchaSolution(page, captchaDetails, solutionToken) {
        // This is highly dependent on how the specific CAPTCHA is implemented on the page.
        // For reCAPTCHA v2, it's often setting the value of a hidden textarea and then triggering a callback or submit.
        // For hCaptcha, similar. For Turnstile, it might also involve a callback.

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
}

export { CaptchaSolver };
