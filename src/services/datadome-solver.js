// src/services/datadome-solver.js
import axios from 'axios';
import { URL } from 'url'; 
import { logger } from '../utils/logger.js';
import { CaptchaError } from '../utils/error-handler.js';
// Corrected import path and ensures scraperSettings is used from here
import { scraperSettings, captchaSolverConfig as importedCaptchaConfig } from '../../config/index.js'; 
// REMOVED: Redundant and incorrect import: import { scraperSettings } from '../../config/scraper-settings.js';
import { KnownSitesManager } from '../storage/known-sites-manager.js';

class DataDomeSolver {
  constructor(captchaConfig, knownSitesManager) {
    this.config = captchaConfig || importedCaptchaConfig; 
    this.knownSitesManager = knownSitesManager;

    if (!this.config || !this.config.twoCaptchaInUrl || !this.config.twoCaptchaResUrl) {
        logger.error('[DataDomeSolver constructor] Missing 2Captcha URLs in captchaConfig.');
        this.createTaskUrl = null;
        this.getResultUrl = null;
    } else {
        this.createTaskUrl = this.config.twoCaptchaInUrl;
        this.getResultUrl = this.config.twoCaptchaResUrl;
    }
    logger.info('DataDomeSolver initialized.');
  }

  async detectCaptcha(page) {
    const currentUrl = page.url();
    logger.debug(`[DataDomeSolver detectCaptcha] Detecting CAPTCHA on ${currentUrl}`);
    try {
      const dataDomeCaptchaInfo = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="captcha-delivery.com"], iframe[src*="geo.captcha-delivery.com"]');
        if (iframe) {
          // @ts-ignore
          const captchaUrl = iframe.src;
          let sitekey = null; 
          return { isCaptchaPresent: true, captchaUrl, sitekey: sitekey, type: 'DataDome' };
        }
        return { isCaptchaPresent: false };
      });

      if (dataDomeCaptchaInfo.isCaptchaPresent) {
        logger.info(`[DataDomeSolver detectCaptcha] DataDome CAPTCHA detected with URL: ${dataDomeCaptchaInfo.captchaUrl}`);
        return dataDomeCaptchaInfo;
      }
    } catch (error) {
      logger.warn(`[DataDomeSolver detectCaptcha] Error during CAPTCHA detection: ${error.message}`);
    }
    logger.debug('[DataDomeSolver detectCaptcha] No DataDome CAPTCHA iframe found.');
    return null;
  }

  async solveIfPresent(page) {
    logger.debug(`[DataDomeSolver solveIfPresent] Checking for DataDome CAPTCHA on page: ${page.url()}`);
    const captchaDetails = await this.detectCaptcha(page);

    if (!captchaDetails || !captchaDetails.isCaptchaPresent) {
      logger.info('[DataDomeSolver solveIfPresent] No DataDome CAPTCHA detected.');
      return true; 
    }

    const bannedCheck = this.checkBannedIP(captchaDetails.captchaUrl);
    if (bannedCheck.isBanned) {
        logger.error(`[DataDomeSolver solveIfPresent] DataDome CAPTCHA indicates banned IP: ${bannedCheck.details}. Cannot solve.`);
        throw new CaptchaError('DataDome CAPTCHA indicates banned IP', {
            captchaUrl: captchaDetails.captchaUrl,
            reason: 'banned_ip',
            details: bannedCheck.details
        });
    }

    if (this.knownSitesManager) {
      try {
        const mainPageDomain = new URL(page.url()).hostname;
        const storedCookie = await this.knownSitesManager.getCaptchaCookie(mainPageDomain);

        if (storedCookie && storedCookie.value) {
          logger.info(`[DataDomeSolver solveIfPresent] Found stored DataDome cookie for ${mainPageDomain}. Attempting to use it.`);
          if (scraperSettings.debug) { 
            logger.debug(`[DEBUG_MODE] Stored cookie details: Name=${storedCookie.name}, Value=${storedCookie.value.substring(0,20)}...`);
          }
          const mainPageUrl = page.url();
          const cookieSet = await this.setStoredCookie(page, storedCookie, mainPageUrl); 
          if (cookieSet) {
            logger.debug(`[DataDomeSolver solveIfPresent] Stored cookie set. Reloading page: ${mainPageUrl}`);
            await page.reload({ waitUntil: 'networkidle2' });
            const captchaStillPresent = await this.detectCaptcha(page);
            if (!captchaStillPresent || !captchaStillPresent.isCaptchaPresent) {
              logger.info('[DataDomeSolver solveIfPresent] Successfully bypassed DataDome CAPTCHA using stored cookie.');
              return true;
            }
            logger.warn('[DataDomeSolver solveIfPresent] Stored DataDome cookie did not work, CAPTCHA still present. Proceeding to solve new CAPTCHA.');
          } else {
            logger.warn('[DataDomeSolver solveIfPresent] Failed to set stored DataDome cookie. Proceeding to solve new CAPTCHA.');
          }
        } else {
          logger.debug(`[DataDomeSolver solveIfPresent] No valid stored DataDome cookie found for ${mainPageDomain}.`);
        }
      } catch (e) {
        logger.warn(`[DataDomeSolver solveIfPresent] Error accessing/using stored cookie: ${e.message}. Proceeding to solve new CAPTCHA.`);
      }
    } else {
      logger.debug('[DataDomeSolver solveIfPresent] KnownSitesManager not available, cannot use stored cookies.');
    }

    return this.solve(page, captchaDetails);
  }

  async solve(page, captchaDetails) {
    const mainPageUrl = page.url();
    logger.info(`[DataDomeSolver solve] Solving DataDome CAPTCHA for ${mainPageUrl} (Captcha URL: ${captchaDetails.captchaUrl})`);
    if (scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE] CAPTCHA details for solving:`, captchaDetails);
    }

    const bannedIPCheck = this.checkBannedIP(captchaDetails.captchaUrl);
    if (bannedIPCheck.isBanned) {
      logger.error(`[DataDomeSolver solve] DataDome CAPTCHA indicates banned IP: ${bannedIPCheck.details}`);
      throw new CaptchaError('DataDome CAPTCHA indicates banned IP', {
        captchaUrl: captchaDetails.captchaUrl,
        reason: 'banned_ip',
        details: bannedIPCheck.details
      });
    }

    if (!this.createTaskUrl || !this.getResultUrl) {
        logger.error('[DataDomeSolver solve] 2Captcha URLs are not configured. Cannot solve.');
        throw new CaptchaError('2Captcha URLs not configured in DataDomeSolver.', { captchaUrl: captchaDetails.captchaUrl });
    }

    const cookieString = await this._solveWith2Captcha(captchaDetails);
    if (!cookieString) {
      logger.error('[DataDomeSolver solve] Failed to get DataDome cookie from 2Captcha.');
      throw new CaptchaError('Failed to get DataDome cookie from 2Captcha', { captchaUrl: captchaDetails.captchaUrl });
    }
    logger.debug(`[DataDomeSolver solve] Received cookie string from 2Captcha: ${cookieString.substring(0,50)}...`);

    const formattedCookie = this._formatDataDomeCookie(cookieString, mainPageUrl); 
    if (!formattedCookie) {
      logger.error('[DataDomeSolver solve] Failed to format DataDome cookie.');
      throw new CaptchaError('Failed to format DataDome cookie', { cookieString });
    }
    logger.debug(`[DataDomeSolver solve] Formatted cookie:`, formattedCookie);

    await page.setCookie(formattedCookie);
    logger.info('[DataDomeSolver solve] DataDome cookie set in browser.');

    if (this.knownSitesManager) {
      const domainToStore = new URL(mainPageUrl).hostname;
      logger.debug(`[DataDomeSolver solve] Storing DataDome cookie for domain: ${domainToStore}`);
      await this.knownSitesManager.storeCaptchaCookie(
        domainToStore,
        formattedCookie.name,
        formattedCookie.value
      );
    }

    logger.debug(`[DataDomeSolver solve] Reloading page after setting cookie: ${mainPageUrl}`);
    await page.reload({ waitUntil: 'networkidle2' });

    const captchaStillPresentAfterSolve = await this.detectCaptcha(page);
    if (captchaStillPresentAfterSolve && captchaStillPresentAfterSolve.isCaptchaPresent) {
      logger.error('[DataDomeSolver solve] DataDome CAPTCHA still present after solving and setting cookie.');
      throw new CaptchaError('DataDome CAPTCHA still present after solving', { captchaUrl: captchaDetails.captchaUrl });
    }

    logger.info('[DataDomeSolver solve] DataDome CAPTCHA solved successfully.');
    return true;
  }

  async setStoredCookie(page, storedCookie, targetUrl) {
    logger.debug(`[DataDomeSolver setStoredCookie] Setting stored cookie for URL: ${targetUrl}`);
    try {
      const cookie = {
        name: storedCookie.name,
        value: storedCookie.value,
        url: targetUrl, 
        domain: `.${new URL(targetUrl).hostname.replace(/^www\./, '')}`, 
        path: '/',
        secure: true,
        httpOnly: false, 
        sameSite: 'Lax',
      };
      if (scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE] Cookie object to set:`, cookie);
      }
      await page.setCookie(cookie);
      logger.info(`[DataDomeSolver setStoredCookie] Set stored DataDome cookie for ${targetUrl}`);
      return true;
    } catch (error) {
      logger.error(`[DataDomeSolver setStoredCookie] Failed to set stored DataDome cookie: ${error.message}`);
      if (scraperSettings.debug) {
        logger.error(`[DEBUG_MODE] Full error during setStoredCookie:`, error);
      }
      return false;
    }
  }

  checkBannedIP(captchaUrl) {
    logger.debug(`[DataDomeSolver checkBannedIP] Checking URL for banned IP indicators: ${captchaUrl}`);
    if (!captchaUrl || typeof captchaUrl !== 'string') {
        logger.warn(`[DataDomeSolver checkBannedIP] Invalid captchaUrl provided: ${captchaUrl}`);
        return { isBanned: false, details: 'Invalid CAPTCHA URL for banned IP check' };
    }
    try {
      const url = new URL(captchaUrl);
      const params = url.searchParams;
      const t = params.get('t');
      if (t === 'bv') { 
        logger.warn(`[DataDomeSolver checkBannedIP] 't=bv' parameter found, indicating banned IP.`);
        return { isBanned: true, details: "IP banned (t=bv parameter found)" };
      }
      if (params.has('cid') && (params.get('cid') || '').includes('block')) {
        logger.warn(`[DataDomeSolver checkBannedIP] 'cid' parameter contains 'block', may indicate banned IP.`);
        return { isBanned: true, details: `IP may be blocked (cid=${params.get('cid')})` };
      }
      logger.debug(`[DataDomeSolver checkBannedIP] No clear banned IP indicators found.`);
      return { isBanned: false, details: "No clear banned IP indicators." };
    } catch (error) {
      logger.warn(`[DataDomeSolver checkBannedIP] Error parsing DataDome CAPTCHA URL: ${error.message}`);
      if (scraperSettings.debug) {
        logger.warn(`[DEBUG_MODE] Full error during checkBannedIP URL parsing:`, error);
      }
      return { isBanned: false, details: `Error parsing CAPTCHA URL: ${error.message}` };
    }
  }

  async _solveWith2Captcha(captchaDetails) {
    logger.debug(`[DataDomeSolver _solveWith2Captcha] Preparing task for 2Captcha. CAPTCHA URL: ${captchaDetails.captchaUrl}`);
    const taskPayload = {
      clientKey: this.config.apiKey,
      task: {
        type: "DataDomeSliderTask",
        websiteURL: captchaDetails.mainPageUrl || new URL(captchaDetails.captchaUrl).origin, 
        captchaUrl: captchaDetails.captchaUrl,
      },
      softId: "YOUR_SOFT_ID" 
    };

    if (scraperSettings.httpProxy) { 
        try {
            const proxyUrl = new URL(scraperSettings.httpProxy);
            taskPayload.task.proxytype = proxyUrl.protocol.replace(':', '').toUpperCase();
            taskPayload.task.proxyAddress = proxyUrl.hostname;
            taskPayload.task.proxyPort = parseInt(proxyUrl.port, 10) || (taskPayload.task.proxytype === 'HTTPS' ? 443 : 80);
            if (proxyUrl.username) taskPayload.task.proxyLogin = decodeURIComponent(proxyUrl.username);
            if (proxyUrl.password) taskPayload.task.proxyPassword = decodeURIComponent(proxyUrl.password);
            logger.info(`[DataDomeSolver _solveWith2Captcha] Using proxy for DataDome CAPTCHA: ${taskPayload.task.proxytype}://${taskPayload.task.proxyAddress}:${taskPayload.task.proxyPort}`);
        } catch (error) {
            logger.warn(`[DataDomeSolver _solveWith2Captcha] Error parsing proxy URL: ${error.message}. Continuing without proxy for 2Captcha task.`);
            if (scraperSettings.debug) {
                logger.warn(`[DEBUG_MODE] Full error during proxy parsing for 2Captcha:`, error);
            }
            delete taskPayload.task.proxytype; 
            delete taskPayload.task.proxyAddress;
            delete taskPayload.task.proxyPort;
            delete taskPayload.task.proxyLogin;
            delete taskPayload.task.proxyPassword;
        }
    }
    
    const requestBody = taskPayload; 
    if (scraperSettings.debug) {
        logger.debug('[DEBUG_MODE] Sending DataDome CAPTCHA task to 2Captcha API:', requestBody);
    }

    let createTaskResponse;
    try {
      createTaskResponse = await axios.post(this.createTaskUrl, requestBody, { timeout: 20000 });
    } catch (error) {
      logger.error(`[DataDomeSolver _solveWith2Captcha] Error creating 2Captcha task: ${error.message}`);
      if (scraperSettings.debug) {
        logger.error(`[DEBUG_MODE] Full error during 2Captcha createTask:`, error);
      }
      throw new CaptchaError('Error submitting DataDome CAPTCHA to 2Captcha service', { originalError: error.message, details: error.response?.data });
    }

    if (createTaskResponse.data.errorId !== 0) {
      logger.error(`[DataDomeSolver _solveWith2Captcha] 2Captcha create task failed: ${createTaskResponse.data.errorCode} - ${createTaskResponse.data.errorDescription}`);
      throw new CaptchaError(\`2Captcha create task failed: \${createTaskResponse.data.errorCode}\`, {
        details: createTaskResponse.data.errorDescription,
        captchaUrl: captchaDetails.captchaUrl
      });
    }

    const taskId = createTaskResponse.data.taskId;
    logger.info(\`[DataDomeSolver _solveWith2Captcha] 2Captcha task ID: \${taskId}. Polling for result...\`);

    const pollingInterval = this.config.pollingInterval || 5000;
    const pollingTimeout = Date.now() + (this.config.defaultTimeout || 120) * 1000;

    while (Date.now() < pollingTimeout) {
      await new Promise(resolve => setTimeout(resolve, pollingInterval));
      logger.debug(\`[DataDomeSolver _solveWith2Captcha] Polling 2Captcha for DataDome task ID: \${taskId}...\`);
      try {
        const getResultResponse = await axios.post(this.getResultUrl, { clientKey: this.config.apiKey, taskId: taskId }, { timeout: 10000 });
        const solution = getResultResponse.data.solution;
        const status = getResultResponse.data.status;

        if (getResultResponse.data.errorId !== 0) {
            const errorCode = getResultResponse.data.errorCode;
            logger.error(\`[DataDomeSolver _solveWith2Captcha] 2Captcha get result failed: \${errorCode} - \${getResultResponse.data.errorDescription}\`);
            if (errorCode === 'ERROR_CAPTCHA_UNSOLVABLE') {
                throw new CaptchaError('DataDome CAPTCHA unsolvable', { taskId, errorCode });
            }
            throw new CaptchaError(\`DataDome CAPTCHA API error: \${errorCode}\`, { taskId, errorCode });
        }

        if (status === "ready") {
          logger.info(\`[DataDomeSolver _solveWith2Captcha] 2Captcha solved DataDome task ID: \${taskId}\`);
          if (solution && solution.cookie) {
            logger.info(\`[DataDomeSolver _solveWith2Captcha] 2Captcha DataDome cookie received: \${solution.cookie.substring(0,50)}...\`);
            return solution.cookie;
          } else {
            logger.error('[DataDomeSolver _solveWith2Captcha] 2Captcha DataDome solution missing cookie.');
            throw new CaptchaError('DataDome CAPTCHA solution missing cookie', { taskId, solution });
          }
        } else if (status === "processing") {
          logger.debug("[DataDomeSolver _solveWith2Captcha] 2Captcha still processing DataDome CAPTCHA...");
        } else {
          logger.warn(\`[DataDomeSolver _solveWith2Captcha] 2Captcha unknown status for DataDome CAPTCHA: \${status}\`);
        }
      } catch (pollError) {
        logger.warn(\`[DataDomeSolver _solveWith2Captcha] 2Captcha poll error for DataDome task ID \${taskId}: \${pollError.message}. Retrying poll...\`);
        if (scraperSettings.debug) {
            logger.error(\`[DEBUG_MODE] Full error during 2Captcha polling for task \${taskId}:\`, pollError);
        }
        await new Promise(resolve => setTimeout(resolve, pollingInterval / 2)); 
      }
    }

    logger.error(\`[DataDomeSolver _solveWith2Captcha] 2Captcha timeout for DataDome task ID: \${taskId}\`);
    throw new CaptchaError('DataDome CAPTCHA solution timed out', { taskId });
  }

  _formatDataDomeCookie(cookieString, targetUrl) {
    logger.info(`[DataDomeSolver _formatDataDomeCookie] Formatting DataDome cookie: ${cookieString.substring(0,50)}...`);
    try {
      if (!cookieString?.includes("=")) {
        logger.error("[DataDomeSolver _formatDataDomeCookie] DataDome cookie string format error: missing '='");
        return null;
      }

      const parts = cookieString.split(";").map(p => p.trim());
      const firstPart = parts[0].split("=");
      if (firstPart.length < 2) {
          logger.error("[DataDomeSolver _formatDataDomeCookie] Bad name/value in DataDome cookie from string:", parts[0]);
          return null;
      }
      const name = firstPart[0].trim();
      const value = firstPart.slice(1).join("=").trim();

      const cookie = {
        name: name,
        value: value,
        url: targetUrl, 
        path: '/',      
        secure: true,   
        httpOnly: false, 
        sameSite: 'Lax' 
      };

      try {
        const urlObj = new URL(targetUrl);
        cookie.domain = `.${urlObj.hostname.replace(/^www\./, '')}`;
      } catch (e) {
        logger.warn(`[DataDomeSolver _formatDataDomeCookie] Error extracting domain from URL: ${e.message}. Cookie domain might be incorrect.`);
        if (scraperSettings.debug) { 
            logger.warn(`[DEBUG_MODE] Full error during domain extraction for cookie formatting:`, e);
        }
      }
      
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i].trim();
        const [attrName, ...attrValueParts] = part.split("=");
        const attrNameLower = attrName.trim().toLowerCase();
        const attrValue = attrValueParts.join("=").trim();

        switch (attrNameLower) {
          case "domain":
            cookie.domain = attrValue.startsWith('.') ? attrValue : `.${attrValue}`;
            break;
          case "path":
            cookie.path = attrValue || "/";
            break;
          case "expires":
            try {
              cookie.expires = Math.floor(new Date(attrValue).getTime() / 1000);
            } catch (e) { /* ignore invalid date */ }
            break;
          case "max-age":
            try {
                const maxAgeSec = parseInt(attrValue, 10);
                if (!isNaN(maxAgeSec)) {
                  cookie.expires = Math.floor(Date.now() / 1000) + maxAgeSec;
                }
            } catch(e) {
                logger.warn(`[DataDomeSolver _formatDataDomeCookie] Error parsing max-age: ${e.message}`);
            }
            break;
          case "secure": 
            cookie.secure = true;
            break;
          case "httponly": 
            cookie.httpOnly = true;
            break;
          case "samesite":
            if (attrValue.toLowerCase() === 'lax') {
              cookie.sameSite = 'Lax';
            } else if (attrValue.toLowerCase() === 'strict') {
              cookie.sameSite = 'Strict';
            } else if (attrValue.toLowerCase() === 'none') {
              cookie.sameSite = 'None';
              cookie.secure = true; 
            }
            break;
        }
      }
      if (cookie.sameSite === 'None' && !cookie.secure) {
          logger.warn("[DataDomeSolver _formatDataDomeCookie] SameSite=None requires Secure attribute. Forcing Secure for cookie.");
          cookie.secure = true;
      }

      logger.debug(`[DataDomeSolver _formatDataDomeCookie] Formatted DataDome cookie:`, cookie);
      return cookie;
    } catch (error) {
      logger.error(`[DataDomeSolver _formatDataDomeCookie] DataDome cookie parsing error: ${error.message}`);
      if (scraperSettings.debug) { 
        logger.error(`[DEBUG_MODE] Full error during DataDome cookie parsing:`, error);
      }
      return null;
    }
  }
}

export { DataDomeSolver };
