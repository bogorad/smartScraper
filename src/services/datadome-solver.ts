// src/services/datadome-solver.ts
import axios, { AxiosError } from 'axios';
import { URL } from 'url';
import { logger } from '../utils/logger.js';
import { CaptchaError } from '../utils/error-handler.js';
import { scraperSettings, captchaSolverConfig as importedCaptchaConfig, CaptchaSolverConfig } from '../../config/index.js';
import { KnownSitesManager } from '../storage/known-sites-manager.js';
import { Page, Protocol } from 'puppeteer';

interface PuppeteerSetCookieParam {
    name: string;
    value: string;
    url?: string;
    domain?: string;
    path?: string;
    expires?: number; 
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
    priority?: Protocol.Network.CookiePriority;
    sameParty?: boolean;
    sourceScheme?: Protocol.Network.CookieSourceScheme;
    sourcePort?: number;
    partitionKey?: string; 
}

export interface DataDomeCaptchaDetails {
  isCaptchaPresent: boolean;
  captchaUrl?: string;
  sitekey?: string | null;
  type: 'DataDome';
  mainPageUrl?: string;
}

interface StoredCookie {
    name: string;
    value: string;
}

interface CheckBannedIPResult {
    isBanned: boolean;
    details: string;
}

interface TwoCaptchaProxyInfo {
    type: string; // HTTP, HTTPS, SOCKS4, SOCKS5
    address: string;
    port: number;
    login?: string;
    password?: string;
}

class DataDomeSolver {
  private config: CaptchaSolverConfig;
  private knownSitesManager?: KnownSitesManager;
  private twoCaptchaCreateTaskUrl: string;
  private twoCaptchaGetResultUrl: string;

  constructor(captchaConfig?: CaptchaSolverConfig, knownSitesManager?: KnownSitesManager) {
    this.config = captchaConfig || importedCaptchaConfig;
    this.knownSitesManager = knownSitesManager;

    // Use 2Captcha standard API endpoints
    this.twoCaptchaCreateTaskUrl = 'https://api.2captcha.com/createTask';
    this.twoCaptchaGetResultUrl = 'https://api.2captcha.com/getTaskResult';
    
    if (!this.config.apiKey) {
        logger.error('[DataDomeSolver constructor] Missing 2Captcha API key in captchaConfig.');
        // This should ideally be a fatal error, but constructor can't be async to throw and stop everything easily.
        // The methods using the API key will check and throw.
    }
    logger.info('DataDomeSolver initialized.');
  }

  private _parseProxyFor2Captcha(proxyString?: string): TwoCaptchaProxyInfo | null {
    if (!proxyString) return null;
    try {
        const url = new URL(proxyString);
        const type = url.protocol.replace(":", "").toUpperCase();
        if (!['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5'].includes(type)) {
            logger.warn(`[DataDomeSolver] Unsupported proxy protocol for 2Captcha: ${type}`);
            return null;
        }
        const address = url.hostname;
        const port = parseInt(url.port, 10);
        if (!address || !port || isNaN(port)) {
            logger.warn(`[DataDomeSolver] Invalid proxy address/port for 2Captcha: ${proxyString}`);
            return null;
        }
        return {
            type,
            address,
            port,
            login: url.username ? decodeURIComponent(url.username) : undefined,
            password: url.password ? decodeURIComponent(url.password) : undefined,
        };
    } catch (error: any) {
        logger.warn(`[DataDomeSolver] Error parsing proxy string for 2Captcha: ${proxyString}. Error: ${error.message}`);
        return null;
    }
  }


  async detectCaptcha(page: Page): Promise<DataDomeCaptchaDetails | null> {
    const currentUrl = page.url();
    logger.debug(`[DataDomeSolver detectCaptcha] Detecting CAPTCHA on ${currentUrl}`);
    try {
      const dataDomeCaptchaInfoFromPage: Omit<DataDomeCaptchaDetails, 'type'> & { type?: string } = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="captcha-delivery.com"], iframe[src*="geo.captcha-delivery.com"]');
        if (iframe) {
          const captchaUrl = (iframe as HTMLIFrameElement).src;
          let sitekey: string | null = null;
          return { isCaptchaPresent: true, captchaUrl, sitekey: sitekey, mainPageUrl: window.location.href };
        }
        return { isCaptchaPresent: false };
      });

      const dataDomeCaptchaInfo: DataDomeCaptchaDetails = {
        ...dataDomeCaptchaInfoFromPage,
        type: 'DataDome'
      };

      if (dataDomeCaptchaInfo.isCaptchaPresent) {
        logger.info(`[DataDomeSolver detectCaptcha] DataDome CAPTCHA detected with URL: ${dataDomeCaptchaInfo.captchaUrl}`);
        return dataDomeCaptchaInfo;
      }
    } catch (error: any) {
      logger.warn(`[DataDomeSolver detectCaptcha] Error during CAPTCHA detection: ${error.message}`);
    }
    logger.debug('[DataDomeSolver detectCaptcha] No DataDome CAPTCHA iframe found.');
    return null;
  }

  // Added userAgent parameter
  async solveIfPresent(page: Page, userAgent: string): Promise<boolean> {
    logger.debug(`[DataDomeSolver solveIfPresent] Checking for DataDome CAPTCHA on page: ${page.url()}`);
    const captchaDetails = await this.detectCaptcha(page);

    if (!captchaDetails || !captchaDetails.isCaptchaPresent) {
      logger.info('[DataDomeSolver solveIfPresent] No DataDome CAPTCHA detected.');
      return true; 
    }

    if (!captchaDetails.captchaUrl) {
        logger.error('[DataDomeSolver solveIfPresent] DataDome CAPTCHA detected but captchaUrl is missing.');
        throw new CaptchaError('DataDome CAPTCHA detected but captchaUrl is missing', { captchaDetails });
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
      } catch (e: any) {
        logger.warn(`[DataDomeSolver solveIfPresent] Error accessing/using stored cookie: ${e.message}. Proceeding to solve new CAPTCHA.`);
      }
    } else {
      logger.debug('[DataDomeSolver solveIfPresent] KnownSitesManager not available, cannot use stored cookies.');
    }

    return this.solve(page, captchaDetails, userAgent); // Pass userAgent
  }

  // Added userAgent parameter
  async solve(page: Page, captchaDetails: DataDomeCaptchaDetails, userAgent: string): Promise<boolean> {
    const mainPageUrl = page.url();
    logger.info(`[DataDomeSolver solve] Solving DataDome CAPTCHA for ${mainPageUrl} (Captcha URL: ${captchaDetails.captchaUrl})`);
    if (scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE] CAPTCHA details for solving:`, captchaDetails);
    }
    if (!captchaDetails.captchaUrl) {
        logger.error('[DataDomeSolver solve] captchaUrl is missing in captchaDetails.');
        throw new CaptchaError('captchaUrl missing for DataDome solve', { captchaDetails });
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

    const cookieString = await this._solveWith2Captcha(captchaDetails, userAgent); // Pass userAgent
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
        // Consider adding expiry from formattedCookie if available and manager supports it
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

  private async setStoredCookie(page: Page, storedCookie: StoredCookie, targetUrl: string): Promise<boolean> {
    logger.debug(`[DataDomeSolver setStoredCookie] Setting stored cookie for URL: ${targetUrl}`);
    try {
      const cookie: PuppeteerSetCookieParam = {
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
    } catch (error: any) {
      logger.error(`[DataDomeSolver setStoredCookie] Failed to set stored DataDome cookie: ${error.message}`);
      if (scraperSettings.debug) {
        logger.error(`[DEBUG_MODE] Full error during setStoredCookie:`, error);
      }
      return false;
    }
  }

  private checkBannedIP(captchaUrl: string): CheckBannedIPResult {
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
    } catch (error: any) {
      logger.warn(`[DataDomeSolver checkBannedIP] Error parsing DataDome CAPTCHA URL: ${error.message}`);
      if (scraperSettings.debug) {
        logger.warn(`[DEBUG_MODE] Full error during checkBannedIP URL parsing:`, error);
      }
      return { isBanned: false, details: `Error parsing CAPTCHA URL: ${error.message}` };
    }
  }

  // Added userAgent parameter
  private async _solveWith2Captcha(captchaDetails: DataDomeCaptchaDetails, userAgent: string): Promise<string | null> {
    logger.debug(`[DataDomeSolver _solveWith2Captcha] Preparing task for 2Captcha. CAPTCHA URL: ${captchaDetails.captchaUrl}, UA: ${userAgent.substring(0,50)}...`);
    
    if (!this.config.apiKey) {
        logger.error("[DataDomeSolver _solveWith2Captcha] 2Captcha API key is missing in configuration.");
        throw new CaptchaError("2Captcha API key is missing.", { captchaUrl: captchaDetails.captchaUrl });
    }
    if (!captchaDetails.captchaUrl) {
        logger.error("[DataDomeSolver _solveWith2Captcha] captchaUrl is missing in captchaDetails.");
        return null; // Or throw
    }
    if (captchaDetails.captchaUrl.includes('t=bv')) {
        logger.error("[DataDomeSolver _solveWith2Captcha] CaptchaUrl contains t=bv parameter. IP is banned by DataDome. Not sending to 2Captcha.");
        throw new CaptchaError("IP banned by DataDome (t=bv parameter found)", { captchaUrl: captchaDetails.captchaUrl, reason: 'BANNED_IP' });
    }
    if (!captchaDetails.captchaUrl.includes('t=fe')) {
        logger.warn("[DataDomeSolver _solveWith2Captcha] CaptchaUrl does not contain t=fe parameter. This might cause issues with solving. Continuing...");
    }

    const task: any = { // Define a more specific type if 2Captcha API is stable
        type: "DataDomeSliderTask",
        websiteURL: captchaDetails.mainPageUrl || new URL(captchaDetails.captchaUrl).origin, 
        captchaUrl: captchaDetails.captchaUrl,
        userAgent: userAgent, // Use the passed userAgent
    };

    const proxyInfoFor2Captcha = this._parseProxyFor2Captcha(scraperSettings.httpProxy);
    if (proxyInfoFor2Captcha) {
        task.proxyType = proxyInfoFor2Captcha.type;
        task.proxyAddress = proxyInfoFor2Captcha.address;
        task.proxyPort = proxyInfoFor2Captcha.port;
        if (proxyInfoFor2Captcha.login) task.proxyLogin = proxyInfoFor2Captcha.login;
        if (proxyInfoFor2Captcha.password) task.proxyPassword = proxyInfoFor2Captcha.password;
        logger.info(`[DataDomeSolver _solveWith2Captcha] Using proxy for 2Captcha task: ${task.proxyType}://${task.proxyAddress}:${task.proxyPort}`);
    }
    
    const requestBody = {
        clientKey: this.config.apiKey,
        task: task,
        softId: "YOUR_SOFT_ID" // Replace if you have one, otherwise 2Captcha might assign a default
    };
     
    if (scraperSettings.debug) {
        const loggedRequestBody = JSON.parse(JSON.stringify(requestBody)); // Deep copy for logging
        if (loggedRequestBody.task.proxyPassword) loggedRequestBody.task.proxyPassword = '***REDACTED***';
        logger.debug('[DEBUG_MODE][DataDomeSolver] Sending DataDome CAPTCHA task to 2Captcha API. Request Body:', JSON.stringify(loggedRequestBody, null, 2));
    }

    let createTaskResponse;
    try {
      createTaskResponse = await axios.post(this.twoCaptchaCreateTaskUrl, requestBody, { 
          timeout: 30000, // Increased timeout for create task
          headers: { 'Content-Type': 'application/json' }
      });
      if (scraperSettings.debug) {
        logger.debug('[DEBUG_MODE][DataDomeSolver] 2Captcha createTask response status:', createTaskResponse.status);
        logger.debug('[DEBUG_MODE][DataDomeSolver] 2Captcha createTask response data:', JSON.stringify(createTaskResponse.data, null, 2));
      }
    } catch (error: any) {
      const axiosError = error as AxiosError;
      logger.error(`[DataDomeSolver _solveWith2Captcha] Axios error creating 2Captcha task: ${axiosError.message}`);
      if (axiosError.response) {
        logger.error(`[DEBUG_MODE][DataDomeSolver] 2Captcha createTask Axios error response status: ${axiosError.response.status}`);
        logger.error('[DEBUG_MODE][DataDomeSolver] 2Captcha createTask Axios error response data:', JSON.stringify(axiosError.response.data, null, 2));
      } else if (axiosError.request) {
        logger.error('[DEBUG_MODE][DataDomeSolver] 2Captcha createTask Axios error: No response received.');
      } else {
        logger.error('[DEBUG_MODE][DataDomeSolver] 2Captcha createTask Axios error: Error setting up request.', axiosError.message);
      }
      throw new CaptchaError('Error submitting DataDome CAPTCHA to 2Captcha service', { originalError: error.message, details: axiosError.response?.data });
    }

    if (!createTaskResponse || !createTaskResponse.data) {
        logger.error('[DataDomeSolver _solveWith2Captcha] 2Captcha create task response or response.data is undefined.');
        throw new CaptchaError('2Captcha create task response invalid', { captchaUrl: captchaDetails.captchaUrl, responseData: createTaskResponse?.data });
    }
    
    // 2Captcha: errorId is 0 for success, non-zero for error. 'status' is 1 for success on /in.php
    if (createTaskResponse.data.errorId !== 0) {
      const errCode = createTaskResponse.data.errorCode || 'UNKNOWN_ERROR_CODE';
      const errDesc = createTaskResponse.data.errorDescription || createTaskResponse.data.request || 'No error description from 2Captcha.';
      logger.error(`[DataDomeSolver _solveWith2Captcha] 2Captcha API error (createTask): ${errCode} - ${errDesc}. Full response: ${JSON.stringify(createTaskResponse.data)}`);
      throw new CaptchaError(`2Captcha API error (createTask): ${errCode}`, {
        details: errDesc,
        captchaUrl: captchaDetails.captchaUrl,
        apiResponse: createTaskResponse.data
      });
    }
    if (!createTaskResponse.data.taskId) { // taskId should be present if errorId is 0
        logger.error(`[DataDomeSolver _solveWith2Captcha] 2Captcha create task succeeded (errorId=0) but no taskId returned. Response: ${JSON.stringify(createTaskResponse.data)}`);
        throw new CaptchaError('2Captcha create task did not return a taskId despite errorId=0.', { details: createTaskResponse.data, captchaUrl: captchaDetails.captchaUrl });
    }

    const taskId = createTaskResponse.data.taskId;
    logger.info(`[DataDomeSolver _solveWith2Captcha] 2Captcha task ID: ${taskId}. Polling for result...`);

    const pollingInterval = this.config.pollingInterval || 5000;
    const pollingTimeout = Date.now() + (this.config.defaultTimeout || 120) * 1000; // 2 minutes default

    while (Date.now() < pollingTimeout) {
      await new Promise(resolve => setTimeout(resolve, pollingInterval));
      logger.debug(`[DataDomeSolver _solveWith2Captcha] Polling 2Captcha for DataDome task ID: ${taskId}...`);
      try {
        const getResultResponse = await axios.post(this.twoCaptchaGetResultUrl, { clientKey: this.config.apiKey, taskId: taskId }, { 
            timeout: 20000,  // Timeout for polling request
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (scraperSettings.debug) {
            logger.debug('[DEBUG_MODE][DataDomeSolver] 2Captcha getResult response data:', JSON.stringify(getResultResponse.data, null, 2));
        }

        if (getResultResponse.data.errorId !== 0) { // errorId is 0 for success if status is "ready"
            const errorCode = getResultResponse.data.errorCode || 'POLL_ERROR';
            const errorDescription = getResultResponse.data.errorDescription || getResultResponse.data.request || 'Polling error from 2Captcha';
            logger.error(`[DataDomeSolver _solveWith2Captcha] 2Captcha get result API error: ${errorCode} - ${errorDescription}`);
            if (errorCode === 'ERROR_CAPTCHA_UNSOLVABLE') {
                throw new CaptchaError('DataDome CAPTCHA reported as unsolvable by 2Captcha', { taskId, errorCode, errorDescription });
            }
            // For other errors, continue polling unless it's a fatal error type
            if (['ERROR_WRONG_CAPTCHA_ID', 'ERROR_KEY_DOES_NOT_EXIST'].includes(errorCode)) {
                 throw new CaptchaError(`Fatal 2Captcha API error on getResult: ${errorCode}`, { taskId, errorCode, errorDescription });
            }
            // Continue polling for other non-fatal errors or if errorId is not 0 but status is not ready
        }

        const status = getResultResponse.data.status; // "processing" or "ready"
        if (status === "ready") {
          logger.info(`[DataDomeSolver _solveWith2Captcha] 2Captcha solved DataDome task ID: ${taskId}`);
          const solution = getResultResponse.data.solution;
          if (solution && solution.cookie) {
            logger.info(`[DataDomeSolver _solveWith2Captcha] 2Captcha DataDome cookie received: ${solution.cookie.substring(0,50)}...`);
            return solution.cookie;
          } else {
            logger.error('[DataDomeSolver _solveWith2Captcha] 2Captcha DataDome solution missing cookie field.');
            throw new CaptchaError('DataDome CAPTCHA solution missing cookie field', { taskId, solution });
          }
        } else if (status === "processing") {
          logger.debug("[DataDomeSolver _solveWith2Captcha] 2Captcha still processing DataDome CAPTCHA...");
        } else {
          // This case handles unexpected status strings or if status is missing but errorId was 0
          logger.warn(`[DataDomeSolver _solveWith2Captcha] 2Captcha unknown or non-processing status for DataDome CAPTCHA: ${status || JSON.stringify(getResultResponse.data)}`);
        }
      } catch (pollError: any) {
        const axiosPollError = pollError as AxiosError;
        logger.warn(`[DataDomeSolver _solveWith2Captcha] 2Captcha poll request error for task ID ${taskId}: ${axiosPollError.message}. Retrying poll...`);
        if (scraperSettings.debug) {
            if (axiosPollError.response) {
                logger.error(`[DEBUG_MODE][DataDomeSolver] 2Captcha poll Axios error response status: ${axiosPollError.response.status}`);
                logger.error('[DEBUG_MODE][DataDomeSolver] 2Captcha poll Axios error response data:', JSON.stringify(axiosPollError.response.data, null, 2));
            }
            logger.error(`[DEBUG_MODE][DataDomeSolver] Full error object during 2Captcha polling for task ${taskId}:`, pollError);
        }
        await new Promise(resolve => setTimeout(resolve, pollingInterval / 2)); 
      }
    }

    logger.error(`[DataDomeSolver _solveWith2Captcha] 2Captcha timeout for DataDome task ID: ${taskId}`);
    throw new CaptchaError('DataDome CAPTCHA solution timed out', { taskId });
  }

  private _formatDataDomeCookie(cookieString: string, targetUrl: string): PuppeteerSetCookieParam | null {
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

      const cookie: PuppeteerSetCookieParam = {
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
      } catch (e: any) {
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
              const expiresDate = new Date(attrValue);
              if (!isNaN(expiresDate.getTime())) {
                cookie.expires = Math.floor(expiresDate.getTime() / 1000);
              }
            } catch (e) { /* ignore invalid date */ }
            break;
          case "max-age":
            try {
                const maxAgeSec = parseInt(attrValue, 10);
                if (!isNaN(maxAgeSec)) {
                  cookie.expires = Math.floor(Date.now() / 1000) + maxAgeSec;
                }
            } catch(e: any) {
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
            const sameSiteValue = attrValue.toLowerCase() as 'strict' | 'lax' | 'none';
            if (['lax', 'strict', 'none'].includes(sameSiteValue)) {
              cookie.sameSite = sameSiteValue.charAt(0).toUpperCase() + sameSiteValue.slice(1) as 'Lax' | 'Strict' | 'None';
            }
            if (cookie.sameSite === 'None') {
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
    } catch (error: any) {
      logger.error(`[DataDomeSolver _formatDataDomeCookie] DataDome cookie parsing error: ${error.message}`);
      if (scraperSettings.debug) { 
        logger.error(`[DEBUG_MODE] Full error during DataDome cookie parsing:`, error);
      }
      return null;
    }
  }
}

export { DataDomeSolver };
