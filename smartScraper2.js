// smartScraper.js

// --- Required Libraries ---
require("dotenv").config(); // Load environment variables from .env file
const axios = require("axios"); // For making HTTP requests
const puppeteer = require("puppeteer-core"); // Use puppeteer-core
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto"); // For generating a hash for filenames (used in saveHtmlOnFailure)
const { URL } = require("url"); // For parsing URLs

// --- Configuration ---
const STORAGE_FILE_PATH = path.join(__dirname, "xpath_storage.json");
const LLM_API_BASE_URL = "https://openrouter.ai/api/v1";
const LLM_CHAT_COMPLETIONS_ENDPOINT = `${LLM_API_BASE_URL}/chat/completions`;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL;
const EXECUTABLE_PATH =
  process.env.EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"; // Adjust if needed
const EXTENSION_PATHS = process.env.EXTENSION_PATHS; // Optional: Path to browser extensions

// --- DataDome & 2Captcha Configuration ---
const TWOCAPTCHA_API_KEY = process.env.TWOCAPTCHA_API_KEY; // Your 2Captcha API Key
const MY_SOCKS5_PROXY = process.env.MY_SOCKS5_PROXY; // e.g., "socks5://user:pass@host:port" or "socks5://user:pass@host"
const DADADOME_DOMAINS = [ // Add domains known to use DataDome here (lowercase, no 'www.')
    "wsj.com",
];
const TWOCAPTCHA_CREATE_TASK_URL = "https://api.2captcha.com/createTask";
const TWOCAPTCHA_GET_RESULT_URL = "https://api.2captcha.com/getTaskResult";
const CAPTCHA_POLL_INTERVAL = 10000; // 10 seconds
const CAPTCHA_SOLVE_TIMEOUT = 180000; // 3 minutes

// Check required environment variables
if (!OPENROUTER_API_KEY) { console.error("FATAL: OPENROUTER_API_KEY environment variable is not set."); process.exit(1); }
if (!LLM_MODEL) { console.error("FATAL: LLM_MODEL environment variable is not set."); process.exit(1); }
if (!fs.existsSync(EXECUTABLE_PATH)) { console.warn(`WARN: EXECUTABLE_PATH "${EXECUTABLE_PATH}" does not exist. Puppeteer might fail.`); }
if (!TWOCAPTCHA_API_KEY) { console.error("FATAL: TWOCAPTCHA_API_KEY environment variable is not set."); process.exit(1); }
if (!MY_SOCKS5_PROXY) { console.error("FATAL: MY_SOCKS5_PROXY environment variable is not set."); process.exit(1); }


// --- Constants from find-xpath.js ---
const SCORE_WEIGHTS = { isSingleElement: 80, paragraphCount: 1, unwantedPenaltyRatio: -75, isSemanticTag: 75, hasDescriptiveIdOrClass: 30, textDensity: 50, linkDensityPenalty: -30, mediaPresence: 25, xpathComplexityPenalty: -5 };
const MIN_PARAGRAPH_THRESHOLD = 5;
const TAGS_TO_COUNT = [ "p", "nav", "aside", "footer", "header", "ul", "ol", "img", "a", "video", "audio", "picture" ];
const UNWANTED_TAGS = ["nav", "aside", "footer", "header"];
const MAX_LLM_RETRIES = 2;
const ENABLE_DEBUG_LOGGING = process.env.DEBUG === "true";
const SAVE_HTML_ON_FAILURE = process.env.SAVE_HTML_ON_FAILURE === "true";
const FAILED_HTML_DIR = path.join(__dirname, "failed_html_dumps");


// --- Logging Utility ---
const logInfo = (...args) => console.log("[INFO]", ...args);
const logDebug = (...args) => { if (ENABLE_DEBUG_LOGGING) console.log("[DEBUG]", ...args); };
const logWarn = (...args) => console.warn("[WARN]", ...args);
const logError = (...args) => console.error("[ERROR]", ...args);

// --- Storage Management ---
/**
 * Loads XPath data from the JSON storage file.
 * @returns {object} The stored domain-XPath mappings. Returns {} if file not found or invalid.
 */
const loadStorage = () => {
  try {
    if (fs.existsSync(STORAGE_FILE_PATH)) {
      const rawData = fs.readFileSync(STORAGE_FILE_PATH, "utf8");
      return JSON.parse(rawData);
    }
    logInfo(`Storage file not found at ${STORAGE_FILE_PATH}. Starting with empty storage.`);
    return {}; // Return empty object if file doesn't exist
  } catch (error) {
    logError(`Failed to load or parse storage file ${STORAGE_FILE_PATH}:`, error);
    return {}; // Return empty object on error
  }
};

/**
 * Saves the XPath data object to the JSON storage file.
 * @param {object} data - The domain-XPath mapping object to save.
 */
const saveStorage = (data) => {
  try {
    const jsonData = JSON.stringify(data, null, 2); // Pretty print JSON
    fs.writeFileSync(STORAGE_FILE_PATH, jsonData, "utf8");
    logDebug("Storage saved successfully.");
  } catch (error) {
    logError(`Failed to save storage file ${STORAGE_FILE_PATH}:`, error);
  }
};

/**
 * Extracts and normalizes the domain name from a URL.
 * Example: "https://www.example.com/page?a=1" -> "example.com"
 * @param {string} urlString - The URL to process.
 * @returns {string|null} The normalized domain name or null if URL is invalid.
 */
const getDomainFromUrl = (urlString) => {
  try {
    const url = new URL(urlString);
    let hostname = url.hostname;
    // Optional: Remove 'www.' prefix for consistency
    if (hostname.startsWith("www.")) {
      hostname = hostname.substring(4);
    }
    return hostname.toLowerCase(); // Use lowercase for consistent keys
  } catch (error) {
    logError(`Invalid URL format: ${urlString}`, error);
    return null;
  }
};


// --- Proxy Parsing Utility (ONLY for 2Captcha API call) ---
/**
 * Parses a proxy string into components needed ONLY for the 2Captcha API call.
 * Defaults to port 80 if not specified in the string.
 * @param {string} proxyString - The proxy URL string.
 * @returns {{ type: string, address: string, port: number, login?: string, password?: string } | null} Parsed proxy info or null on error.
 */
const parseProxyStringFor2Captcha = (proxyString) => {
    if (!proxyString) {
        logError("[2Captcha Proxy Parse] Proxy string is empty.");
        return null;
    }
    try {
        const url = new URL(proxyString);
        const type = url.protocol.replace(':', ''); // 'socks5'
        if (type !== 'socks5') {
            logError(`[2Captcha Proxy Parse] Unsupported proxy type: ${type}. Only socks5 is configured.`);
            return null;
        }
        const address = url.hostname;
        if (!address) { // Check for address first
             logError(`[2Captcha Proxy Parse] Invalid proxy format: Missing host in ${proxyString}`);
             return null;
        }

        let port = parseInt(url.port, 10); // Parse port

        // --- MODIFIED: Default port to 80 if missing/invalid ---
        if (!port || isNaN(port)) {
            logWarn(`[2Captcha Proxy Parse] Port not specified or invalid in "${proxyString}". Defaulting to 80 for 2Captcha API call.`);
            port = 80; // Default SOCKS port
        }
        // --- END MODIFICATION ---

        const login = url.username ? decodeURIComponent(url.username) : undefined;
        const password = url.password ? decodeURIComponent(url.password) : undefined;

        logDebug(`[2Captcha Proxy Parse] Parsed for API: type=${type}, address=${address}, port=${port}, login=${login ? '***' : 'N/A'}`);
        return { type, address, port, login, password };
    } catch (error) {
        logError(`[2Captcha Proxy Parse] Failed to parse proxy string "${proxyString}":`, error);
        return null;
    }
};
// Parse ONLY for 2Captcha API usage
const PROXY_INFO_FOR_2CAPTCHA = parseProxyStringFor2Captcha(MY_SOCKS5_PROXY);
if (!PROXY_INFO_FOR_2CAPTCHA) {
    logError("FATAL: Could not parse MY_SOCKS5_PROXY for 2Captcha API details. Please check the format in your .env file.");
    process.exit(1);
}

// --- Puppeteer and Extraction Logic ---

/**
 * Launches Puppeteer browser instance using the MY_SOCKS5_PROXY string directly.
 * NO parsing/reformatting for launch args. NO page.authenticate().
 * @param {boolean} debug - Enable debug logging.
 * @returns {Promise<{ browser: puppeteer.Browser, userDataDir: string }>} - Browser instance and user data directory path.
 * @throws {Error} - If browser launch fails.
 */
const launchPuppeteerBrowser = async (debug = false) => {
  let browser = null;
  let userDataDir = null;
  try {
    let extensionArgs = [];
    if (EXTENSION_PATHS) {
      logDebug(`[LAUNCH] Preparing extensions from: ${EXTENSION_PATHS}`);
      extensionArgs = [
        `--disable-extensions-except=${EXTENSION_PATHS}`,
        `--load-extension=${EXTENSION_PATHS}`,
      ];
    }
    userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "puppeteer-user-data-"),
    );
    logDebug(`[LAUNCH] Created temporary user data dir: ${userDataDir}`);

    // --- MODIFIED: Use MY_SOCKS5_PROXY directly "AS IS" ---
    const proxyArg = MY_SOCKS5_PROXY;
    logDebug(`[LAUNCH] Using proxy server argument directly "AS IS": ${proxyArg}`);
    // ---

    const launchArgs = [
      "--no-sandbox",
      `--proxy-server=${proxyArg}`, // Pass the raw string
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--use-gl=swiftshader",
      "--window-size=1280,720",
      "--font-render-hinting=none",
      ...extensionArgs,
    ];
    logDebug("[LAUNCH] Puppeteer launch arguments:", launchArgs);
    logDebug("[LAUNCH] Initializing browser instance...");
    browser = await puppeteer.launch({
      executablePath: EXECUTABLE_PATH,
      headless: false,
      userDataDir,
      args: launchArgs,
      dumpio: debug && process.env.NODE_ENV === "development",
      timeout: 60000,
    });
    logDebug("[LAUNCH] Browser launched successfully.");
    return { browser, userDataDir };
  } catch (error) {
    logError("[LAUNCH] Failed to launch browser:", error.message);
    if (userDataDir) {
      try {
        if (fs.rmSync) { fs.rmSync(userDataDir, { recursive: true, force: true }); }
        else { fs.rmdirSync(userDataDir, { recursive: true }); }
        logDebug("[LAUNCH] Cleaned up user data dir after launch failure.");
      } catch (e) { if (debug) logError("[LAUNCH] Error cleaning up user data dir:", e); }
    }
    throw error; // Re-throw
  }
};

/**
 * Cleans up Puppeteer resources (page, browser, user data directory).
 * @param {puppeteer.Page | null} page
 * @param {puppeteer.Browser | null} browser
 * @param {string | null} userDataDir
 * @param {boolean} debug
 */
const cleanupPuppeteer = async (page, browser, userDataDir, debug = false) => {
  logDebug("[CLEANUP] Starting Puppeteer cleanup...");
  if (page) { try { if (!page.isClosed()) { await page.close(); logDebug("[CLEANUP] Page closed."); } else { logDebug("[CLEANUP] Page was already closed."); } } catch (e) { if (debug) logError("[CLEANUP] Error closing page:", e); } }
  if (browser) { try { await browser.close(); logDebug("[CLEANUP] Browser closed."); } catch (e) { if (debug) logError("[CLEANUP] Error closing browser:", e); } }
  if (userDataDir) { logDebug(`[CLEANUP] Removing user data dir: ${userDataDir}`); try { if (fs.rmSync) { fs.rmSync(userDataDir, { recursive: true, force: true }); } else { fs.rmdirSync(userDataDir, { recursive: true }); } logDebug("[CLEANUP] User data dir removed."); } catch (err) { if (debug) logError("[CLEANUP] Failed to remove user data dir:", userDataDir, err); } }
  logDebug("[CLEANUP] Puppeteer cleanup finished.");
};


// --- DataDome CAPTCHA Solver ---

/**
 * Solves DataDome CAPTCHA using 2Captcha.
 * Uses parsed proxy details (PROXY_INFO_FOR_2CAPTCHA) for the API call.
 * @param {string} websiteURL - The target website URL.
 * @param {string} captchaUrl - The extracted CAPTCHA iframe src URL.
 * @param {string} userAgent - The User-Agent string used by Puppeteer.
 * @returns {Promise<string|null>} - The DataDome cookie string or null on failure.
 */
const solveDataDomeWith2Captcha = async (websiteURL, captchaUrl, userAgent) => {
    logInfo(`[2CAPTCHA] Attempting to solve DataDome for ${websiteURL}`);
    logDebug(`[2CAPTCHA] Captcha URL: ${captchaUrl}`);
    logDebug(`[2CAPTCHA] User Agent: ${userAgent}`);

    // 1. Prepare Task Payload - Use the specifically parsed info for 2Captcha
    const taskPayload = {
        type: "DataDomeSliderTask",
        websiteURL: websiteURL,
        captchaUrl: captchaUrl,
        userAgent: userAgent,
        proxyType: PROXY_INFO_FOR_2CAPTCHA.type,
        proxyAddress: PROXY_INFO_FOR_2CAPTCHA.address,
        proxyPort: PROXY_INFO_FOR_2CAPTCHA.port, // Will be 1080 if defaulted
        ...(PROXY_INFO_FOR_2CAPTCHA.login && { proxyLogin: PROXY_INFO_FOR_2CAPTCHA.login }),
        ...(PROXY_INFO_FOR_2CAPTCHA.password && { proxyPassword: PROXY_INFO_FOR_2CAPTCHA.password }),
    };

    // Log the full request body for debugging
    const requestBody = {
        clientKey: TWOCAPTCHA_API_KEY, // Note: Logging API key in debug mode
        task: taskPayload,
    };
    logDebug("[2CAPTCHA] Sending createTask request with body:", JSON.stringify(requestBody, null, 2));

    // 2. Create Task
    let taskId;
    try {
        const createTaskResponse = await axios.post(TWOCAPTCHA_CREATE_TASK_URL, requestBody, { timeout: 30000 });
        logDebug("[2CAPTCHA] createTask response:", createTaskResponse.data);
        if (createTaskResponse.data.errorId !== 0) {
            logError(`[2CAPTCHA] createTask failed: ${createTaskResponse.data.errorCode} - ${createTaskResponse.data.errorDescription}`);
            return null;
        }
        taskId = createTaskResponse.data.taskId;
        logInfo(`[2CAPTCHA] Task created successfully. Task ID: ${taskId}`);
    } catch (error) {
        logError("[2CAPTCHA] Error sending createTask request:", error.message);
        if (error.response) logError("[2CAPTCHA] Response data:", error.response.data);
        return null;
    }

    // 3. Poll for Result
    const startTime = Date.now();
    while (Date.now() - startTime < CAPTCHA_SOLVE_TIMEOUT) {
        logDebug(`[2CAPTCHA] Polling for result for Task ID: ${taskId}...`);
        try {
            await new Promise(resolve => setTimeout(resolve, CAPTCHA_POLL_INTERVAL));
            const getResultResponse = await axios.post(TWOCAPTCHA_GET_RESULT_URL, { clientKey: TWOCAPTCHA_API_KEY, taskId: taskId, }, { timeout: 15000 });
            logDebug("[2CAPTCHA] getTaskResult response:", getResultResponse.data);
            if (getResultResponse.data.errorId !== 0) {
                logError(`[2CAPTCHA] getTaskResult failed: ${getResultResponse.data.errorCode} - ${getResultResponse.data.errorDescription}`);
                if (getResultResponse.data.errorCode === 'ERROR_CAPTCHA_UNSOLVABLE' || getResultResponse.data.errorCode === 'ERR_PROXY_CONNECTION_FAILED') {
                    logError("[2CAPTCHA] CAPTCHA unsolvable or proxy failed according to 2Captcha worker. Check proxy validity/credentials sent to 2Captcha.");
                }
                return null;
            }
            const status = getResultResponse.data.status;
            if (status === "ready") {
                logInfo(`[2CAPTCHA] CAPTCHA solved successfully for Task ID: ${taskId}`);
                const solutionCookie = getResultResponse.data.solution?.cookie;
                if (!solutionCookie) { logError("[2CAPTCHA] Solution found but cookie is missing in response."); return null; }
                logDebug("[2CAPTCHA] Received Cookie:", solutionCookie);
                return solutionCookie;
            } else if (status === "processing") {
                logDebug("[2CAPTCHA] CAPTCHA is still processing...");
            } else {
                logWarn(`[2CAPTCHA] Unknown status received: ${status}`);
            }
        } catch (error) {
            logError(`[2CAPTCHA] Error polling getTaskResult for Task ID ${taskId}:`, error.message);
            if (error.response) logError("[2CAPTCHA] Response data:", error.response.data);
            await new Promise(resolve => setTimeout(resolve, CAPTCHA_POLL_INTERVAL / 2));
        }
    }
    logError(`[2CAPTCHA] CAPTCHA solving timed out after ${CAPTCHA_SOLVE_TIMEOUT / 1000} seconds for Task ID: ${taskId}.`);
    return null;
};

/**
 * Parses the datadome cookie string and formats it for page.setCookie.
 * @param {string} cookieString - e.g., "datadome=...; Path=/; Secure; SameSite=Lax"
 * @param {string} targetUrl - The original URL to extract the domain.
 * @returns {object | null} - Cookie object for Puppeteer or null if parsing fails.
 */
const formatDataDomeCookie = (cookieString, targetUrl) => {
    logDebug(`[Cookie] Formatting cookie string: ${cookieString}`);
    if (!cookieString || !cookieString.includes('=')) return null;
    try {
        const parts = cookieString.split(';').map(part => part.trim());
        const [name, ...valueParts] = parts[0].split('=');
        const value = valueParts.join('=');
        if (!name || !value) { logError("[Cookie] Failed to parse name/value from cookie string:", parts[0]); return null; }
        const cookie = { name: name.trim(), value: value.trim(), url: targetUrl, path: '/', secure: false, httpOnly: false, sameSite: 'Lax' };
        for (let i = 1; i < parts.length; i++) {
            const [attrName, ...attrValueParts] = parts[i].split('=');
            const attrValue = attrValueParts.join('=');
            switch (attrName.toLowerCase()) {
                case 'path': cookie.path = attrValue || '/'; break;
                case 'domain': cookie.domain = attrValue; break;
                case 'secure': cookie.secure = true; break;
                case 'samesite': if (['Lax', 'Strict', 'None'].includes(attrValue)) { cookie.sameSite = attrValue; } break;
                case 'httponly': cookie.httpOnly = true; break;
            }
        }
        if (!cookie.domain) { const parsedUrl = new URL(targetUrl); cookie.domain = parsedUrl.hostname; }
        logDebug("[Cookie] Formatted cookie object:", cookie);
        return cookie;
    } catch (error) { logError("[Cookie] Error parsing cookie string:", cookieString, error); return null; }
}

/**
 * Handles DataDome detection, solving, and cookie injection if needed.
 * NO page.authenticate() calls.
 * @param {puppeteer.Page} page
 * @param {string} url
 * @param {string} userAgent
 * @param {boolean} debug
 * @returns {Promise<boolean>} - true if successful or not needed, false on failure.
 */
const handleDataDomeIfNeeded = async (page, url, userAgent, debug = false) => {
    const domain = getDomainFromUrl(url);
    if (!DADADOME_DOMAINS.includes(domain)) {
        logDebug(`[DataDome] Domain "${domain}" not in DADADOME list. Skipping check.`);
        return true; // Not a target domain
    }

    logInfo(`[DataDome] Domain "${domain}" requires CAPTCHA check for URL: ${url}`);

    try {
        // --- REMOVED page.authenticate() call ---

        // 1. Initial Navigation to potentially trigger CAPTCHA
        logDebug("[DataDome] Performing initial navigation to detect CAPTCHA...");
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
        logDebug("[DataDome] Initial navigation complete. Checking for CAPTCHA iframe...");

        // 2. Detect CAPTCHA Iframe
        let captchaFrameElement;
        let captchaUrl;
        try {
            const iframeSelector = 'iframe[src*="captcha-delivery.com"]';
            await page.waitForSelector(iframeSelector, { timeout: 20000, visible: true });
            captchaFrameElement = await page.$(iframeSelector);
            if (!captchaFrameElement) throw new Error("CAPTCHA iframe selector matched but element not found.");
            captchaUrl = await page.evaluate(el => el.getAttribute('src'), captchaFrameElement);
            logInfo("[DataDome] Found CAPTCHA iframe.");
            logDebug(`[DataDome] Extracted captchaUrl: ${captchaUrl}`);
            if (!captchaUrl) { throw new Error("Found CAPTCHA iframe but could not extract src attribute."); }
        } catch (error) {
            logWarn(`[DataDome] CAPTCHA iframe not detected within timeout or error extracting src for ${url}. Assuming no CAPTCHA or page loaded correctly. Error: ${error.message}`);
            const pageTitle = await page.title();
            const bodyText = await page.evaluate(() => document.body.innerText.toLowerCase());
            if (pageTitle.toLowerCase().includes('blocked') || bodyText.includes('enable javascript') || bodyText.includes('checking your browser')) {
                 logError(`[DataDome] Page content suggests a block even though iframe wasn't found. Title: ${pageTitle}`);
                 return false;
            }
            logInfo("[DataDome] Proceeding, assuming page loaded without CAPTCHA block this time.");
            return true;
        }

        // 3. Check 't' parameter in captchaUrl
         try {
            const fullCaptchaUrl = new URL(captchaUrl, url);
            const tParam = fullCaptchaUrl.searchParams.get('t');
            logDebug(`[DataDome] Found 't' parameter value: ${tParam}`);
            if (tParam === 'bv') { logError(`[DataDome] IP address is banned (t=bv detected in captchaUrl). Change proxy IP and retry.`); return false; }
            if (tParam !== 'fe') { logWarn(`[DataDome] Unexpected 't' parameter value found: ${tParam}. Expected 'fe'. Proceeding cautiously.`); }
        } catch (e) { logError("[DataDome] Failed to parse captchaUrl or get 't' parameter:", e); return false; }


        // 4. Solve CAPTCHA via 2Captcha
        const dataDomeCookieString = await solveDataDomeWith2Captcha(url, captchaUrl, userAgent);
        if (!dataDomeCookieString) { logError("[DataDome] Failed to solve CAPTCHA via 2Captcha."); return false; }


        // 5. Set Cookie in Browser
        const cookieObject = formatDataDomeCookie(dataDomeCookieString, url);
        if (!cookieObject) { logError("[DataDome] Failed to parse the solved datadome cookie string."); return false; }
        try {
            logInfo("[DataDome] Setting solved CAPTCHA cookie...");
            await page.setCookie(cookieObject);
            logInfo("[DataDome] Cookie set successfully.");
        } catch (error) { logError("[DataDome] Failed to set cookie in Puppeteer:", error); return false; }


        // --- REMOVED page.authenticate() call before reload ---

        // 6. Reload page with the cookie
        logInfo("[DataDome] Reloading page with the CAPTCHA cookie...");
        await page.reload({ waitUntil: "networkidle2", timeout: 45000 });
        logInfo("[DataDome] Page reloaded successfully after setting cookie.");
        const reloadedTitle = await page.title();
        if (reloadedTitle.toLowerCase().includes('blocked')) { logError("[DataDome] Page still shows blocked title after reload with cookie."); return false; }

        return true; // CAPTCHA handled successfully

    } catch (error) {
        logError(`[DataDome] Error during CAPTCHA handling process for ${url}:`, error);
        if (error.message) { logError(`[DataDome] Puppeteer error detail: ${error.message}`); }
        return false; // Indicate failure
    }
};

/**
 * Navigates the page, handles potential DataDome, and performs initial interactions.
 * NO page.authenticate() calls.
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @param {string} url - The URL to navigate to.
 * @param {boolean} debug - Debug flag.
 * @returns {Promise<boolean>} - True if navigation and CAPTCHA handling (if applicable) was successful, false otherwise.
 */
const navigateAndPreparePage = async (page, url, debug = false) => {
  logDebug("[NAVIGATE] Setting Viewport and User-Agent...");
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  await page.setViewport({ width: 1280, height: 720 });
  await page.setUserAgent(userAgent);

  // --- REMOVED page.authenticate() call ---

  // --- Handle DataDome ---
  const captchaHandled = await handleDataDomeIfNeeded(page, url, userAgent, debug);
  if (!captchaHandled) {
      logError(`[NAVIGATE] Failed to handle DataDome CAPTCHA for ${url}. Aborting navigation/scraping.`);
      return false; // Indicate failure
  }

  // Check if we still need to navigate
  const currentUrl = page.url();
  const domain = getDomainFromUrl(url);
  const wasDataDomeDomain = DADADOME_DOMAINS.includes(domain);

  if (currentUrl !== url && !wasDataDomeDomain) {
      logDebug(`[NAVIGATE] Loading URL (post-CAPTCHA check): ${url}`);
      try {
          // --- REMOVED safety page.authenticate() call ---
          await page.goto(url, { waitUntil: "networkidle2", timeout: 45000, });
          logDebug(`[NAVIGATE] Page loaded successfully: ${url}`);
      } catch (navError) {
          logError(`[NAVIGATE] Error during final page.goto for ${url}:`, navError);
          return false; // Navigation failed
      }
  } else {
      logDebug(`[NAVIGATE] Page should already be loaded at ${currentUrl} (or was handled by DataDome). Skipping redundant goto.`);
      try { await page.waitForTimeout(2000); } catch (e) { logWarn("Wait for timeout failed, page might be unstable."); }
  }

  // Mouse move, scroll, delay
  logDebug(`[NAVIGATE END] move and scroll.`);
  try { await page.mouse.move(100, 100); await page.evaluate(() => window.scrollBy(0, 200)); }
  catch (interactionError) { logWarn("[NAVIGATE] Error during post-load mouse/scroll interaction:", interactionError.message); }
  const postNavDelay = 3000;
  logDebug(`[DELAY] Waiting ${postNavDelay / 1000} seconds after navigation/preparation...`);
  await new Promise((resolve) => setTimeout(resolve, postNavDelay));

  return true; // Navigation and preparation successful
};

/**
 * Gets the full HTML content of the page.
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @returns {Promise<string|null>} - The HTML content or null on error.
 */
const getHtmlContent = async (page) => {
    logDebug("[Puppeteer] Getting full page HTML..."); try { const html = await page.content(); logDebug("[Puppeteer] Full HTML fetched."); return html; } catch (error) { logError("[Puppeteer] Error getting full HTML:", error.message); return null; }
};

/**
 * Extracts text snippets from common elements.
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @param {number} numSnippets - Max number of snippets.
 * @param {number} minLength - Minimum text length.
 * @returns {Promise<string[]>} - Array of text snippets.
 */
const extractArticleSnippets = async ( page, numSnippets = 5, minLength = 50 ) => {
    logDebug("[Puppeteer] Extracting text snippets..."); const selector = "p, h2, h3, li, blockquote"; try { const snippets = await page.$$eval( selector, (elements, minLength, numSnippets) => { const results = []; for (const el of elements) { if (!el.offsetParent && el.tagName !== "BODY") continue; if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue; const text = el.textContent.trim(); if (text.length >= minLength) { results.push(text.substring(0, 200)); if (results.length >= numSnippets) break; } } return results; }, minLength, numSnippets ); logDebug(`[Puppeteer] Extracted ${snippets.length} snippets.`); return snippets; } catch (error) { logError(`[Puppeteer] Error extracting text snippets: ${error.message}`); return []; }
};

/**
 * Queries elements by XPath and gets details for the first matched element.
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @param {string} xpath - The XPath to query.
 * @param {string[]} tagsToCount - Array of tag names to count descendants.
 * @returns {Promise<{ count: number, firstElementDetails: object | null }>}
 */
const queryXPathWithDetails = async (page, xpath, tagsToCount) => {
    logDebug(`[Puppeteer] Querying XPath: ${xpath}`); try { const result = await page.evaluate( (xpathSelector, tagsToCount) => { try { const evaluateResult = document.evaluate( xpathSelector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null ); const count = evaluateResult.snapshotLength; let firstElementDetails = null; if (count > 0) { const firstNode = evaluateResult.snapshotItem(0); if (firstNode && firstNode.nodeType === Node.ELEMENT_NODE) { const el = firstNode; const descendantCounts = {}; tagsToCount.forEach((tag) => { descendantCounts[tag] = el.querySelectorAll(tag).length; }); const totalDescendantElements = el.querySelectorAll("*").length; firstElementDetails = { tagName: el.tagName.toUpperCase(), id: el.id, className: el.className, descendantCounts: descendantCounts, textContent: el.textContent.substring(0, 500), innerHTML: el.innerHTML.substring(0, 1000), totalDescendantElements: totalDescendantElements, }; } } return { count, firstElementDetails }; } catch (evalError) { console.error(`XPath evaluation error for "${xpathSelector}": ${evalError.message}`); return { count: -1, firstElementDetails: null, error: evalError.message }; } }, xpath, tagsToCount ); if (result.count === -1) { logWarn(`[Puppeteer] Error evaluating XPath "${xpath}" in browser: ${result.error}`); return { count: 0, firstElementDetails: null }; } logDebug(`[Puppeteer] XPath query "${xpath}" found ${result.count} elements.`); if (result.count > 0 && result.firstElementDetails) { logDebug(`[Puppeteer] Details obtained for first element (Tag: ${result.firstElementDetails.tagName}, Paragraphs: ${result.firstElementDetails.descendantCounts?.p || 0}).`); } else if (result.count > 0 && !result.firstElementDetails) { logWarn(`[Puppeteer] XPath "${xpath}" found elements, but could not get details for the first one.`); } return result; } catch (error) { logDebug(`[Puppeteer] Error querying XPath ${xpath}: ${error.message}`); return { count: 0, firstElementDetails: null }; }
};

/**
 * Scores a potential article container element.
 * @param {object} elementDetails - Details from queryXPathWithDetails.
 * @param {number} totalElementsFoundByXPath - Total elements matched by XPath.
 * @param {string} xpath - The XPath string.
 * @returns {number} - The calculated score. Returns 0 if basic criteria fail.
 */
const scoreElement = (elementDetails, totalElementsFoundByXPath, xpath) => {
    const scoreLog = (...args) => { if (ENABLE_DEBUG_LOGGING) console.log("[SCORE]", ...args); }; if (!elementDetails || !elementDetails.descendantCounts) { scoreLog(`Missing element details for ${xpath}. Score: 0`); return 0; } let score = 0; const { tagName, id, className, descendantCounts, textContent, innerHTML, totalDescendantElements } = elementDetails; const pCount = descendantCounts["p"] || 0; const unwantedCount = UNWANTED_TAGS.reduce((sum, tag) => sum + (descendantCounts[tag] || 0), 0); const linkCount = descendantCounts["a"] || 0; const mediaCount = (descendantCounts["img"] || 0) + (descendantCounts["video"] || 0) + (descendantCounts["audio"] || 0) + (descendantCounts["picture"] || 0); if (pCount < MIN_PARAGRAPH_THRESHOLD) { scoreLog(`${xpath} failed min paragraph threshold (${pCount} < ${MIN_PARAGRAPH_THRESHOLD}). Score: 0`); return 0; } score += pCount * SCORE_WEIGHTS.paragraphCount; scoreLog(`${xpath} - Paragraphs (${pCount}): +${(pCount * SCORE_WEIGHTS.paragraphCount).toFixed(2)}`); if (totalDescendantElements > 0 && unwantedCount > 0) { const unwantedRatio = unwantedCount / totalDescendantElements; const penalty = unwantedRatio * SCORE_WEIGHTS.unwantedPenaltyRatio; score += penalty; scoreLog(`${xpath} - Unwanted ratio (${unwantedRatio.toFixed(2)}): ${penalty.toFixed(2)}`); } else if (unwantedCount > 0) { score += unwantedCount * SCORE_WEIGHTS.unwantedPenaltyRatio * 0.5; scoreLog(`${xpath} - Unwanted tags (${unwantedCount}, total elements 0): ${(unwantedCount * SCORE_WEIGHTS.unwantedPenaltyRatio * 0.5).toFixed(2)}`); } if (tagName === "ARTICLE" || tagName === "MAIN") { score += SCORE_WEIGHTS.isSemanticTag; scoreLog(`${xpath} - Semantic tag (${tagName}): +${SCORE_WEIGHTS.isSemanticTag}`); } const descriptiveRegex = /article|content|body|story|main|post|entry|text|copy/i; if ((id && descriptiveRegex.test(id)) || (className && descriptiveRegex.test(className))) { score += SCORE_WEIGHTS.hasDescriptiveIdOrClass; scoreLog(`${xpath} - Descriptive ID/Class: +${SCORE_WEIGHTS.hasDescriptiveIdOrClass}`); } if (innerHTML && innerHTML.length > 0) { const plainText = textContent ? textContent.trim() : ""; const htmlLength = innerHTML.length; const textLength = plainText.length; if (htmlLength > 0) { const textDensity = textLength / htmlLength; const densityBonus = textDensity * SCORE_WEIGHTS.textDensity; score += densityBonus; scoreLog(`${xpath} - Text Density (${textDensity.toFixed(2)}): +${densityBonus.toFixed(2)}`); } } if (totalDescendantElements > 0 && linkCount > 0) { const linkDensity = linkCount / totalDescendantElements; const linkPenalty = linkDensity * SCORE_WEIGHTS.linkDensityPenalty; score += linkPenalty; scoreLog(`${xpath} - Link Density (${linkDensity.toFixed(2)}): ${linkPenalty.toFixed(2)}`); } if (mediaCount > 0) { score += SCORE_WEIGHTS.mediaPresence; scoreLog(`${xpath} - Media Presence (${mediaCount}): +${SCORE_WEIGHTS.mediaPresence}`); } const xpathComplexity = xpath.split("/").length + (xpath.match(/\[.*?\]/g) || []).length; const complexityPenalty = xpathComplexity * SCORE_WEIGHTS.xpathComplexityPenalty; score += complexityPenalty; scoreLog(`${xpath} - XPath Complexity (${xpathComplexity}): ${complexityPenalty.toFixed(2)}`); const isSingleElement = totalElementsFoundByXPath === 1; if (isSingleElement) { score += SCORE_WEIGHTS.isSingleElement; scoreLog(`${xpath} - Single element bonus: +${SCORE_WEIGHTS.isSingleElement}`); } else { scoreLog(`${xpath} - Found ${totalElementsFoundByXPath} elements (not single).`); } scoreLog(`${xpath} - Final Score: ${score.toFixed(2)}`); return score;
};

/**
 * Calls the LLM API to get candidate XPaths.
 * @param {string} htmlContent - Full HTML.
 * @param {string[]} anchorSnippets - Text snippets.
 * @param {Array<{xpath: string, result: string}>} [feedback=[]] - Feedback from previous attempts.
 * @returns {Promise<string[]>} - Array of candidate XPaths.
 */
const getLlmCandidateXPaths = async ( htmlContent, anchorSnippets, feedback = [], ) => {
    logInfo("[LLM API] Requesting candidate XPaths from OpenRouter..."); const MAX_HTML_LENGTH = 100000; const truncatedHtml = htmlContent.length > MAX_HTML_LENGTH ? htmlContent.substring(0, MAX_HTML_LENGTH) + "\n... (HTML truncated)" : htmlContent; let prompt = `Analyze the following HTML source code. Identify the XPath for the single, primary content container (e.g., article body, main text, blog post). Exclude headers, footers, navigation menus, sidebars, comment sections, and related articles links. Prioritize semantic tags like <article> or <main>, or elements with descriptive IDs/classes (e.g., "content", "article-body", "main-story", "post-content"). Aim for the most specific XPath that uniquely identifies the main content block.`; if (anchorSnippets && anchorSnippets.length > 0) { prompt += `\nThe content likely includes text similar to these snippets: ${JSON.stringify(anchorSnippets)}. Use these as hints for locating the correct container.`; } else { prompt += `\nNo specific text snippets available; rely heavily on HTML structure, semantic tags, and descriptive IDs/classes.`; } if (feedback && feedback.length > 0) { prompt += `\n\nFeedback on previous XPath attempts:`; feedback.forEach((item) => { const cleanResult = item.result.replace(/"/g, "'").substring(0, 150); prompt += `\n- "${item.xpath}": ${cleanResult}`; }); prompt += `\nPlease suggest *different* and potentially *more specific* XPaths based on this feedback. Avoid repeating failed patterns or overly generic selectors like "//div". Focus on attributes or deeper paths if necessary.`; } else { prompt += `\n\nProvide a list of the most likely candidate XPaths.`; } prompt += `\n**IMPORTANT:** Respond ONLY with a JSON array of strings, where each string is a valid XPath selector. Example: ["//article[@id='main-content']", "//div[contains(@class, 'post-body')]"]`; try { const response = await axios.post( LLM_CHAT_COMPLETIONS_ENDPOINT, { model: LLM_MODEL, messages: [ { role: "system", content: "You are an expert HTML analyzer specializing in identifying the main content container. You provide only valid XPaths in JSON array format. Respond ONLY with the JSON array." }, { role: "user", content: prompt + "\n\nHTML (potentially truncated):\n" + truncatedHtml }, ], }, { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json", "X-Title": "smartScraper", "HTTP-Referer": "https://github.com/bogorad/smartScraper" }, timeout: 45000, }, ); if (!response.data || !response.data.choices || response.data.choices.length === 0) { logWarn("[LLM API] LLM response missing choices."); logDebug("[LLM API] Response data:", response.data); return []; } const llmResponseContent = response.data.choices[0].message.content; logDebug("[LLM API] Raw response content:", llmResponseContent); let contentToParse = llmResponseContent.trim(); const jsonCodeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/; const match = contentToParse.match(jsonCodeBlockRegex); if (match && match[1]) { logDebug("[LLM API] Detected JSON in markdown code block. Extracting..."); contentToParse = match[1].trim(); } if (!contentToParse.startsWith('[')) { const arrayStartIndex = contentToParse.indexOf('['); if (arrayStartIndex !== -1) { logDebug("[LLM API] Attempting to extract JSON array starting mid-response."); contentToParse = contentToParse.substring(arrayStartIndex); } } if (!contentToParse.endsWith(']')) { const arrayEndIndex = contentToParse.lastIndexOf(']'); if (arrayEndIndex !== -1) { logDebug("[LLM API] Attempting to trim trailing text after JSON array."); contentToParse = contentToParse.substring(0, arrayEndIndex + 1); } } try { const candidateXPaths = JSON.parse(contentToParse); if (Array.isArray(candidateXPaths) && candidateXPaths.every((item) => typeof item === "string")) { const validLookingXPaths = candidateXPaths.filter(xpath => xpath && (xpath.startsWith('/') || xpath.startsWith('.'))); if (validLookingXPaths.length !== candidateXPaths.length) { logWarn("[LLM API] Filtered out some potentially invalid XPath strings from LLM response."); } logInfo(`[LLM API] Parsed ${validLookingXPaths.length} candidate XPaths.`); return validLookingXPaths; } else { logError("[LLM API] Parsed content is not a valid JSON array of strings:", contentToParse); return []; } } catch (parseError) { logError("[LLM API] Failed to parse JSON from LLM response:", parseError.message); logError("[LLM API] Content that failed parsing:", contentToParse); return []; } } catch (error) { logError(`[LLM API] Error calling OpenRouter API: ${error.message}`); if (error.response) { logError("[LLM API] Response Status:", error.response.status); logError("[LLM API] Response Data:", error.response.data); } else if (error.request) { logError("[LLM API] No response received from OpenRouter."); } return []; }
};

/**
 * Saves HTML content to a file on failure.
 * @param {string} url - The original URL.
 * @param {string} htmlContent - The HTML content to save.
 */
const saveHtmlOnFailure = async (url, htmlContent) => {
    if (!SAVE_HTML_ON_FAILURE) return; if (!htmlContent) { logWarn("[Save HTML] No HTML content provided to save."); return; } try { await fs.promises.mkdir(FAILED_HTML_DIR, { recursive: true }); const urlHash = crypto.createHash("md5").update(url).digest("hex").substring(0, 8); const timestamp = new Date().toISOString().replace(/[:.-]/g, "_"); const filename = `failed_${timestamp}_${urlHash}.html`; const filePath = path.join(FAILED_HTML_DIR, filename); await fs.promises.writeFile(filePath, htmlContent, "utf8"); logInfo(`[Save HTML] Successfully saved failed HTML for ${url} to ${filePath}`); } catch (error) { logError(`[Save HTML] Failed to save HTML for ${url}: ${error.message}`); }
};

/**
 * Attempts to find the best XPath and extract its content using the LLM approach.
 * NO page.authenticate() calls.
 * @param {string} url - The URL of the page.
 * @param {boolean} debug - Enable debug logging.
 * @returns {Promise<{foundXPath: string, extractedHtml: string} | null>} - The best XPath and its HTML content, or null if failed.
 */
const findArticleXPathAndExtract = async (url, debug = false) => {
  logInfo(`--- Starting XPath discovery and extraction for: ${url} ---`);
  let browser = null;
  let userDataDir = null;
  let page = null;
  let htmlContent = null;
  let bestCandidateXPath = null;
  let extractedHtml = null;

  try {
    const launchResult = await launchPuppeteerBrowser(debug); // Launches WITH proxy "AS IS"
    browser = launchResult.browser;
    userDataDir = launchResult.userDataDir;
    page = await browser.newPage();

    // --- REMOVED page.authenticate() call ---

    // --- navigateAndPreparePage uses the page ---
    const navigationSuccessful = await navigateAndPreparePage(page, url, debug);
    if (!navigationSuccessful) {
        throw new Error("Page navigation or CAPTCHA handling failed.");
    }

    htmlContent = await getHtmlContent(page);
    if (!htmlContent) { throw new Error("Failed to get HTML content after navigation."); }

    const anchorSnippets = await extractArticleSnippets(page);
    if (anchorSnippets.length === 0) { logWarn("Could not extract text snippets for LLM context."); }

    let allTriedXPaths = new Set();
    let feedbackForLLM = [];
    let scoredCandidates = [];

    for (let retry = 0; retry <= MAX_LLM_RETRIES; retry++) {
      logInfo(`--- LLM Interaction Attempt ${retry + 1}/${MAX_LLM_RETRIES + 1} ---`);
      const llmCandidateXPaths = await getLlmCandidateXPaths( htmlContent, anchorSnippets, retry > 0 ? feedbackForLLM : [], );
      if (llmCandidateXPaths.length === 0) { logWarn(`LLM returned no candidates on attempt ${retry + 1}.`); if (retry === MAX_LLM_RETRIES) break; await new Promise(resolve => setTimeout(resolve, 2000)); continue; }
      const newCandidateXPaths = llmCandidateXPaths.filter( (xpath) => !allTriedXPaths.has(xpath), );
      if (newCandidateXPaths.length === 0) { logWarn(`LLM returned only previously tried XPaths on attempt ${retry + 1}.`); if (retry === MAX_LLM_RETRIES) break; await new Promise(resolve => setTimeout(resolve, 2000)); continue; }
      logInfo(`Validating ${newCandidateXPaths.length} new candidate XPaths...`);
      feedbackForLLM = [];
      const validationPromises = newCandidateXPaths.map((xpath) => { allTriedXPaths.add(xpath); return queryXPathWithDetails(page, xpath, TAGS_TO_COUNT).then( (result) => ({ xpath, ...result }), ); });
      const validationResults = await Promise.all(validationPromises);
      const validResults = validationResults.filter(r => r && r.xpath);
      let currentAttemptFoundGoodCandidate = false;
      for (const result of validResults) {
        const { xpath, count, firstElementDetails } = result;
        if (count === 0) { logDebug(`Validation: XPath "${xpath}" found 0 elements.`); feedbackForLLM.push({ xpath, result: "Found 0 elements." }); continue; }
        const score = scoreElement(firstElementDetails, count, xpath);
        if (score > 0) { scoredCandidates.push({ xpath, score, elementDetails: firstElementDetails }); logDebug(`Validation: XPath "${xpath}" PASSED scoring with score ${score.toFixed(2)}.`); currentAttemptFoundGoodCandidate = true; }
        else { logDebug(`Validation: XPath "${xpath}" FAILED scoring.`); const pCount = firstElementDetails?.descendantCounts?.p || 0; let reason = `Found ${count} elements. Scored ${score.toFixed(2)}.`; if (pCount < MIN_PARAGRAPH_THRESHOLD) reason += ` Low paragraphs (${pCount}).`; feedbackForLLM.push({ xpath, result: reason }); }
      }
      if (currentAttemptFoundGoodCandidate) { logInfo(`Found promising candidate(s) in attempt ${retry + 1}. Evaluating best overall.`); }
      else { logWarn(`No valid candidates found in attempt ${retry + 1}.`); }
      if (retry < MAX_LLM_RETRIES && !currentAttemptFoundGoodCandidate) { await new Promise(resolve => setTimeout(resolve, 1500)); }
    } // End LLM retry loop

    if (scoredCandidates.length > 0) { scoredCandidates.sort((a, b) => b.score - a.score); bestCandidateXPath = scoredCandidates[0].xpath; logInfo(`Selected best overall XPath: ${bestCandidateXPath} with score ${scoredCandidates[0].score.toFixed(2)}`); }
    else { logError("No valid XPath candidates found after all LLM retries."); }

    if (bestCandidateXPath) {
      logInfo(`Attempting to extract content using discovered XPath: ${bestCandidateXPath}`);
      try {
        extractedHtml = await page.evaluate((xpath) => { try { const result = document.evaluate( xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null ); const element = result.singleNodeValue; return element ? element.innerHTML : null; } catch (evalError) { console.error(`Error evaluating XPath "${xpath}" for extraction: ${evalError.message}`); return null; } }, bestCandidateXPath);
        if (extractedHtml !== null && extractedHtml.trim().length > 0) { logInfo("Successfully extracted HTML content using the discovered XPath."); }
        else { logWarn(`Discovered XPath "${bestCandidateXPath}" did not find a matching element or element was empty during final extraction.`); bestCandidateXPath = null; extractedHtml = null; }
      } catch (extractError) { logError(`Error extracting content with XPath "${bestCandidateXPath}":`, extractError); bestCandidateXPath = null; extractedHtml = null; }
    }

    if (bestCandidateXPath && extractedHtml !== null) { return { foundXPath: bestCandidateXPath, extractedHtml: extractedHtml }; }
    else { if (htmlContent) { logWarn("XPath discovery failed or final extraction failed."); await saveHtmlOnFailure(url, htmlContent); } else { logWarn("XPath discovery failed, and no HTML content was obtained (likely navigation failure)."); } return null; }
  } catch (error) {
    logError("An error occurred during XPath discovery and extraction:", error);
    if (htmlContent) { logWarn("Process failed due to error. Saving full HTML..."); await saveHtmlOnFailure(url, htmlContent); }
    else { logWarn("Process failed due to error, and no HTML content was available to save."); }
    return null; // Indicate failure
  } finally {
    await cleanupPuppeteer(page, browser, userDataDir, debug);
  }
};

/**
 * Fetches content using a known XPath.
 * NO page.authenticate() calls.
 * @param {string} url - The URL to fetch.
 * @param {string} xpath - The known XPath to use.
 * @param {boolean} debug - Enable debug logging.
 * @returns {Promise<string|null>} - The extracted HTML content or null if XPath fails or CAPTCHA fails.
 */
const fetchWithKnownXpath = async (url, xpath, debug = false) => {
  logInfo(`Attempting to fetch content for ${url} using known XPath: ${xpath}`);
  let browser = null;
  let userDataDir = null;
  let page = null;
  let extractedHtml = null;
  let htmlContent = null; // To save on failure

  try {
    const launchResult = await launchPuppeteerBrowser(debug); // Launches WITH proxy "AS IS"
    browser = launchResult.browser;
    userDataDir = launchResult.userDataDir;
    page = await browser.newPage();

    // --- REMOVED page.authenticate() call ---

    // --- navigateAndPreparePage uses the page ---
    const navigationSuccessful = await navigateAndPreparePage(page, url, debug);
    if (!navigationSuccessful) {
        logError(`Navigation/CAPTCHA handling failed for ${url} during known XPath fetch.`);
        try { htmlContent = await page.content(); } catch { /* ignore error */ }
        await saveHtmlOnFailure(url, htmlContent);
        return null; // Indicate failure
    }

    htmlContent = await getHtmlContent(page);
    if (!htmlContent) { logWarn("Failed to get HTML content even after successful navigation."); }

    logDebug(`[EXTRACT-KNOWN] Evaluating XPath: ${xpath}`);
    extractedHtml = await page.evaluate((xpathSelector) => { try { const result = document.evaluate( xpathSelector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null ); const element = result.singleNodeValue; if (element && element.innerHTML.trim().length > 0) { return element.innerHTML; } return null; } catch (e) { console.error("Error during XPath evaluation in browser:", e); return null; } }, xpath);

    if (extractedHtml !== null) { logInfo(`Successfully extracted content using known XPath.`); return extractedHtml; }
    else { logWarn(`Known XPath "${xpath}" failed to find a valid element for ${url} (post-navigation).`); await saveHtmlOnFailure(url, htmlContent); return null; }
  } catch (error) {
    logError(`Error during fetchWithKnownXpath for ${url}:`, error);
    await saveHtmlOnFailure(url, htmlContent);
    return null; // Indicate general failure
  } finally {
    await cleanupPuppeteer(page, browser, userDataDir, debug);
  }
};


// --- Main Application Logic ---

/**
 * Main function to get content for a URL.
 * Handles storage lookup, XPath discovery/validation, and extraction.
 * @param {string} url - The target URL.
 * @returns {Promise<{success: boolean, content?: string, error?: string}>}
 */
const getContent = async (url) => {
    logInfo(`Processing URL: ${url}`); const domain = getDomainFromUrl(url); if (!domain) { return { success: false, error: `Invalid URL format: ${url}` }; } logInfo(`Normalized Domain: ${domain}`); const storageData = loadStorage(); const knownXpath = storageData[domain]; let extractedHtml = null; let finalXpath = knownXpath; if (knownXpath) { logInfo(`Found known XPath for ${domain}: ${knownXpath}`); extractedHtml = await fetchWithKnownXpath( url, knownXpath, ENABLE_DEBUG_LOGGING, ); if (extractedHtml !== null) { logInfo(`Extraction successful using stored XPath for ${domain}.`); return { success: true, content: extractedHtml }; } else { logWarn(`Stored XPath for ${domain} failed. Attempting discovery...`); finalXpath = null; } } else { logInfo(`No stored XPath found for ${domain}. Starting discovery...`); } const discoveryResult = await findArticleXPathAndExtract( url, ENABLE_DEBUG_LOGGING, ); if (discoveryResult) { logInfo( `XPath discovery successful for ${domain}. New XPath: ${discoveryResult.foundXPath}`, ); finalXpath = discoveryResult.foundXPath; extractedHtml = discoveryResult.extractedHtml; if (storageData[domain] !== finalXpath) { logInfo(`Updating storage for ${domain} with new XPath: ${finalXpath}`); storageData[domain] = finalXpath; saveStorage(storageData); } else if (!storageData[domain]) { logInfo(`Saving newly discovered XPath for ${domain}: ${finalXpath}`); storageData[domain] = finalXpath; saveStorage(storageData); } else { logInfo(`Discovered XPath ${finalXpath} is the same as the stored one which previously failed. Not re-saving immediately.`); } return { success: true, content: extractedHtml }; } else { logError(`Failed to discover a working XPath for ${domain} (${url}).`); if (knownXpath && storageData[domain] === knownXpath) { logWarn(`Removing failed XPath ${knownXpath} from storage for ${domain} after discovery also failed.`); delete storageData[domain]; saveStorage(storageData); } return { success: false, error: `Failed to find or extract content for ${domain}`, }; }
};

// --- Command Line Execution ---
(async () => {
  const targetUrl = process.argv[2]; // Get URL from command line argument

  if (!targetUrl) {
    console.error("Usage: node smartScraper.js <url>");
    process.exit(1);
  }

  // Ensure storage file exists, even if empty
  let initialStorage = loadStorage();
  if (!fs.existsSync(STORAGE_FILE_PATH)) {
      logInfo("Creating empty storage file.");
      saveStorage({});
  }

  try {
    const result = await getContent(targetUrl);

    if (result.success) {
      logInfo("\n--- Extraction Successful ---");
      // Outputting raw HTML to stdout
      console.log(result.content);
      process.exit(0); // Exit with success code
    } else {
      logError("\n--- Extraction Failed ---");
      console.error(`Error: ${result.error}`);
      process.exit(1); // Exit with failure code
    }
  } catch (err) {
    logError("\n--- An Unhandled Error Occurred ---");
    console.error(err);
    process.exit(1); // Exit with failure code
  }
})();
