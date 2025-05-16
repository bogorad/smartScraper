// src/services/captcha-solver.js

import axios from 'axios';
import { logger } from '../utils/logger.js';
import { CaptchaError, ConfigurationError } from '../utils/error-handler.js';
// No need to import captchaSolverConfig directly here if passed in constructor

class CaptchaSolver {
    constructor(captchaConfig) {
        if (!captchaConfig || !captchaConfig.apiKey || !captchaConfig.service) {
            throw new ConfigurationError('CaptchaSolver: Missing required CAPTCHA configuration', {
                missing: ['apiKey', 'service'].filter(key => !captchaConfig || !captchaConfig[key])
            });
        }
        this.config = captchaConfig;
        this.serviceName = captchaConfig.service.toLowerCase();

        // Set up API endpoints based on the service
        if (this.serviceName === '2captcha') {
            // For standard 2Captcha API (reCAPTCHA, hCaptcha, etc.)
            this.twoCaptchaInUrl = this.config.twoCaptcha?.inUrl || 'https://2captcha.com/in.php';
            this.twoCaptchaResUrl = this.config.twoCaptcha?.resUrl || 'https://2captcha.com/res.php';

            // For DataDome and other modern CAPTCHA types that use the new API
            this.twoCaptchaCreateTaskUrl = this.config.twoCaptcha?.createTaskUrl || 'https://api.2captcha.com/createTask';
            this.twoCaptchaGetResultUrl = this.config.twoCaptcha?.getResultUrl || 'https://api.2captcha.com/getTaskResult';
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

        // 1. Detect CAPTCHA type (reCAPTCHA v2, hCaptcha, etc.)
        // This requires inspecting the DOM for specific elements/iframes.
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
                // You might need more sophisticated waits here.
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

        // Check for DataDome CAPTCHA
        const dataDomeCaptchaInfo = await page.evaluate(() => {
            const iframe = document.querySelector('iframe[src*="captcha-delivery.com"], iframe[src*="geo.captcha-delivery.com"]');
            if (!iframe) return null;

            return {
                captchaUrl: iframe.src
            };
        });

        if (dataDomeCaptchaInfo) {
            logger.info(`DataDome CAPTCHA detected with URL: ${dataDomeCaptchaInfo.captchaUrl}`);
            return {
                type: 'DataDome',
                captchaUrl: dataDomeCaptchaInfo.captchaUrl,
                url: currentUrl
            };
        }

        return null; // No known CAPTCHA found
    }

    async _solveWith2Captcha(captchaDetails, pageUrl) {
        // Handle DataDome CAPTCHA separately as it uses a different API endpoint
        if (captchaDetails.type === 'DataDome') {
            return this._solveDataDomeWith2Captcha(captchaDetails, pageUrl);
        }

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

    /**
     * Solve a DataDome CAPTCHA using 2Captcha's new API
     * @param {object} captchaDetails - Details about the CAPTCHA
     * @param {string} pageUrl - The URL of the page with the CAPTCHA
     * @returns {Promise<string>} The cookie string to set
     */
    async _solveDataDomeWith2Captcha(captchaDetails, pageUrl) {
        logger.info(`Solving DataDome CAPTCHA for ${pageUrl}`);

        // Get proxy information from config
        const proxyInfo = this.config.proxy || {};

        // Get user agent from config or use a default
        const userAgent = this.config.userAgent ||
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

        // Check if the CAPTCHA URL indicates a banned IP
        const htmlAnalyser = new (await import('../analysis/html-analyser-fixed.js')).HtmlAnalyserFixed();
        const bannedIPCheck = htmlAnalyser.checkDataDomeBannedIP(captchaDetails.captchaUrl);

        if (bannedIPCheck.isBanned) {
            logger.error(`DataDome CAPTCHA indicates banned IP: ${bannedIPCheck.details}`);
            throw new CaptchaError('DataDome CAPTCHA indicates banned IP', {
                details: bannedIPCheck.details,
                url: pageUrl,
                captchaUrl: captchaDetails.captchaUrl
            });
        }

        if (bannedIPCheck.warning) {
            logger.warn(`DataDome CAPTCHA warning: ${bannedIPCheck.details}`);
        }

        // Create the task payload for 2Captcha
        const taskPayload = {
            type: "DataDomeSliderTask",
            websiteURL: pageUrl,
            captchaUrl: captchaDetails.captchaUrl,
            userAgent: userAgent
        };

        // Add proxy information if available
        if (proxyInfo.server) {
            // Parse proxy URL to extract components
            try {
                const proxyUrl = new URL(proxyInfo.server.startsWith('http') ?
                    proxyInfo.server : `http://${proxyInfo.server}`);

                const proxyType = proxyUrl.protocol.replace(':', '');
                const proxyAddress = proxyUrl.hostname;
                const proxyPort = proxyUrl.port || (proxyType === 'http' ? '80' : '1080');

                taskPayload.proxyType = proxyType;
                taskPayload.proxyAddress = proxyAddress;
                taskPayload.proxyPort = proxyPort;

                // Add authentication if present
                if (proxyUrl.username) {
                    taskPayload.proxyLogin = proxyUrl.username;
                    taskPayload.proxyPassword = proxyUrl.password || '';
                }

                logger.info(`Using proxy for DataDome CAPTCHA: ${proxyType}://${proxyAddress}:${proxyPort}`);
            } catch (error) {
                logger.warn(`Error parsing proxy URL: ${error.message}. Continuing without proxy.`);
            }
        }

        // Create the request body
        const requestBody = {
            clientKey: this.config.apiKey,
            task: taskPayload
        };

        logger.debug('Sending DataDome CAPTCHA task to 2Captcha API:', {
            ...requestBody,
            task: {
                ...requestBody.task,
                proxyPassword: requestBody.task.proxyPassword ? '***' : undefined
            }
        });

        // Send the task to 2Captcha
        let taskId;
        try {
            const createTaskResponse = await axios.post(this.twoCaptchaCreateTaskUrl, requestBody, {
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            logger.debug(`2Captcha create task response: ${JSON.stringify(createTaskResponse.data)}`);

            if (createTaskResponse.data.errorId !== 0) {
                throw new CaptchaError(`2Captcha create task failed: ${createTaskResponse.data.errorCode}`, {
                    errorCode: createTaskResponse.data.errorCode,
                    errorDescription: createTaskResponse.data.errorDescription,
                    captchaType: 'DataDome',
                    url: pageUrl
                });
            }

            taskId = createTaskResponse.data.taskId;
            logger.info(`2Captcha task ID: ${taskId}`);
        } catch (error) {
            // If it's not already a CaptchaError, wrap it
            if (!(error instanceof CaptchaError)) {
                throw new CaptchaError('Error submitting DataDome CAPTCHA to 2Captcha service', {
                    captchaType: 'DataDome',
                    url: pageUrl
                }, error);
            }
            throw error;
        }

        // Poll for the result
        const pollingTimeout = Date.now() + (this.config.defaultTimeout || 120) * 1000;
        const pollingInterval = (this.config.pollingInterval || 5) * 1000;

        while (Date.now() < pollingTimeout) {
            logger.debug(`Polling 2Captcha for DataDome task ID: ${taskId}...`);

            try {
                await new Promise(resolve => setTimeout(resolve, pollingInterval));

                const getResultResponse = await axios.post(this.twoCaptchaGetResultUrl, {
                    clientKey: this.config.apiKey,
                    taskId
                }, {
                    timeout: 20000,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                logger.debug(`2Captcha get result response: ${JSON.stringify(getResultResponse.data)}`);

                if (getResultResponse.data.errorId !== 0) {
                    const errorCode = getResultResponse.data.errorCode;
                    logger.error(`2Captcha get result failed: ${errorCode} - ${getResultResponse.data.errorDescription}`);

                    if (errorCode === 'ERROR_CAPTCHA_UNSOLVABLE') {
                        throw new CaptchaError('DataDome CAPTCHA unsolvable', {
                            captchaType: 'DataDome',
                            url: pageUrl
                        });
                    } else if (errorCode === 'ERR_PROXY_CONNECTION_FAILED') {
                        throw new CaptchaError('DataDome CAPTCHA proxy error', {
                            captchaType: 'DataDome',
                            url: pageUrl,
                            proxy: taskPayload.proxyType ? `${taskPayload.proxyType}://${taskPayload.proxyAddress}:${taskPayload.proxyPort}` : 'none'
                        });
                    } else {
                        throw new CaptchaError(`DataDome CAPTCHA API error: ${errorCode}`, {
                            captchaType: 'DataDome',
                            url: pageUrl,
                            errorCode
                        });
                    }
                }

                const status = getResultResponse.data.status;

                if (status === "ready") {
                    logger.info(`2Captcha solved DataDome task ID: ${taskId}`);

                    const solutionCookie = getResultResponse.data.solution?.cookie;

                    if (!solutionCookie) {
                        throw new CaptchaError('DataDome CAPTCHA solution missing cookie', {
                            captchaType: 'DataDome',
                            url: pageUrl
                        });
                    }

                    logger.info(`2Captcha DataDome cookie: ${solutionCookie.substring(0, 50)}...`);
                    return solutionCookie;
                } else if (status === "processing") {
                    logger.debug("2Captcha still processing DataDome CAPTCHA...");
                } else {
                    logger.warn(`2Captcha unknown status for DataDome CAPTCHA: ${status}`);
                }
            } catch (error) {
                // If it's already a CaptchaError, just re-throw it
                if (error instanceof CaptchaError) {
                    throw error;
                }

                logger.error(`2Captcha poll error for DataDome task ID ${taskId}: ${error.message}`);
                // Don't give up immediately on polling errors
                await new Promise(resolve => setTimeout(resolve, pollingInterval / 2));
            }
        }

        logger.error(`2Captcha timeout for DataDome task ID: ${taskId}`);
        throw new CaptchaError('DataDome CAPTCHA solution timed out', {
            captchaType: 'DataDome',
            url: pageUrl,
            taskId
        });
    }

    async _submitCaptchaSolution(page, captchaDetails, solutionToken) {
        // This is highly dependent on how the specific CAPTCHA is implemented on the page.
        // For reCAPTCHA v2, it's often setting the value of a hidden textarea and then triggering a callback or submit.
        // For hCaptcha, similar. For Turnstile, it might also involve a callback.
        // For DataDome, we need to set a cookie and reload the page.

        if (captchaDetails.type === 'DataDome') {
            return this._submitDataDomeSolution(page, captchaDetails, solutionToken);
        }

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

    /**
     * Format a DataDome cookie for use with Puppeteer
     * @param {string} cookieString - The cookie string from 2Captcha
     * @param {string} targetUrl - The URL the cookie is for
     * @returns {Object|null} - The formatted cookie object or null if parsing fails
     */
    _formatDataDomeCookie(cookieString, targetUrl) {
        logger.info(`Formatting DataDome cookie: ${cookieString.substring(0, 50)}...`);

        if (!cookieString?.includes("=")) {
            logger.error("DataDome cookie string format error");
            return null;
        }

        try {
            // Parse the cookie string
            const parts = cookieString.split(";").map(p => p.trim());
            const [name, ...valueParts] = parts[0].split("=");
            const value = valueParts.join("=");

            if (!name || !value) {
                logger.error("Bad name/value in DataDome cookie");
                return null;
            }

            // Create a simple cookie object with just the name and value
            const cookie = {
                name: name.trim(),
                value: value.trim(),
                url: targetUrl
            };

            // Parse cookie attributes
            for (let i = 1; i < parts.length; i++) {
                const part = parts[i].trim();

                if (part.toLowerCase() === 'secure') {
                    cookie.secure = true;
                    continue;
                }

                if (part.toLowerCase() === 'httponly') {
                    cookie.httpOnly = true;
                    continue;
                }

                const [attrName, ...attrValueParts] = part.split("=");
                if (!attrName) continue;

                const attrNameLower = attrName.trim().toLowerCase();
                const attrValue = attrValueParts.join("=").trim();

                switch (attrNameLower) {
                    case "domain":
                        cookie.domain = attrValue;
                        break;
                    case "path":
                        cookie.path = attrValue || "/";
                        break;
                    case "max-age":
                        try {
                            const maxAgeSec = parseInt(attrValue, 10);
                            if (!isNaN(maxAgeSec)) {
                                cookie.expires = Math.floor(Date.now() / 1000) + maxAgeSec;
                            }
                        } catch (e) {
                            logger.warn(`Error parsing max-age: ${e.message}`);
                        }
                        break;
                    case "samesite":
                        if (attrValue.toLowerCase() === 'lax') {
                            cookie.sameSite = 'Lax';
                        } else if (attrValue.toLowerCase() === 'strict') {
                            cookie.sameSite = 'Strict';
                        } else if (attrValue.toLowerCase() === 'none') {
                            cookie.sameSite = 'None';
                            // SameSite=None requires Secure
                            cookie.secure = true;
                        }
                        break;
                }
            }

            logger.debug(`Formatted DataDome cookie: ${JSON.stringify(cookie)}`);
            return cookie;
        } catch (error) {
            logger.error(`DataDome cookie parsing error: ${error.message}`);
            return null;
        }
    }

    /**
     * Submit a DataDome CAPTCHA solution by setting the cookie and reloading the page
     * @param {object} page - The Puppeteer page object
     * @param {object} captchaDetails - Details about the CAPTCHA
     * @param {string} cookieString - The cookie string from 2Captcha
     * @returns {Promise<boolean>} True if the solution was submitted successfully
     */
    async _submitDataDomeSolution(page, captchaDetails, cookieString) {
        logger.info('Submitting DataDome CAPTCHA solution...');

        try {
            // Format the cookie
            const formattedCookie = this._formatDataDomeCookie(cookieString, captchaDetails.url);
            if (!formattedCookie) {
                logger.error('Failed to format DataDome cookie');
                return false;
            }

            // Set the cookie
            logger.info('Setting DataDome cookie...');
            await page.setCookie(formattedCookie);

            // Log all cookies after setting
            const cookies = await page.cookies(captchaDetails.url);
            logger.debug('All cookies after setting DataDome cookie:', cookies);

            // Reload the page
            logger.info('Reloading page after setting DataDome cookie...');
            await page.goto(captchaDetails.url, {
                waitUntil: 'networkidle2',
                timeout: this.config.navigationTimeout || 60000
            });

            // Verify that the CAPTCHA is no longer present
            const captchaStillPresent = await page.evaluate(() => {
                return !!document.querySelector('iframe[src*="captcha-delivery.com"], iframe[src*="geo.captcha-delivery.com"]');
            });

            if (captchaStillPresent) {
                logger.warn('DataDome CAPTCHA is still present after setting cookie and reloading');

                // Check if we have content anyway (sometimes the CAPTCHA iframe remains but content is accessible)
                const hasContent = await page.evaluate(() => {
                    // Check for common content indicators
                    const mainContent = document.querySelector('main');
                    const article = document.querySelector('article');
                    const h1 = document.querySelector('h1');

                    return {
                        hasMainContent: !!mainContent,
                        hasArticle: !!article,
                        hasH1: !!h1,
                        title: document.title
                    };
                });

                logger.debug('Content check after DataDome CAPTCHA solution:', hasContent);

                if (hasContent.hasMainContent || hasContent.hasArticle || hasContent.hasH1) {
                    logger.info('DataDome CAPTCHA bypass successful despite iframe still present. Content found.');
                    return true;
                }

                return false;
            }

            logger.info('DataDome CAPTCHA no longer present after setting cookie and reloading');
            return true;
        } catch (error) {
            logger.error(`Error submitting DataDome CAPTCHA solution: ${error.message}`);
            return false;
        }
    }
}

export { CaptchaSolver };
