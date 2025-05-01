// smartScraper2.js (Using site_storage.json, Save HTML Pre-Extract, Conditional DataDome Check)

// --- Required Libraries ---
require("dotenv").config(); // Load .env first
const axios = require("axios");
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

// --- Configuration ---
const STORAGE_FILE_PATH = path.join(__dirname, "site_storage.json");
const LLM_API_BASE_URL = "https://openrouter.ai/api/v1";
const LLM_CHAT_COMPLETIONS_ENDPOINT = `${LLM_API_BASE_URL}/chat/completions`;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL;
const EXECUTABLE_PATH =
  process.env.EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"; // Adjust as needed
const EXTENSION_PATHS = process.env.EXTENSION_PATHS; // Optional: Comma-separated paths

// --- Proxy & 2Captcha Configuration ---
const TWOCAPTCHA_API_KEY = process.env.TWOCAPTCHA_API_KEY;
const MY_HTTP_PROXY = process.env.MY_HTTP_PROXY; // Read directly
const DADADOME_DOMAINS = ["wsj.com"]; // Domains needing CAPTCHA checks
const TWOCAPTCHA_CREATE_TASK_URL = "https://api.2captcha.com/createTask";
const TWOCAPTCHA_GET_RESULT_URL = "https://api.2captcha.com/getTaskResult";
const CAPTCHA_POLL_INTERVAL = 10000; // 10 seconds
const CAPTCHA_SOLVE_TIMEOUT = 180000; // 3 minutes

// --- HTML Saving Configuration ---
const SAVE_HTML_ON_FAILURE = process.env.SAVE_HTML_ON_FAILURE === "true"; // For critical failures
const FAILED_HTML_DIR = path.join(__dirname, "failed_html_dumps");
const SAVE_HTML_ON_SUCCESS_NAV = process.env.SAVE_HTML_ON_SUCCESS_NAV === "true"; // For saving before extraction attempt
const SUCCESSFUL_HTML_DIR = path.join(__dirname, "successful_html_dumps"); // Directory for pre-extraction saves

// --- Constants ---
const SCORE_WEIGHTS = {
  isSingleElement: 80, paragraphCount: 1, unwantedPenaltyRatio: -75, isSemanticTag: 75,
  hasDescriptiveIdOrClass: 30, textDensity: 50, linkDensityPenalty: -30, mediaPresence: 25,
  xpathComplexityPenalty: -5,
};
const MIN_PARAGRAPH_THRESHOLD = 5;
const TAGS_TO_COUNT = [ "p", "nav", "aside", "footer", "header", "ul", "ol", "img", "a", "video", "audio", "picture", ];
const UNWANTED_TAGS = ["nav", "aside", "footer", "header"];
const MAX_LLM_RETRIES = 2;
const ENABLE_DEBUG_LOGGING = process.env.DEBUG === "true";

// --- Logging Utility ---
const logInfo = (...args) => console.log("[INFO]", ...args);
const logDebug = (...args) => { if (ENABLE_DEBUG_LOGGING) console.log("[DEBUG]", ...args); };
const logWarn = (...args) => console.warn("[WARN]", ...args);
const logError = (...args) => console.error("[ERROR]", ...args);

// --- Initial Environment Value Log ---
logDebug(`[ENV INIT] MY_HTTP_PROXY read from environment: "${MY_HTTP_PROXY}"`);
logDebug(`[ENV INIT] TWOCAPTCHA_API_KEY read: ${TWOCAPTCHA_API_KEY ? 'Exists' : 'MISSING'}`);
logDebug(`[ENV INIT] DADADOME_DOMAINS: ${JSON.stringify(DADADOME_DOMAINS)}`);

// Check required environment variables
if (!OPENROUTER_API_KEY) { logError("FATAL: OPENROUTER_API_KEY missing."); process.exit(1); }
if (!LLM_MODEL) { logError("FATAL: LLM_MODEL missing."); process.exit(1); }
if (!fs.existsSync(EXECUTABLE_PATH)) logWarn(`WARN: EXECUTABLE_PATH "${EXECUTABLE_PATH}" not found.`);
if (!TWOCAPTCHA_API_KEY && DADADOME_DOMAINS.length > 0) { logError("FATAL: TWOCAPTCHA_API_KEY needed for DADADOME_DOMAINS."); process.exit(1); }
else if (!TWOCAPTCHA_API_KEY) logWarn("WARN: TWOCAPTCHA_API_KEY missing; CAPTCHA solving disabled.");
if (!MY_HTTP_PROXY) { logError("FATAL: MY_HTTP_PROXY missing."); process.exit(1); }


// --- Storage Management ---
const loadStorage = () => {
  logDebug("[Storage] Attempting to load storage...");
  try {
    if (fs.existsSync(STORAGE_FILE_PATH)) {
      const rawData = fs.readFileSync(STORAGE_FILE_PATH, "utf8");
      logDebug("[Storage] File exists, read content snippet:", rawData.substring(0, 200) + (rawData.length > 200 ? '...' : ''));
      const parsed = JSON.parse(rawData);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        logDebug("[Storage] Parsed successfully as object.");
        return parsed;
      } else {
        logWarn(`[Storage] File ${STORAGE_FILE_PATH} invalid structure. Resetting.`);
        return {};
      }
    }
    logInfo(`[Storage] File ${STORAGE_FILE_PATH} not found. Starting empty.`);
    return {};
  } catch (error) {
    logError(`[Storage] Failed load/parse ${STORAGE_FILE_PATH}:`, error);
    logWarn("[Storage] Starting empty due to error.");
    return {};
  }
};
const saveStorage = (data) => {
  logDebug("[Storage] Attempting to save storage...");
  try {
     if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        logError("[Storage] Attempted save non-object data. Aborting.", data); return;
     }
    fs.writeFileSync(STORAGE_FILE_PATH, JSON.stringify(data, null, 2), "utf8");
    logDebug("[Storage] Saved successfully.");
  } catch (error) { logError(`[Storage] Failed save ${STORAGE_FILE_PATH}:`, error); }
};
const getDomainFromUrl = (urlString) => {
    logDebug(`[Util] Getting domain from URL: ${urlString}`);
    try { const hostname = new URL(urlString).hostname; const domain = hostname.startsWith("www.") ? hostname.substring(4).toLowerCase() : hostname.toLowerCase(); logDebug(`[Util] Domain result: ${domain}`); return domain; }
    catch (error) { logError(`[Util] Invalid URL for domain extraction: ${urlString}`, error); return null; }
};

// --- Proxy Parsing Utility ---
const parseProxyStringFor2Captcha = (proxyString) => {
    logDebug(`[Parser Internal] Received string for 2Captcha parse: "${proxyString}" (Length: ${proxyString?.length})`);
    if (!proxyString) { logError("[2Captcha Proxy Parse] Proxy string empty/null."); return null; }
    try {
        logDebug("[Parser Internal] Attempting: new URL(proxyString)...");
        const url = new URL(proxyString);
        logDebug("[Parser Internal] new URL() succeeded.");
        const type = url.protocol.replace(":", "").toLowerCase();
        if (type !== "http" && type !== "https") { logError(`[2Captcha Proxy Parse] Unsupported protocol: ${type}.`); return null; }
        const address = url.hostname; if (!address) { logError(`[2Captcha Proxy Parse] Missing host: ${proxyString}`); return null; }
        const defaultPort = type === "https" ? 443 : 80; let port = parseInt(url.port, 10) || defaultPort; if (isNaN(port) || port <= 0 || port > 65535) { logWarn(`[2Captcha Proxy Parse] Invalid port "${url.port}", using ${defaultPort}.`); port = defaultPort; }
        const login = url.username ? decodeURIComponent(url.username) : undefined; const password = url.password ? decodeURIComponent(url.password) : undefined;
        const result = { type: type.toUpperCase(), address, port, login, password };
        logDebug(`[2Captcha Proxy Parse] Successfully parsed:`, { ...result, password: result.password ? '***' : undefined }); // Don't log password
        return result;
    } catch (error) {
        logError(`[2Captcha Proxy Parse] CRITICAL ERROR during 'new URL()' or processing for string: "${proxyString}"`);
        logError("[2Captcha Proxy Parse] Error Name:", error.name); logError("[2Captcha Proxy Parse] Error Message:", error.message); logError("[2Captcha Proxy Parse] Error Stack:", error.stack); return null;
    }
};

// Parse proxy for 2Captcha use early and check
let PROXY_INFO_FOR_2CAPTCHA = null;
const needsCaptchaCheckPotentially = TWOCAPTCHA_API_KEY && DADADOME_DOMAINS.length > 0;
logDebug(`[Proxy Check] Needs 2Captcha potentially? ${needsCaptchaCheckPotentially}`);
if (needsCaptchaCheckPotentially) {
    logDebug(`[Proxy Check] Attempting to parse MY_HTTP_PROXY for 2Captcha: "${MY_HTTP_PROXY}"`);
    PROXY_INFO_FOR_2CAPTCHA = parseProxyStringFor2Captcha(MY_HTTP_PROXY);
    if (!PROXY_INFO_FOR_2CAPTCHA) {
      logError("FATAL: Failed to parse MY_HTTP_PROXY for 2Captcha usage. Check format and parser logs.");
      process.exit(1); // Exit if parsing fails and 2Captcha might be needed
    } else {
        logDebug("[Proxy Check] MY_HTTP_PROXY parsed successfully for 2Captcha.");
    }
}

// --- HTML Saving Utilities ---
const saveFullHtmlPreExtract = async (url, htmlContent, saveDirectory) => {
    logDebug(`[Save HTML Pre-Extract] Check triggered for URL: ${url}`);
    if (!SAVE_HTML_ON_SUCCESS_NAV) { logDebug("[Save HTML Pre-Extract] Saving disabled by config."); return; }
    if (!htmlContent || typeof htmlContent !== 'string' || htmlContent.trim().length === 0) { logWarn("[Save HTML Pre-Extract] No valid HTML content provided."); return; }
    const domain = getDomainFromUrl(url); if (!domain) { logWarn("[Save HTML Pre-Extract] No domain."); return; }
    const safeDomain = domain.replace(/[^a-z0-9\-.]/gi, "_"); const now = new Date(); const dateString = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
    try { await fs.promises.mkdir(saveDirectory, { recursive: true }); const filePrefix = `${safeDomain}-${dateString}-`; const files = await fs.promises.readdir(saveDirectory); let maxCounter = 0; files.forEach(file => { if (file.startsWith(filePrefix) && file.endsWith(".html")) { const match = file.match(/-(\d{3})\.html$/); if (match?.[1]) { const counter = parseInt(match[1], 10); if (!isNaN(counter) && counter > maxCounter) maxCounter = counter; } } }); const nextCounter = (maxCounter + 1).toString().padStart(3, '0'); const filename = `${filePrefix}${nextCounter}.html`; const filePath = path.join(saveDirectory, filename); logInfo(`[Save HTML Pre-Extract] Saving full HTML for ${domain} to: ${filePath}`); await fs.promises.writeFile(filePath, htmlContent, "utf8"); logDebug(`[Save HTML Pre-Extract] Saved OK.`); }
    catch (error) { logError(`[Save HTML Pre-Extract] Failed save for ${url}:`, error); }
};
const saveHtmlOnFailure = async (url, html) => {
    logDebug(`[Save Fail HTML] Check triggered for URL: ${url}`);
    if (!SAVE_HTML_ON_FAILURE) { logDebug("[Save Fail HTML] Saving disabled by config."); return; }
    if (!html || typeof html !== 'string' || html.trim().length === 0) { logWarn("[Save Fail HTML] No valid HTML content."); return; }
    try { await fs.promises.mkdir(FAILED_HTML_DIR, { recursive: true }); const h = crypto.createHash("md5").update(url).digest("hex").substring(0, 8); const t = new Date().toISOString().replace(/[:.]/g, "-"); const d = getDomainFromUrl(url)?.replace(/[^a-z0-9\-.]/gi, "_") || "unknown"; const f = `failed_${d}_${t}_${h}.html`; const p = path.join(FAILED_HTML_DIR, f); logInfo(`[Save Fail HTML] Saving to ${p}`); await fs.promises.writeFile(p, html, "utf8"); }
    catch (e) { logError(`[Save Fail HTML] Failed save for ${url}: ${e.message}`); }
};

// --- Puppeteer Launch and Cleanup ---
const launchPuppeteerBrowser = async (debug = false) => {
  logDebug("[LAUNCH] Attempting to launch browser...");
  let browser = null, userDataDir = null;
  try {
    let extensionArgs = []; if (EXTENSION_PATHS) { logDebug(`[LAUNCH] Extensions: ${EXTENSION_PATHS}`); extensionArgs = [ `--disable-extensions-except=${EXTENSION_PATHS}`, `--load-extension=${EXTENSION_PATHS}` ]; }
    userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppeteer-user-data-")); logDebug(`[LAUNCH] User data dir: ${userDataDir}`);
    let proxyHostPort = null, proxyCredentials = null;
    try {
        logDebug(`[LAUNCH] Parsing proxy for Puppeteer: "${MY_HTTP_PROXY}"`);
        const parsedProxyUrl = new URL(MY_HTTP_PROXY);
        const defaultPort = parsedProxyUrl.protocol === 'https:' ? 443 : 80; const port = parsedProxyUrl.port || defaultPort; proxyHostPort = `${parsedProxyUrl.hostname}:${port}`; if (parsedProxyUrl.username) proxyCredentials = { username: decodeURIComponent(parsedProxyUrl.username), password: decodeURIComponent(parsedProxyUrl.password || "") };
        logInfo(`[LAUNCH] Puppeteer Proxy: ${proxyHostPort}${proxyCredentials ? " (Auth needed)" : ""}`);
    } catch (parseError) { logError(`[LAUNCH] CRITICAL: Failed parsing MY_HTTP_PROXY for Puppeteer: ${MY_HTTP_PROXY}`, parseError); throw parseError; }
    const launchArgs = [ "--no-sandbox", `--proxy-server=${proxyHostPort}`, "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-accelerated-2d-canvas", "--disable-gpu", "--window-size=1366,768", "--ignore-certificate-errors", ...extensionArgs ];
    logDebug("[LAUNCH] Launch Args:", launchArgs);
    browser = await puppeteer.launch({ executablePath: EXECUTABLE_PATH, headless: "new", userDataDir, args: launchArgs, dumpio: debug && process.env.NODE_ENV === "development", timeout: 90000, ignoreHTTPSErrors: true });
    logDebug("[LAUNCH] Browser launched OK."); browser.defaultBrowserContext().proxyCredentials = proxyCredentials;
    return { browser, userDataDir };
  } catch (error) { logError("[LAUNCH] Browser launch failed:", error); if (userDataDir) { try { await fs.promises.rm(userDataDir, { recursive: true, force: true }); } catch {} } throw error; }
};
const cleanupPuppeteer = async (page, browser, userDataDir, debug = false) => {
  logDebug("[CLEANUP] Starting...");
  if (page && !page.isClosed()) { try { await page.close(); logDebug("[CLEANUP] Page closed."); } catch (e) { if (debug) logError("[CLEANUP] Error closing page:", e.message); } } else if (page?.isClosed()) logDebug("[CLEANUP] Page already closed.");
  if (browser && browser.isConnected()) { try { await browser.close(); logDebug("[CLEANUP] Browser closed."); } catch (e) { if (debug) logError("[CLEANUP] Error closing browser:", e.message); } } else if (browser) logDebug("[CLEANUP] Browser disconnected.");
  if (userDataDir) { logDebug(`[CLEANUP] Removing dir: ${userDataDir}`); try { await fs.promises.rm(userDataDir, { recursive: true, force: true }); logDebug("[CLEANUP] User data dir removed."); } catch (err) { if (err.code !== "ENOENT" && debug) logError("[CLEANUP] Failed rm dir:", userDataDir, err); } }
  logDebug("[CLEANUP] Finished.");
};

// --- 2Captcha Solver ---
const solveDataDomeWith2Captcha = async (websiteURL, captchaUrl, userAgent) => {
  if (!TWOCAPTCHA_API_KEY || !PROXY_INFO_FOR_2CAPTCHA) { logError("[2CAPTCHA] Missing API Key/Proxy Info."); return { success: false, reason: 'CONFIG_ERROR' }; }
  logInfo(`[2CAPTCHA] Solving for ${websiteURL}`); const taskPayload = { type: "DataDomeSliderTask", websiteURL, captchaUrl, userAgent, proxyType: PROXY_INFO_FOR_2CAPTCHA.type, proxyAddress: PROXY_INFO_FOR_2CAPTCHA.address, proxyPort: PROXY_INFO_FOR_2CAPTCHA.port, ...(PROXY_INFO_FOR_2CAPTCHA.login && { proxyLogin: PROXY_INFO_FOR_2CAPTCHA.login }), ...(PROXY_INFO_FOR_2CAPTCHA.password && { proxyPassword: PROXY_INFO_FOR_2CAPTCHA.password }) }; const requestBody = { clientKey: TWOCAPTCHA_API_KEY, task: taskPayload };
  if (ENABLE_DEBUG_LOGGING) { const debugBody = JSON.parse(JSON.stringify(requestBody)); if (debugBody.task.proxyPassword) debugBody.task.proxyPassword = "***"; logDebug("[2CAPTCHA] Sending task:", JSON.stringify(debugBody, null, 2)); }
  let taskId; try { const createTaskResponse = await axios.post(TWOCAPTCHA_CREATE_TASK_URL, requestBody, { timeout: 30000 }); logDebug("[2CAPTCHA] Create response:", createTaskResponse.data); if (createTaskResponse.data.errorId !== 0) { logError(`[2CAPTCHA] Create failed: ${createTaskResponse.data.errorCode} - ${createTaskResponse.data.errorDescription}`); return { success: false, reason: 'API_ERROR', details: createTaskResponse.data.errorCode }; } taskId = createTaskResponse.data.taskId; logInfo(`[2CAPTCHA] Task ID: ${taskId}`); } catch (error) { logError("[2CAPTCHA] Create request error:", error.message); return { success: false, reason: 'API_ERROR', details: error.message }; }
  const startTime = Date.now(); while (Date.now() - startTime < CAPTCHA_SOLVE_TIMEOUT) { logDebug(`[2CAPTCHA] Polling Task ID: ${taskId}...`); try { await new Promise(r => setTimeout(r, CAPTCHA_POLL_INTERVAL)); const getResultResponse = await axios.post(TWOCAPTCHA_GET_RESULT_URL, { clientKey: TWOCAPTCHA_API_KEY, taskId }, { timeout: 20000 }); logDebug("[2CAPTCHA] Get response:", getResultResponse.data); if (getResultResponse.data.errorId !== 0) { const errorCode = getResultResponse.data.errorCode; logError(`[2CAPTCHA] Get failed: ${errorCode} - ${getResultResponse.data.errorDescription}`); if (errorCode === 'ERROR_CAPTCHA_UNSOLVABLE') return { success: false, reason: 'UNSOLVABLE' }; else if (errorCode === 'ERR_PROXY_CONNECTION_FAILED') return { success: false, reason: 'PROXY_ERROR' }; else return { success: false, reason: 'API_ERROR', details: errorCode }; } const status = getResultResponse.data.status; if (status === "ready") { logInfo(`[2CAPTCHA] Solved Task ID: ${taskId}`); const solutionCookie = getResultResponse.data.solution?.cookie; if (!solutionCookie) { logError("[2CAPTCHA] Solution missing cookie."); return { success: false, reason: 'API_ERROR', details: 'Missing cookie' }; } logDebug("[2CAPTCHA] Cookie:", solutionCookie.substring(0, 50) + '...'); return { success: true, cookie: solutionCookie }; } else if (status === "processing") logDebug("[2CAPTCHA] Still processing..."); else logWarn(`[2CAPTCHA] Unknown status: ${status}`); } catch (error) { logError(`[2CAPTCHA] Poll error Task ID ${taskId}:`, error.message); await new Promise(r => setTimeout(r, CAPTCHA_POLL_INTERVAL / 2)); } }
  logError(`[2CAPTCHA] Timeout Task ID: ${taskId}.`); return { success: false, reason: 'TIMEOUT' };
};

// --- Cookie Formatting ---
const formatDataDomeCookie = (cookieString, targetUrl) => {
  logDebug(`[Cookie] Formatting: ${cookieString.substring(0, 50)}...`); if (!cookieString?.includes("=")) return null;
  try { const parts = cookieString.split(";").map(p => p.trim()); const [name, ...valueParts] = parts[0].split("="); const value = valueParts.join("="); if (!name || !value) { logError("[Cookie] Bad name/value:", parts[0]); return null; } let domainFromUrl = null; try { domainFromUrl = new URL(targetUrl).hostname; } catch {} const cookie = { name: name.trim(), value: value.trim(), url: targetUrl, domain: undefined, path: "/", secure: false, httpOnly: false, sameSite: "Lax", expires: undefined };
    for (let i = 1; i < parts.length; i++) { const [attrNameInput, ...attrValueParts] = parts[i].split("="); const attrName = attrNameInput.trim().toLowerCase(); const attrValue = attrValueParts.join("=").trim(); switch (attrName) { case "path": cookie.path = attrValue || "/"; break; case "domain": cookie.domain = attrValue.startsWith(".") ? attrValue : `.${attrValue}`; break; case "secure": cookie.secure = true; break; case "samesite": const validSS = ["Lax", "Strict", "None"]; const capSS = attrValue.charAt(0).toUpperCase() + attrValue.slice(1).toLowerCase(); cookie.sameSite = validSS.includes(capSS) ? capSS : "Lax"; break; case "httponly": cookie.httpOnly = true; break; case "expires": try { const expiryDate = new Date(attrValue); if (!isNaN(expiryDate.getTime())) cookie.expires = Math.floor(expiryDate.getTime() / 1000); else logWarn(`[Cookie] Bad expires: ${attrValue}`); } catch { logWarn(`[Cookie] Bad expires: ${attrValue}`); } break; case "max-age": try { const maxAgeSec = parseInt(attrValue, 10); if (!isNaN(maxAgeSec)) cookie.expires = Math.floor(Date.now() / 1000) + maxAgeSec; else logWarn(`[Cookie] Bad max-age: ${attrValue}`); } catch { logWarn(`[Cookie] Bad max-age: ${attrValue}`); } break; default: logDebug(`[Cookie] Ignoring attr: ${attrName}`); break; } }
    if (!cookie.domain && domainFromUrl) { cookie.domain = domainFromUrl.startsWith('www.') ? `.${domainFromUrl.substring(4)}` : `.${domainFromUrl}`; if (cookie.domain === '.') cookie.domain = domainFromUrl; logDebug(`[Cookie] Derived domain: ${cookie.domain}`); } else if (!cookie.domain) logWarn("[Cookie] Domain missing.");
    if (cookie.sameSite === 'None' && !cookie.secure) { logWarn("[Cookie] SameSite=None needs Secure; forcing."); cookie.secure = true; }
    logDebug("[Cookie] Formatted object:", cookie); return cookie;
  } catch (error) { logError("[Cookie] Parsing error:", cookieString, error); return null; }
};

// --- DataDome Handling Logic ---
const handleDataDomeIfNeeded = async (page, url, userAgent, debug = false) => {
    logDebug(`[DataDome] handleDataDomeIfNeeded called for: ${url}`);
    const domain = getDomainFromUrl(url);
    const requiresCheck = DADADOME_DOMAINS.includes(domain);
    logDebug(`[DataDome] Domain: ${domain}, Requires Check: ${requiresCheck}, API Key Set: ${!!TWOCAPTCHA_API_KEY}`);

    if (requiresCheck && !TWOCAPTCHA_API_KEY) { logWarn(`[DataDome] ${domain} needs check, but no API key. Skipping.`); return true; }
    if (!requiresCheck) { logDebug(`[DataDome] ${domain} not in list. Skipping.`); return true; }

    logInfo(`[DataDome] Checking ${domain} for URL: ${url}`);
    try {
        // Note: Initial navigation happens *before* this function is called in the new logic
        logDebug("[DataDome] Checking iframe (assuming navigation already happened)...");
        let captchaUrl = null;
        try {
            const iframeSelector = 'iframe[src*="captcha-delivery.com"], iframe[src*="geo.captcha-delivery.com"]';
            logDebug(`[DataDome] Waiting for selector: ${iframeSelector}`);
            // Reduce wait time here as page should already be loaded somewhat
            await page.waitForSelector(iframeSelector, { timeout: 20000, visible: true }).catch(() => logDebug("[DataDome] iframe selector not visible/found in time (post-nav)."));
            const captchaFrameElement = await page.$(iframeSelector);
            if (captchaFrameElement) {
                captchaUrl = await page.evaluate(el => el.getAttribute("src"), captchaFrameElement);
                logDebug(`[DataDome] iframe src attribute: ${captchaUrl}`);
                if (captchaUrl) logInfo("[DataDome] Found CAPTCHA iframe post-navigation.");
                else logWarn("[DataDome] iframe src missing post-navigation.");
            } else { logDebug("[DataDome] iframe selector found no element post-navigation."); }
        } catch (error) { logWarn(`[DataDome] iframe detect error post-navigation: ${error.message}. Checking content.`); }

        if (!captchaUrl) {
            logDebug("[DataDome] No captchaUrl found post-navigation, checking page content...");
            const pageTitle = (await page.title())?.toLowerCase() || ""; const bodyText = await page.evaluate(() => document.body?.innerText?.toLowerCase() || ""); const blockedIndicators = ["blocked", "enable javascript", "checking browser", "access denied", "verify human"];
            logDebug(`[DataDome] Post-Nav Page Title: ${pageTitle.substring(0,100)}, Body Text Snippet: ${(bodyText || '').substring(0, 200)}`);
            if (blockedIndicators.some(ind => pageTitle.includes(ind) || bodyText.includes(ind))) { logError(`[DataDome] Page content indicates blocked post-navigation.`); return false; }
            else { logInfo("[DataDome] No CAPTCHA iframe or block indicators found post-navigation. Assuming OK."); return true; }
        }
        logDebug(`[DataDome] captchaUrl to use: ${captchaUrl}`);

        try { const fullCaptchaUrl = new URL(captchaUrl, url); const tParam = fullCaptchaUrl.searchParams.get("t"); logDebug(`[DataDome] t param: ${tParam}`); if (tParam === "bv") { logError(`[DataDome] IP banned (t=bv).`); return false; } if (tParam !== "fe") logWarn(`[DataDome] Unexpected t param: ${tParam}.`); } catch (e) { logWarn("[DataDome] Error parsing t param:", e.message); }

        logDebug("[DataDome] Calling solveDataDomeWith2Captcha...");
        const captchaResult = await solveDataDomeWith2Captcha(url, captchaUrl, userAgent);
        logDebug("[DataDome] solveDataDomeWith2Captcha result:", captchaResult);

        if (!captchaResult.success) { logError(`[DataDome] CAPTCHA solve failed: ${captchaResult.reason}`); return false; }

        const dataDomeCookieString = captchaResult.cookie;
        logDebug("[DataDome] Formatting solved cookie...");
        const parsedCookie = formatDataDomeCookie(dataDomeCookieString, url);

        if (parsedCookie?.name && parsedCookie?.value) {
            logInfo(`[DataDome] Storing solved cookie: Name=${parsedCookie.name}`);
            try { const storageData = loadStorage(); let domainEntry = storageData[domain] || {}; domainEntry.cookie_name = parsedCookie.name; domainEntry.cookie_value = parsedCookie.value; storageData[domain] = domainEntry; saveStorage(storageData); logDebug(`[DataDome] Cookie info saved for ${domain}.`); }
            catch (storageError) { logError(`[DataDome] Failed save solved cookie:`, storageError); }
        } else { logWarn("[DataDome] Could not parse solved cookie, skipping storage."); }

        if (!parsedCookie) { logError("[DataDome] Cannot set cookie, parsing failed."); return false; }
        try { logInfo("[DataDome] Setting cookie in browser..."); await page.setCookie(parsedCookie); logInfo("[DataDome] Cookie set OK."); }
        catch (error) { logError("[DataDome] Failed set cookie in browser:", error); logDebug("[DataDome] Problematic cookie:", parsedCookie); return false; }

        logInfo("[DataDome] Reloading page after CAPTCHA solve...");
        try { await page.reload({ waitUntil: "networkidle0", timeout: 60000 }); logInfo("[DataDome] Reloaded OK."); }
        catch (reloadError) { logError("[DataDome] Reload error:", reloadError); return false; }

        const reloadedTitle = (await page.title())?.toLowerCase() || ""; const reloadedBodyText = await page.evaluate(() => document.body?.innerText?.toLowerCase() || ""); const blockedIndicatorsAfter = ["blocked", "enable javascript", "checking browser", "access denied", "verify human"]; if (blockedIndicatorsAfter.some(ind => reloadedTitle.includes(ind) || reloadedBodyText.includes(ind))) { logError("[DataDome] Still blocked after reload."); return false; }

        logInfo("[DataDome] CAPTCHA handled successfully."); return true;

    } catch (error) { logError(`[DataDome] Outer handling error for ${url}:`, error); return false; }
};

// --- Navigation and Page Preparation ---
/**
 * Navigates the page, handles proxy authentication, optional DataDome, and interactions.
 * @param {puppeteer.Page} page
 * @param {string} url
 * @param {boolean} debug
 * @param {boolean} performDataDomeCheck - If true, run DataDome checks if applicable.
 * @returns {Promise<boolean>} - True if navigation and preparation was successful.
 */
const navigateAndPreparePage = async (page, url, debug = false, performDataDomeCheck = true) => {
    logDebug(`[NAVIGATE] navigateAndPreparePage called for: ${url}, performDataDomeCheck: ${performDataDomeCheck}`);
    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
    logDebug(`[NAVIGATE] Setting User Agent: ${userAgent}`);
    await page.setUserAgent(userAgent);
    logDebug("[NAVIGATE] Setting Viewport 1366x768");
    await page.setViewport({ width: 1366, height: 768 });
    logDebug("[NAVIGATE] Setting Extra HTTP Headers...");
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9", Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7", "Sec-Ch-Ua": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"', "Sec-Ch-Ua-Mobile": "?0", "Sec-Ch-Ua-Platform": '"Windows"', "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none", "Sec-Fetch-User": "?1", "Upgrade-Insecure-Requests": "1" });

    const browserContext = page.browserContext();
    if (browserContext.proxyCredentials) { logDebug("[NAVIGATE] Auth setup..."); try { await page.authenticate(browserContext.proxyCredentials); logDebug("[NAVIGATE] Auth handler set."); } catch (authError) { logError("[NAVIGATE] Auth setup failed:", authError); return false; } }
    else logDebug("[NAVIGATE] No proxy auth needed.");

    // Initial Navigation Attempt
    let initialNavOk = false;
    try {
        logDebug(`[NAVIGATE] Initial page.goto(${url})...`);
        await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
        logDebug(`[NAVIGATE] Initial page.goto OK. Current URL: ${page.url()}`);
        initialNavOk = true;
    } catch (navError) {
        logError(`[NAVIGATE] Initial page.goto error for ${url}:`, navError);
        // Don't immediately return false, let DataDome check run if requested,
        // as sometimes the error page itself contains the CAPTCHA iframe.
        // However, if it's a critical proxy error, we should fail.
        if (navError.message?.includes("net::ERR_PROXY_") || navError.message?.includes("net::ERR_NAME_NOT_RESOLVED")) {
            logError("[NAVIGATE] Critical network/proxy error during initial goto. Failing.");
            return false;
        }
        logWarn("[NAVIGATE] Initial goto failed, but proceeding to DataDome check just in case.");
    }

    // --- Conditional DataDome Check ---
    let captchaHandled = true; // Assume true if check is skipped
    if (performDataDomeCheck) {
        logDebug("[NAVIGATE] Explicit DataDome check requested. Calling handleDataDomeIfNeeded...");
        captchaHandled = await handleDataDomeIfNeeded(page, url, userAgent, debug);
        logDebug(`[NAVIGATE] handleDataDomeIfNeeded result: ${captchaHandled}`);
        if (!captchaHandled) {
            logError(`[NAVIGATE] Explicit DataDome handling failed/aborted for ${url}.`);
            return false; // Fail if explicit check fails
        }
    } else {
        logDebug("[NAVIGATE] Skipping explicit DataDome check as requested.");
        // If initial nav failed AND we skipped the check, we should probably fail here.
        if (!initialNavOk) {
             logError("[NAVIGATE] Initial navigation failed and DataDome check was skipped. Failing.");
             return false;
        }
    }
    // --- End Conditional DataDome Check ---


    // Verify final URL state after potential navigation/reload
    const finalUrl = page.url();
    logDebug(`[NAVIGATE] URL after all checks/reloads: ${finalUrl}`);
    // Basic check if we are on *some* page related to the domain, not about:blank
    const targetDomain = getDomainFromUrl(url);
    const finalDomain = getDomainFromUrl(finalUrl);
    if (!finalUrl || finalUrl === 'about:blank' || (targetDomain && finalDomain !== targetDomain && !finalUrl.includes('captcha'))) { // Allow captcha URLs
        logError(`[NAVIGATE] Ended up on unexpected URL: ${finalUrl}. Expected something like ${url}`);
        // Check common block pages again just in case
        const pageTitle = (await page.title())?.toLowerCase() || "";
        const bodyText = await page.evaluate(() => document.body?.innerText?.toLowerCase() || "");
        const blockedIndicators = ["blocked", "access denied", "error", "not found"];
        if (blockedIndicators.some(ind => pageTitle.includes(ind) || bodyText.includes(ind))) {
             logError(`[NAVIGATE] Final page content suggests an error/block page.`);
        }
        return false; // Fail if URL is wrong
    }


    logDebug(`[NAVIGATE] Simulating interaction...`);
    try { await page.mouse.move(Math.random() * 500 + 100, Math.random() * 500 + 100); await page.evaluate(() => window.scrollBy(0, Math.random() * 200 + 50)); await new Promise(r => setTimeout(r, 750 + Math.random() * 500)); await page.evaluate(() => window.scrollBy(0, Math.random() * 300 + 100)); await new Promise(r => setTimeout(r, 500)); }
    catch (interactionError) { if (!interactionError.message.includes("Target closed")) logWarn("[NAVIGATE] Interaction warning:", interactionError.message); }

    logInfo(`[NAVIGATE] Page preparation complete for: ${page.url()}`); return true;
};

// --- HTML Content and Snippet Extraction ---
const getHtmlContent = async (page) => {
    logDebug("[Puppeteer] getHtmlContent called...");
    await new Promise(resolve => setTimeout(resolve, 250)); // Small delay
    try {
        if (page.isClosed()) { logWarn("[Puppeteer] Get HTML on closed page."); return null; }
        const content = await page.content();
        logDebug(`[Puppeteer] page.content() returned content length: ${content?.length ?? 'null'}`);
        return content;
    } catch (error) { logError("[Puppeteer] Get HTML error:", error.message); return null; }
};
const extractArticleSnippets = async (page, numSnippets = 5, minLength = 50) => {
    logDebug("[Puppeteer] Extracting snippets..."); const selector = "p, h2, h3, li, blockquote";
    try { if (page.isClosed()) { logWarn("[Puppeteer] Snippets on closed page."); return []; } return await page.$$eval(selector, (els, minL, maxS) => { const res = []; const isVis = el => { if (!el.offsetParent && el.tagName !== 'BODY') return false; const st = window.getComputedStyle(el); return st && st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0'; }; for (const el of els) { if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === 'NOSCRIPT' || !isVis(el)) continue; const txt = el.textContent?.trim().replace(/\s+/g, ' '); if (txt && txt.length >= minL && txt.match(/[a-zA-Z]{3,}/)) { let snip = txt.substring(0, 250) + (txt.length > 250 ? "..." : ""); if (!res.some(r => r.includes(snip.substring(0, 50)))) res.push(snip); if (res.length >= maxS) break; } } return res; }, minLength, numSnippets); }
    catch (error) { logError(`[Puppeteer] Snippet error: ${error.message}`); return []; }
};

// --- XPath Querying, Scoring, LLM ---
const queryXPathWithDetails = async (page, xpath, tagsToCount) => {
    logDebug(`[Puppeteer] Query XPath: ${xpath}`); try { if (page.isClosed()) { logWarn(`[Puppeteer] XPath on closed page: ${xpath}`); return { count: 0, firstElementDetails: null }; } const result = await page.evaluate((xp, tags) => { try { const snap = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); const cnt = snap.snapshotLength; let details = null; if (cnt > 0) { const node = snap.snapshotItem(0); if (node?.nodeType === Node.ELEMENT_NODE) { const el = node; const descCounts = {}; tags.forEach(t => { descCounts[t] = el.querySelectorAll(t).length; }); details = { tagName: el.tagName.toUpperCase(), id: el.id||null, className: el.className||null, descendantCounts: descCounts, textContentSample: el.textContent?.trim().replace(/\s+/g, ' ').substring(0, 500)||" ", innerHTMLSample: el.innerHTML?.trim().substring(0, 1000)||" ", totalDescendantElements: el.querySelectorAll("*").length }; } else if (node) console.warn(`[Eval] XPath "${xp}" first not Element: ${node.nodeType}`); } return { count: cnt, firstElementDetails: details }; } catch (e) { console.error(`[Eval] XPath error "${xp}": ${e.message}`); return { count: -1, error: e.message }; } }, xpath, tagsToCount); if (result.error) { logWarn(`[Puppeteer] Eval XPath error "${xpath}": ${result.error}`); return { count: 0, firstElementDetails: null }; } logDebug(`[Puppeteer] XPath "${xpath}" found ${result.count}.`); if (result.count > 0 && result.firstElementDetails) logDebug(`[Puppeteer] Details OK.`); else if (result.count > 0) logDebug(`[Puppeteer] First not Element.`); return result; }
    catch (error) { logError(`[Puppeteer] Query XPath error ${xpath}: ${error.message}`); return { count: 0, firstElementDetails: null }; }
};
const scoreElement = (details, count, xpath) => {
    const log = (...a) => { if (ENABLE_DEBUG_LOGGING) console.log("[SCORE]", ...a); }; if (!details?.descendantCounts || typeof details.totalDescendantElements !== 'number') { log(`Incomplete details ${xpath}. Score 0`); return 0; } let score = 0; const { tagName, id, className, descendantCounts, textContentSample, innerHTMLSample, totalDescendantElements } = details; const p = descendantCounts.p || 0; if (p < MIN_PARAGRAPH_THRESHOLD) { log(`${xpath} low paras (${p}). Score 0`); return 0; } score += p * SCORE_WEIGHTS.paragraphCount; log(`${xpath} Paras(${p}): +${(p*SCORE_WEIGHTS.paragraphCount).toFixed(1)}`); const unwanted = UNWANTED_TAGS.reduce((s, t) => s + (descendantCounts[t]||0), 0); if (totalDescendantElements > 5 && unwanted > 0) { const r = unwanted / totalDescendantElements; const pf = Math.min(1, r * 5); const pen = pf * SCORE_WEIGHTS.unwantedPenaltyRatio; score += pen; log(`${xpath} Unwanted(${r.toFixed(3)}): ${pen.toFixed(1)}`); } else if (unwanted > 1) { score += SCORE_WEIGHTS.unwantedPenaltyRatio*0.2; log(`${xpath} Unwanted(${unwanted}): ${(SCORE_WEIGHTS.unwantedPenaltyRatio*0.2).toFixed(1)}`); } if (tagName==="ARTICLE"||tagName==="MAIN") { score+=SCORE_WEIGHTS.isSemanticTag; log(`${xpath} Semantic(${tagName}): +${SCORE_WEIGHTS.isSemanticTag}`); } else if (tagName==="SECTION"||tagName==="DIV") { const descRgx = /article|content|body|story|main|post|entry|text|copy|primary|container/i; if ((id&&descRgx.test(id))||(className&&descRgx.test(className))) { score+=SCORE_WEIGHTS.hasDescriptiveIdOrClass; log(`${xpath} Descriptive ${tagName}: +${SCORE_WEIGHTS.hasDescriptiveIdOrClass}`); } else if(tagName==="DIV") { score-=5; log(`${xpath} Generic DIV: -5`); } } if (innerHTMLSample?.length > 50) { const txtLen = textContentSample?.length||0; const htmlLen = innerHTMLSample.length; if(htmlLen>0) { const density=txtLen/htmlLen; const bonus=Math.pow(density,0.5)*SCORE_WEIGHTS.textDensity; score+=bonus; log(`${xpath} Density(${density.toFixed(3)}): +${bonus.toFixed(1)}`); if(density<0.1&&txtLen>100) { score-=15; log(`${xpath} Low Density: -15`); } } } else if (textContentSample?.length > 100) { score+=10; log(`${xpath} Text bonus: +10`); } const links=descendantCounts.a||0; if(totalDescendantElements>5&&links>1) { const linkDens=links/totalDescendantElements; const linkPF=Math.min(1,linkDens*10); const linkPen=linkPF*SCORE_WEIGHTS.linkDensityPenalty; score+=linkPen; log(`${xpath} Link Density(${linkDens.toFixed(3)}): ${linkPen.toFixed(1)}`); if(linkDens>0.5&&links>5) { score-=50; log(`${xpath} High Links: -50`); } } const media=(descendantCounts.img||0)+(descendantCounts.video||0)+(descendantCounts.audio||0)+(descendantCounts.picture||0); if(media>0&&p>0) { const mediaBonus=Math.min(SCORE_WEIGHTS.mediaPresence, media*5); score+=mediaBonus; log(`${xpath} Media(${media}): +${mediaBonus.toFixed(1)}`); } const depth=xpath.split("/").length-1; const preds=(xpath.match(/\[.*?\]/g)||[]).length; const complex=depth+preds*2; const complexPen=Math.min(20,complex*Math.abs(SCORE_WEIGHTS.xpathComplexityPenalty)); score-=complexPen; log(`${xpath} Complexity(${complex}): -${complexPen.toFixed(1)}`); const single=count===1; if(single) { score+=SCORE_WEIGHTS.isSingleElement; log(`${xpath} Single bonus: +${SCORE_WEIGHTS.isSingleElement}`); } else if(count>1) { const multiPen=Math.min(30,(count-1)*5); score-=multiPen; log(`${xpath} Found ${count}: -${multiPen.toFixed(1)}`); } log(`${xpath} Final Score: ${score.toFixed(2)}`); return Math.max(0,score);
};
const getLlmCandidateXPaths = async (html, snippets, feedback=[]) => {
    logInfo("[LLM API] Requesting XPaths..."); const MAX_HTML = 120000; const truncated = html.length > MAX_HTML ? html.substring(0, MAX_HTML)+"..." : html; const sysPrompt = `You are an expert HTML analyzer identifying the main content container XPath. Exclude headers, footers, navs, sidebars, comments, ads. Prioritize <article>, <main>, descriptive IDs/classes. Aim for precision. Respond ONLY with a JSON array of valid XPath selector strings. No extra text.`; let userPrompt = `Analyze HTML. Identify 3-5 candidate XPaths for main content.`; if (snippets?.length > 0) userPrompt += `\n\nHints:\n${JSON.stringify(snippets)}`; else userPrompt += `\n\nNo snippets; use structure/attributes.`; if (feedback?.length > 0) { userPrompt += `\n\nFeedback (higher score=better):\n`; feedback.forEach(item => { userPrompt += `- "${item.xpath}": ${item.result.replace(/"/g,"'").substring(0,150)}\n`; }); userPrompt += `\nGenerate *new* candidates. Avoid failed patterns (score 0). Improve specificity. Avoid "//div".`; } else userPrompt += `\n\nGenerate initial list.`; userPrompt += `\n\nRespond ONLY JSON array. Example: ["//article", "//div[@class='content']"]`; userPrompt += "\n\nHTML:\n"+truncated; try { logDebug("[LLM API] Sending..."); if (ENABLE_DEBUG_LOGGING && feedback.length > 0) logDebug("[LLM API] Feedback:", JSON.stringify(feedback.slice(0,3),null,1)); const resp = await axios.post(LLM_CHAT_COMPLETIONS_ENDPOINT, { model: LLM_MODEL, messages: [{role:"system", content:sysPrompt}, {role:"user", content:userPrompt}], response_format:{type:"json_object"}, temperature:0.3, max_tokens:500 }, { headers:{Authorization:`Bearer ${OPENROUTER_API_KEY}`, "Content-Type":"application/json", "X-Title":"smartScraper", "HTTP-Referer":"https://github.com/bogorad/smartScraper"}, timeout:75000 }); if (!resp.data?.choices?.length > 0) { logWarn("[LLM API] No choices."); logDebug("[LLM API] Resp:", resp.data); return []; } const content = resp.data.choices[0].message?.content; if (!content) { logWarn("[LLM API] Empty content."); return []; } logDebug("[LLM API] Raw Resp:", content); let candidates = null; try { candidates = JSON.parse(content); if (Array.isArray(candidates)) logDebug("[LLM API] Parsed array."); else if (typeof candidates==='object'&&candidates!==null) { const key = Object.keys(candidates).find(k => Array.isArray(candidates[k]) && candidates[k].every(i => typeof i === 'string')); if (key) { logDebug(`[LLM API] Found array key: ${key}`); candidates = candidates[key]; } else { logWarn("[LLM API] JSON object has no array key."); candidates = null; } } else { logWarn("[LLM API] Parsed non-object/array."); candidates = null; } } catch (e) { logWarn(`[LLM API] Direct JSON parse failed: ${e.message}. Fallback...`); let txt = content.trim(); const rgx = /```(?:json)?\s*([\s\S]*?)\s*```/; const m = txt.match(rgx); if (m?.[1]) { logDebug("[LLM API] Regex: Code block."); txt = m[1].trim(); } else { const fb = txt.indexOf("["); const lb = txt.lastIndexOf("]"); if (fb!==-1 && lb>fb) { logDebug("[LLM API] Regex: Brackets."); txt = txt.substring(fb, lb+1); } else { logWarn("[LLM API] Regex: No JSON found."); txt = null; } } if(txt) { try { candidates = JSON.parse(txt); } catch (fe) { logError(`[LLM API] Fallback parse failed: ${fe.message}`); return []; } } else return []; } if (Array.isArray(candidates) && candidates.every(i => typeof i === "string")) { const valid = candidates.filter(x => x?.trim()?.length > 2 && (x.trim().startsWith("/") || x.trim().startsWith("."))); if (valid.length !== candidates.length) logWarn(`[LLM API] Filtered ${candidates.length - valid.length} invalid XPaths.`); logInfo(`[LLM API] Parsed ${valid.length} candidates.`); return valid; } else { logError("[LLM API] Parsed not array of strings:", candidates); return []; } }
    catch (err) { logError(`[LLM API] Call error: ${err.message}`); if (err.response) { logError("[LLM API] Status:", err.response.status); logError("[LLM API] Data:", JSON.stringify(err.response.data,null,2)); } return []; }
};

// --- Core Extraction Logic ---
const fetchWithStoredData = async (url, xpath, cookieName, cookieValue, debug = false) => {
    logDebug(`[Fetch Stored] fetchWithStoredData called for: ${url}`);
    logDebug(`[Fetch Stored] Params - XPath: ${xpath || 'None'}, CookieName: ${cookieName || 'None'}, CookieValue: ${cookieValue ? 'Exists' : 'None'}`);
    let browser = null, userDataDir = null, page = null, extractedHtml = null, htmlContentForSave = null;
    try {
        logDebug("[Fetch Stored] Launching browser...");
        const launchRes = await launchPuppeteerBrowser(debug); browser = launchRes.browser; userDataDir = launchRes.userDataDir; page = await browser.newPage();
        logDebug("[Fetch Stored] Browser launched.");

        if (cookieName && cookieValue) {
            logInfo(`[Fetch Stored] Attempting to set stored cookie '${cookieName}'...`);
            const cookieToSet = { name: cookieName, value: cookieValue, url: url, path: '/', secure: url.startsWith('https://'), httpOnly: false, sameSite: 'Lax' };
            logDebug("[Fetch Stored] Cookie object:", cookieToSet);
            try { await page.setCookie(cookieToSet); logInfo(`[Fetch Stored] Set cookie OK.`); }
            catch (cookieError) { logError(`[Fetch Stored] Failed set cookie '${cookieName}':`, cookieError); }
        } else { logDebug("[Fetch Stored] No stored cookie to set."); }

        logDebug("[Fetch Stored] Calling navigateAndPreparePage (DataDome Check: false)...");
        // *** Pass false for performDataDomeCheck ***
        const navigationSuccessful = await navigateAndPreparePage(page, url, debug, false);
        logDebug(`[Fetch Stored] navigateAndPreparePage result: ${navigationSuccessful}`);
        if (!navigationSuccessful) { logError(`[Fetch Stored] Navigation/prep failed (without explicit DD check).`); try { htmlContentForSave = await getHtmlContent(page); } catch {} await saveHtmlOnFailure(url, htmlContentForSave); await cleanupPuppeteer(page, browser, userDataDir, debug); return null; }

        // --- Save HTML just before extraction attempt ---
        logDebug("[Fetch Stored] Attempting to get HTML for saving before extraction...");
        htmlContentForSave = await getHtmlContent(page);
        await saveFullHtmlPreExtract(url, htmlContentForSave, SUCCESSFUL_HTML_DIR);
        // --- End Save HTML Step ---

        if (xpath) {
            logInfo(`[Fetch Stored] Evaluating stored XPath: ${xpath}`);
            extractedHtml = await page.evaluate(xp => { try { const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; return el?.innerHTML?.trim() || null; } catch (e) { console.error(`[Eval] Stored XPath error: ${e.message}`); return null; } }, xpath);
            logDebug(`[Fetch Stored] XPath evaluation result: ${extractedHtml ? `Content Length ${extractedHtml.length}` : 'No Content/Error'}`);
            if (extractedHtml?.length > 0) { logInfo(`[Fetch Stored] Extracted OK.`); await cleanupPuppeteer(page, browser, userDataDir, debug); return extractedHtml; }
            else { logWarn(`[Fetch Stored] Stored XPath "${xpath}" failed extraction.`); await cleanupPuppeteer(page, browser, userDataDir, debug); return null; }
        } else { logInfo("[Fetch Stored] Nav OK, but no stored XPath."); await cleanupPuppeteer(page, browser, userDataDir, debug); return null; }
    } catch (error) { logError(`[Fetch Stored] Unhandled error:`, error); await saveHtmlOnFailure(url, htmlContentForSave); await cleanupPuppeteer(page, browser, userDataDir, debug); return null; }
};

const findArticleXPathAndExtract = async (url, debug = false) => {
    logDebug(`[Discovery] findArticleXPathAndExtract called for: ${url}`);
    let browser = null, userDataDir = null, page = null, htmlContent = null, bestXPath = null, extractedHtml = null;
    try {
        logDebug("[Discovery] Launching browser...");
        const launchRes = await launchPuppeteerBrowser(debug); browser = launchRes.browser; userDataDir = launchRes.userDataDir; page = await browser.newPage();
        logDebug("[Discovery] Browser launched.");

        logDebug("[Discovery] Calling navigateAndPreparePage (DataDome Check: true)...");
        // *** Pass true (or rely on default) for performDataDomeCheck ***
        const navOK = await navigateAndPreparePage(page, url, debug, true);
        logDebug(`[Discovery] navigateAndPreparePage result: ${navOK}`);
        if (!navOK) { logError("[Discovery] Nav/prep failed (with explicit DD check). Abort."); try { htmlContent = await getHtmlContent(page); } catch {} await saveHtmlOnFailure(url, htmlContent); await cleanupPuppeteer(page, browser, userDataDir, debug); return null; }

        logDebug("[Discovery] Getting HTML content for LLM/Snippets...");
        htmlContent = await getHtmlContent(page); if (!htmlContent) { logError("[Discovery] Get HTML failed after nav. Abort."); await cleanupPuppeteer(page, browser, userDataDir, debug); return null; }
        logInfo("[Discovery] HTML OK for analysis.");

        logDebug("[Discovery] Extracting snippets...");
        const snippets = await extractArticleSnippets(page); logDebug(`[Discovery] ${snippets.length} snippets found.`);

        let tried = new Set(); let feedback = []; let candidates = [];
        logDebug("[Discovery] Starting LLM interaction loop...");
        for (let retry = 0; retry <= MAX_LLM_RETRIES; retry++) {
            logInfo(`[Discovery] LLM Attempt ${retry+1}/${MAX_LLM_RETRIES+1}`);
            const llmPaths = await getLlmCandidateXPaths(htmlContent, snippets, retry > 0 ? feedback : []);
            if (!llmPaths?.length) { logWarn(`[Discovery] LLM no candidates attempt ${retry+1}.`); if (retry < MAX_LLM_RETRIES) { await new Promise(r=>setTimeout(r,3000)); continue; } else break; }
            const newPaths = llmPaths.filter(x => !tried.has(x?.trim()));
            if (newPaths.length === 0) { logWarn(`[Discovery] LLM only old paths attempt ${retry+1}.`); if (retry < MAX_LLM_RETRIES) { await new Promise(r=>setTimeout(r,2000)); continue; } else break; }
            logInfo(`[Discovery] Validating ${newPaths.length} new paths...`); feedback = []; let bestScoreThis = -1;
            const promises = newPaths.map(async x => { const tx = x?.trim(); if (!tx) return null; tried.add(tx); const res = await queryXPathWithDetails(page, tx, TAGS_TO_COUNT); return res.count >= 0 ? { xpath: tx, ...res } : null; });
            const results = (await Promise.all(promises)).filter(r => r !== null);
            logDebug(`[Discovery] Validation results count: ${results.length}`);
            for (const res of results) { const { xpath, count, firstElementDetails } = res; if (count <= 0 || !firstElementDetails) { logDebug(`[Validation] "${xpath}" bad count/details.`); feedback.push({ xpath, result: `Score 0 (Found ${count}, No details)` }); continue; } const score = scoreElement(firstElementDetails, count, xpath); feedback.push({ xpath, result: `Score ${score.toFixed(1)} (Found ${count}, P:${firstElementDetails.descendantCounts?.p??"N/A"})` }); if (score > 0) { candidates.push({ xpath, score, elementDetails: firstElementDetails }); logInfo(`[Validation] "${xpath}" Score: ${score.toFixed(2)} (${count})`); bestScoreThis = Math.max(bestScoreThis, score); } else logDebug(`[Validation] "${xpath}" Score 0.`); }
            logInfo(`[Discovery] Attempt ${retry+1} done. Best=${bestScoreThis > -1 ? bestScoreThis.toFixed(2) : "N/A"}. Total=${candidates.length}`);
            if (retry < MAX_LLM_RETRIES) await new Promise(r => setTimeout(r, 1500));
        }
        logDebug("[Discovery] LLM loop finished.");

        if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score); bestXPath = candidates[0].xpath;
            logInfo(`[Discovery] Best XPath selected: ${bestXPath} (Score: ${candidates[0].score.toFixed(2)})`);

            // --- Save HTML just before final extraction attempt ---
            logDebug("[Discovery] Attempting to get HTML for saving before final extraction...");
            const htmlForSave = await getHtmlContent(page);
            await saveFullHtmlPreExtract(url, htmlForSave, SUCCESSFUL_HTML_DIR);
            // --- End Save HTML Step ---

            logInfo(`[Discovery] Attempting final extraction with: ${bestXPath}`);
            try {
                if (page.isClosed()) throw new Error("Page closed.");
                extractedHtml = await page.evaluate(xp => { try { const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; return el?.innerHTML?.trim() || null; } catch (e) { console.error(`[Eval] Extract error: ${e.message}`); return null; } }, bestXPath);
                if (extractedHtml) {
                    logInfo("[Discovery] Extraction OK.");
                    logInfo(`[Discovery] Storing discovered XPath for ${getDomainFromUrl(url)}.`);
                    try { const storageData = loadStorage(); const domain = getDomainFromUrl(url); if (domain) { let domainEntry = storageData[domain] || {}; domainEntry.xpath = bestXPath; storageData[domain] = domainEntry; saveStorage(storageData); logDebug(`[Discovery] XPath saved.`); } else logWarn("[Discovery] No domain to save XPath."); }
                    catch (storageError) { logError("[Discovery] Failed save XPath:", storageError); }
                } else { logWarn(`[Discovery] XPath "${bestXPath}" no content on final extraction.`); bestXPath = null; }
            } catch (e) { logError(`[Discovery] Final extraction error:`, e); bestXPath = null; extractedHtml = null; }
        } else { logError("[Discovery] No candidates found after validation."); }

        if (bestXPath && extractedHtml !== null) { logDebug("[Discovery] Returning success."); await cleanupPuppeteer(page, browser, userDataDir, debug); return { foundXPath: bestXPath, extractedHtml }; }
        else { logWarn("[Discovery] Failed find/extract. Returning failure."); await saveHtmlOnFailure(url, htmlContent); await cleanupPuppeteer(page, browser, userDataDir, debug); return null; } // Save original analysis HTML on failure
    } catch (error) { logError("[Discovery] Unhandled error:", error); await saveHtmlOnFailure(url, htmlContent); await cleanupPuppeteer(page, browser, userDataDir, debug); return null; }
};

// --- Main Application Logic ---
const getContent = async (url) => {
  logInfo(`--- Starting getContent for: ${url} ---`);
  const domain = getDomainFromUrl(url); if (!domain) return { success: false, error: `Invalid URL: ${url}` }; logInfo(`Domain: ${domain}`);
  const storageData = loadStorage(); const siteData = storageData[domain];
  const knownXpath = siteData?.xpath; const knownCookieName = siteData?.cookie_name; const knownCookieValue = siteData?.cookie_value;
  logDebug(`[Main] Stored data for ${domain}: XPath=${!!knownXpath}, CookieName=${knownCookieName || 'None'}`);
  let extractedHtml = null;
  let attemptedStoredFetch = false;

  // --- Stage 1: Attempt with stored cookie (skip explicit DD check) ---
  if (knownCookieName && knownCookieValue) {
      logInfo(`[Main] Stored cookie found for ${domain}. Attempting fetch without explicit DD check...`);
      attemptedStoredFetch = true;
      extractedHtml = await fetchWithStoredData(url, knownXpath, knownCookieName, knownCookieValue, ENABLE_DEBUG_LOGGING);
      logDebug(`[Main] Stage 1 fetchWithStoredData (using cookie) result: ${extractedHtml !== null ? 'Success' : 'Failure'}`);
      if (extractedHtml !== null) {
          logInfo(`[Main] Success with stored cookie.`);
          return { success: true, content: extractedHtml };
      } else {
          logWarn(`[Main] Fetch stored failed (using cookie). Fallback needed...`);
      }
  }
  // --- Stage 2: Attempt with stored XPath only (if no cookie or stage 1 failed) ---
  else if (knownXpath && !attemptedStoredFetch) { // Only try this if cookie wasn't present
       logInfo(`[Main] No stored cookie, but XPath found. Attempting fetch without explicit DD check...`);
       attemptedStoredFetch = true; // Mark as attempted
       extractedHtml = await fetchWithStoredData(url, knownXpath, null, null, ENABLE_DEBUG_LOGGING); // No cookie passed
       logDebug(`[Main] Stage 2 fetchWithStoredData (XPath only) result: ${extractedHtml !== null ? 'Success' : 'Failure'}`);
       if (extractedHtml !== null) {
           logInfo(`[Main] Success with stored XPath only.`);
           return { success: true, content: extractedHtml };
       } else {
           logWarn(`[Main] Fetch stored failed (XPath only). Fallback needed...`);
       }
  }
  // --- Stage 3: Fallback to Discovery (if no stored data or previous stages failed) ---
  else if (!attemptedStoredFetch) {
       logInfo(`[Main] No stored data found. Starting discovery...`);
  }

  logInfo("[Main] Calling findArticleXPathAndExtract (will perform DD check if needed)...");
  const discoveryResult = await findArticleXPathAndExtract(url, ENABLE_DEBUG_LOGGING);
  logDebug(`[Main] findArticleXPathAndExtract result: ${discoveryResult ? 'Object received' : 'null'}`);

  if (discoveryResult?.extractedHtml !== null) {
    logInfo(`[Main] Discovery successful.`);
    return { success: true, content: discoveryResult.extractedHtml };
  } else {
    logError(`[Main] Discovery failed or aborted for ${domain}.`);
    // Clear stored XPath if fetch was attempted with it and discovery also failed
    if (attemptedStoredFetch && knownXpath) {
       logWarn(`[Main] Both stored fetch (XPath: ${knownXpath}) and discovery failed. Clearing stored XPath.`);
       try { const currentStorage = loadStorage(); if (currentStorage[domain]) { delete currentStorage[domain].xpath; saveStorage(currentStorage); } }
       catch (storageError) { logError(`[Main Cleanup] Failed clear XPath:`, storageError); }
    }
    return { success: false, error: `Failed extraction for ${domain}. Fetch/Discovery failed.` };
  }
};

// --- Command Line Execution ---
(async () => {
  const targetUrl = process.argv[2]; if (!targetUrl) { console.error("Usage: node smartScraper2.js <url>"); process.exit(1); }
  logInfo(`--- Script Start --- Target URL: ${targetUrl}`);
  try { new URL(targetUrl); } catch { console.error(`Invalid URL: ${targetUrl}`); process.exit(1); }
  try { logDebug("Initializing storage check..."); if (!fs.existsSync(STORAGE_FILE_PATH)) { logInfo("Creating new storage file."); saveStorage({}); } else { logInfo("Loading existing storage."); loadStorage(); } logDebug("Storage check OK."); }
  catch (e) { console.error("FATAL Storage init/load error.", e); process.exit(1); }
  let exitCode = 1; try { const result = await getContent(targetUrl); if (result.success && result.content) { console.log(result.content); exitCode = 0; } else { console.error(`Error: ${result.error || "Unknown failure."}`); exitCode = 1; } } catch (err) { logError("\n--- Unhandled Top-Level Error ---"); console.error(err); exitCode = 1; } finally { logInfo(`--- Script End --- Exit Code: ${exitCode}`); process.exit(exitCode); }
})();
