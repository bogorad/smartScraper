// src/services/datadome-solver.js

import axios from 'axios';
import { URL } from 'url';
import { logger } from '../utils/logger.js';
import { CaptchaError } from '../utils/error-handler.js';

/**
 * Specialized class for solving DataDome CAPTCHA challenges
 */
class DataDomeSolver {
    /**
     * Create a new DataDomeSolver instance
     * @param {object} config - Configuration for the solver
     * @param {object} knownSitesManager - Instance of KnownSitesManager for storing cookies
     */
    constructor(config, knownSitesManager) {
        this.config = config;
        this.knownSitesManager = knownSitesManager;

        // Set up API endpoints for 2Captcha
        this.createTaskUrl = this.config.twoCaptcha?.createTaskUrl || 'https://api.2captcha.com/createTask';
        this.getResultUrl = this.config.twoCaptcha?.getResultUrl || 'https://api.2captcha.com/getTaskResult';

        logger.info('DataDomeSolver initialized');
    }

    /**
     * Detect if a DataDome CAPTCHA is present on the page
     * @param {object} page - The Puppeteer page object
     * @returns {Promise<object|null>} CAPTCHA details if detected, null otherwise
     */
    async detectCaptcha(page) {
        const currentUrl = page.url();

        // Check for DataDome CAPTCHA iframe
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

        return null; // No DataDome CAPTCHA found
    }

    /**
     * Solve a DataDome CAPTCHA if present
     * @param {object} page - The Puppeteer page object
     * @returns {Promise<boolean>} True if solved successfully or no CAPTCHA present
     */
    async solveIfPresent(page) {
        const captchaDetails = await this.detectCaptcha(page);
        if (!captchaDetails) {
            logger.info('No DataDome CAPTCHA detected');
            return true; // No CAPTCHA to solve
        }

        // Extract domain from URL for cookie storage
        const domain = new URL(captchaDetails.url).hostname;

        // Check if we have a stored cookie
        const storedCookie = await this.knownSitesManager.getCaptchaCookie(domain);
        if (storedCookie) {
            logger.info(`Found stored DataDome cookie for ${domain}`);
            const cookieSet = await this.setStoredCookie(page, storedCookie, captchaDetails.url);

            if (cookieSet) {
                // Reload the page to apply the cookie
                await page.reload({ waitUntil: 'networkidle2' });

                // Check if CAPTCHA is still present
                const captchaStillPresent = await this.detectCaptcha(page);
                if (!captchaStillPresent) {
                    logger.info('Successfully bypassed DataDome CAPTCHA using stored cookie');
                    return true;
                }
                logger.warn('Stored DataDome cookie did not work, solving new CAPTCHA');
            }
        }

        // Solve the CAPTCHA with 2Captcha
        return this.solve(page, captchaDetails);
    }

    /**
     * Solve a DataDome CAPTCHA
     * @param {object} page - The Puppeteer page object
     * @param {object} captchaDetails - Details about the CAPTCHA
     * @returns {Promise<boolean>} True if solved successfully
     */
    async solve(page, captchaDetails) {
        logger.info(`Solving DataDome CAPTCHA for ${captchaDetails.url}`);

        // Check if the CAPTCHA URL indicates a banned IP
        const bannedIPCheck = this.checkBannedIP(captchaDetails.captchaUrl);
        if (bannedIPCheck.isBanned) {
            logger.error(`DataDome CAPTCHA indicates banned IP: ${bannedIPCheck.details}`);
            throw new CaptchaError('DataDome CAPTCHA indicates banned IP', {
                details: bannedIPCheck.details,
                url: captchaDetails.url,
                captchaUrl: captchaDetails.captchaUrl
            });
        }

        // Get the cookie from 2Captcha
        const cookieString = await this._solveWith2Captcha(captchaDetails);
        if (!cookieString) {
            logger.error('Failed to get DataDome cookie from 2Captcha');
            return false;
        }

        // Format and set the cookie
        const formattedCookie = this._formatDataDomeCookie(cookieString, captchaDetails.url);
        if (!formattedCookie) {
            logger.error('Failed to format DataDome cookie');
            return false;
        }

        // Set the cookie in the browser
        await page.setCookie(formattedCookie);

        // Store the cookie for future use
        const domain = new URL(captchaDetails.url).hostname;
        await this.knownSitesManager.storeCaptchaCookie(
            domain,
            formattedCookie.name,
            formattedCookie.value
        );

        // Reload the page and check if CAPTCHA is gone
        await page.reload({ waitUntil: 'networkidle2' });
        const captchaStillPresent = await this.detectCaptcha(page);
        return !captchaStillPresent;
    }

    /**
     * Set a stored cookie in the browser
     * @param {object} page - The Puppeteer page object
     * @param {object} storedCookie - The stored cookie object
     * @param {string} url - The URL to set the cookie for
     * @returns {Promise<boolean>} True if cookie was set successfully
     */
    async setStoredCookie(page, storedCookie, url) {
        try {
            const cookie = {
                name: storedCookie.name,
                value: storedCookie.value,
                url: url
            };

            await page.setCookie(cookie);
            logger.info(`Set stored DataDome cookie for ${url}`);
            return true;
        } catch (error) {
            logger.error(`Failed to set stored DataDome cookie: ${error.message}`);
            return false;
        }
    }

    /**
     * Check if a DataDome CAPTCHA URL indicates a banned IP
     * @param {string} captchaUrl - The CAPTCHA URL
     * @returns {object} Object with isBanned and details properties
     */
    checkBannedIP(captchaUrl) {
        try {
            const url = new URL(captchaUrl);
            const params = url.searchParams;

            // Check for the t parameter which indicates the type of challenge
            const t = params.get('t');

            if (t === 'bv') {
                return {
                    isBanned: true,
                    details: 'IP is banned (t=bv parameter detected)'
                };
            }

            // Check for other suspicious parameters
            if (params.has('cid') && params.get('cid').includes('block')) {
                return {
                    isBanned: true,
                    details: `IP may be blocked (cid=${params.get('cid')})`
                };
            }

            return {
                isBanned: false,
                warning: false,
                details: 'No ban indicators found'
            };
        } catch (error) {
            logger.warn(`Error parsing DataDome CAPTCHA URL: ${error.message}`);
            return {
                isBanned: false,
                warning: true,
                details: `Error parsing URL: ${error.message}`
            };
        }
    }

    /**
     * Solve a DataDome CAPTCHA using 2Captcha
     * @param {object} captchaDetails - Details about the CAPTCHA
     * @returns {Promise<string|null>} The cookie string if successful, null otherwise
     * @private
     */
    async _solveWith2Captcha(captchaDetails) {
        // Get proxy information from config
        const proxyInfo = this.config.proxy || {};

        // Get user agent from config or use a default
        const userAgent = this.config.userAgent ||
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

        // Create the task payload for 2Captcha
        const taskPayload = {
            type: "DataDomeSliderTask",
            websiteURL: captchaDetails.url,
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

        logger.debug('Sending DataDome CAPTCHA task to 2Captcha API');

        // Send the task to 2Captcha
        let taskId;
        try {
            const createTaskResponse = await axios.post(this.createTaskUrl, requestBody, {
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (createTaskResponse.data.errorId !== 0) {
                throw new CaptchaError(`2Captcha create task failed: ${createTaskResponse.data.errorCode}`, {
                    errorCode: createTaskResponse.data.errorCode,
                    errorDescription: createTaskResponse.data.errorDescription,
                    captchaType: 'DataDome',
                    url: captchaDetails.url
                });
            }

            taskId = createTaskResponse.data.taskId;
            logger.info(`2Captcha task ID: ${taskId}`);
        } catch (error) {
            if (!(error instanceof CaptchaError)) {
                throw new CaptchaError('Error submitting DataDome CAPTCHA to 2Captcha service', {
                    captchaType: 'DataDome',
                    url: captchaDetails.url
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

                const getResultResponse = await axios.post(this.getResultUrl, {
                    clientKey: this.config.apiKey,
                    taskId
                }, {
                    timeout: 20000,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (getResultResponse.data.errorId !== 0) {
                    const errorCode = getResultResponse.data.errorCode;
                    logger.error(`2Captcha get result failed: ${errorCode} - ${getResultResponse.data.errorDescription}`);

                    if (errorCode === 'ERROR_CAPTCHA_UNSOLVABLE') {
                        throw new CaptchaError('DataDome CAPTCHA unsolvable', {
                            captchaType: 'DataDome',
                            url: captchaDetails.url
                        });
                    } else {
                        throw new CaptchaError(`DataDome CAPTCHA API error: ${errorCode}`, {
                            captchaType: 'DataDome',
                            url: captchaDetails.url,
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
                            url: captchaDetails.url
                        });
                    }

                    logger.info(`2Captcha DataDome cookie received`);
                    return solutionCookie;
                } else if (status === "processing") {
                    logger.debug("2Captcha still processing DataDome CAPTCHA...");
                } else {
                    logger.warn(`2Captcha unknown status for DataDome CAPTCHA: ${status}`);
                }
            } catch (error) {
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
            url: captchaDetails.url,
            taskId
        });
    }

    /**
     * Format a DataDome cookie for use with Puppeteer
     * @param {string} cookieString - The cookie string from 2Captcha
     * @param {string} targetUrl - The URL the cookie is for
     * @returns {Object|null} - The formatted cookie object or null if parsing fails
     * @private
     */
    _formatDataDomeCookie(cookieString, targetUrl) {
        logger.info(`Formatting DataDome cookie`);

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
            // Make sure to use the correct domain format (without leading dot)
            const cookie = {
                name: name.trim(),
                value: value.trim(),
                url: targetUrl
            };

            // Extract the domain from the URL for proper cookie setting
            try {
                const urlObj = new URL(targetUrl);
                // Don't add leading dot to domain (e.g., use www.nytimes.com, not .www.nytimes.com)
                cookie.domain = urlObj.hostname;
            } catch (e) {
                logger.warn(`Error extracting domain from URL: ${e.message}`);
            }

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

            logger.debug(`Formatted DataDome cookie`);
            return cookie;
        } catch (error) {
            logger.error(`DataDome cookie parsing error: ${error.message}`);
            return null;
        }
    }
}

export { DataDomeSolver };
