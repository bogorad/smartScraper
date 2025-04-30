// smartScraper2.js corrected

// --- Required Libraries ---
require("dotenv").config();
const axios = require("axios");
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
// Removed: require('http') - No longer needed for bridge
// Removed: require('socks') - No longer needed for bridge

// --- Configuration ---
const STORAGE_FILE_PATH = path.join(__dirname, "xpath_storage.json");
const LLM_API_BASE_URL = "https://openrouter.ai/api/v1";
const LLM_CHAT_COMPLETIONS_ENDPOINT = `${LLM_API_BASE_URL}/chat/completions`;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL;
const EXECUTABLE_PATH =
  process.env.EXECUTABLE_PATH || "/usr/bin/google-chrome-stable";
const EXTENSION_PATHS = process.env.EXTENSION_PATHS;

// --- Proxy & 2Captcha Configuration ---
const TWOCAPTCHA_API_KEY = process.env.TWOCAPTCHA_API_KEY;
// *** IMPORTANT: Use an HTTP proxy URL now ***
const MY_HTTP_PROXY = process.env.MY_HTTP_PROXY; // e.g., "http://user:pass@host:port"
const DADADOME_DOMAINS = ["wsj.com"]; // Add domains known to use DataDome here
const TWOCAPTCHA_CREATE_TASK_URL = "https://api.2captcha.com/createTask";
const TWOCAPTCHA_GET_RESULT_URL = "https://api.2captcha.com/getTaskResult";
const CAPTCHA_POLL_INTERVAL = 10000;
const CAPTCHA_SOLVE_TIMEOUT = 180000;

// Removed: Local Proxy Bridge Configuration (LOCAL_PROXY_HOST, LOCAL_PROXY_PORT, localProxyServer)

// Check required environment variables
if (!OPENROUTER_API_KEY) {
  console.error("FATAL: OPENROUTER_API_KEY environment variable is not set.");
  process.exit(1);
}
if (!LLM_MODEL) {
  console.error("FATAL: LLM_MODEL environment variable is not set.");
  process.exit(1);
}
if (!fs.existsSync(EXECUTABLE_PATH)) {
  console.warn(
    `WARN: EXECUTABLE_PATH "${EXECUTABLE_PATH}" does not exist. Puppeteer might fail.`,
  );
}
if (!TWOCAPTCHA_API_KEY) {
  console.error("FATAL: TWOCAPTCHA_API_KEY environment variable is not set.");
  process.exit(1);
}
// *** Check for the HTTP proxy variable ***
if (!MY_HTTP_PROXY) {
  console.error("FATAL: MY_HTTP_PROXY environment variable is not set.");
  console.error(
    "Please set MY_HTTP_PROXY in your .env file (e.g., http://user:pass@host:port)",
  );
  process.exit(1);
}

// --- Constants from find-xpath.js ---
const SCORE_WEIGHTS = {
  isSingleElement: 80,
  paragraphCount: 1,
  unwantedPenaltyRatio: -75,
  isSemanticTag: 75,
  hasDescriptiveIdOrClass: 30,
  textDensity: 50,
  linkDensityPenalty: -30,
  mediaPresence: 25,
  xpathComplexityPenalty: -5,
};
const MIN_PARAGRAPH_THRESHOLD = 5;
const TAGS_TO_COUNT = [
  "p",
  "nav",
  "aside",
  "footer",
  "header",
  "ul",
  "ol",
  "img",
  "a",
  "video",
  "audio",
  "picture",
];
const UNWANTED_TAGS = ["nav", "aside", "footer", "header"];
const MAX_LLM_RETRIES = 2;
const ENABLE_DEBUG_LOGGING = process.env.DEBUG === "true";
const SAVE_HTML_ON_FAILURE = process.env.SAVE_HTML_ON_FAILURE === "true";
const FAILED_HTML_DIR = path.join(__dirname, "failed_html_dumps");

// --- Logging Utility ---
const logInfo = (...args) => console.log("[INFO]", ...args);
const logDebug = (...args) => {
  if (ENABLE_DEBUG_LOGGING) console.log("[DEBUG]", ...args);
};
const logWarn = (...args) => console.warn("[WARN]", ...args);
const logError = (...args) => console.error("[ERROR]", ...args);

// --- Storage Management ---
const loadStorage = () => {
  try {
    if (fs.existsSync(STORAGE_FILE_PATH)) {
      const rawData = fs.readFileSync(STORAGE_FILE_PATH, "utf8");
      return JSON.parse(rawData);
    }
    logInfo(
      `Storage file not found at ${STORAGE_FILE_PATH}. Starting with empty storage.`,
    );
    return {};
  } catch (error) {
    logError(
      `Failed to load or parse storage file ${STORAGE_FILE_PATH}:`,
      error,
    );
    return {};
  }
};
const saveStorage = (data) => {
  try {
    const jsonData = JSON.stringify(data, null, 2);
    fs.writeFileSync(STORAGE_FILE_PATH, jsonData, "utf8");
    logDebug("Storage saved successfully.");
  } catch (error) {
    logError(`Failed to save storage file ${STORAGE_FILE_PATH}:`, error);
  }
};
const getDomainFromUrl = (urlString) => {
  try {
    const url = new URL(urlString);
    let hostname = url.hostname;
    if (hostname.startsWith("www.")) {
      hostname = hostname.substring(4);
    }
    return hostname.toLowerCase();
  } catch (error) {
    logError(`Invalid URL format: ${urlString}`, error);
    return null;
  }
};

// Removed: parseSocks5ProxyString function
// Removed: REMOTE_SOCKS_CONFIG variable

// --- Updated Proxy Parsing Utility (ONLY for 2Captcha API call) ---
/**
 * Parses an HTTP proxy string for 2Captcha API details.
 * @param {string} proxyString - e.g., "http://user:pass@host:port"
 * @returns {{ type: string, address: string, port: number, login?: string, password?: string } | null} Parsed proxy info or null on error.
 */
const parseProxyStringFor2Captcha = (proxyString) => {
  if (!proxyString) {
    logError("[2Captcha Proxy Parse] Proxy string is empty.");
    return null;
  }
  try {
    const url = new URL(proxyString);
    const type = url.protocol.replace(":", "").toLowerCase(); // 'http' or 'https'
    if (type !== "http" && type !== "https") {
      logError(
        `[2Captcha Proxy Parse] Unsupported proxy type: ${type}. Only http/https is expected now.`,
      );
      return null;
    }

    const address = url.hostname;
    if (!address) {
      logError(
        `[2Captcha Proxy Parse] Invalid proxy format: Missing host in ${proxyString}`,
      );
      return null;
    }

    let port = parseInt(url.port, 10);
    if (!port || isNaN(port)) {
      const defaultPort = type === "https" ? 443 : 80;
      logWarn(
        `[2Captcha Proxy Parse] Port not specified or invalid in "${proxyString}". Defaulting to ${defaultPort} for ${type.toUpperCase()} for 2Captcha API call.`,
      );
      port = defaultPort;
    }

    const login = url.username ? decodeURIComponent(url.username) : undefined;
    const password = url.password
      ? decodeURIComponent(url.password)
      : undefined;

    logDebug(
      `[2Captcha Proxy Parse] Parsed for API: type=${type.toUpperCase()}, address=${address}, port=${port}, login=${login ? "***" : "N/A"}`,
    );
    return { type: type.toUpperCase(), address, port, login, password }; // 2Captcha expects uppercase type like 'HTTP'
  } catch (error) {
    logError(
      `[2Captcha Proxy Parse] Failed to parse proxy string "${proxyString}":`,
      error,
    );
    return null;
  }
};

// Parse ONLY for 2Captcha API usage using the HTTP proxy string
const PROXY_INFO_FOR_2CAPTCHA = parseProxyStringFor2Captcha(MY_HTTP_PROXY);
if (!PROXY_INFO_FOR_2CAPTCHA) {
  logError(
    "FATAL: Could not parse MY_HTTP_PROXY for 2Captcha API details. Please check the format in your .env file (e.g., http://user:pass@host:port).",
  );
  process.exit(1);
}

// Removed: startLocalProxyServer function
// Removed: stopLocalProxyServer function

// --- Puppeteer and Extraction Logic ---

/**
 * Launches Puppeteer browser instance using the DIRECT HTTP proxy.
 * Handles proxy authentication setup.
 * @param {boolean} debug - Enable debug logging.
 * @returns {Promise<{ browser: puppeteer.Browser, userDataDir: string }>} - Browser instance and user data directory path.
 * @throws {Error} - If browser launch fails or proxy parsing fails.
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

    // --- Parse HTTP Proxy for Puppeteer Launch and Authentication ---
    const proxyUrlString = MY_HTTP_PROXY;
    if (!proxyUrlString) {
      // Should be caught earlier, but double-check
      throw new Error("MY_HTTP_PROXY environment variable is not set!");
    }

    let proxyHostPort = null;
    let proxyCredentials = null;
    try {
      const parsedProxyUrl = new URL(proxyUrlString);
      // Determine default port based on protocol if not specified
      const defaultPort = parsedProxyUrl.protocol === "https:" ? 443 : 80;
      const port = parsedProxyUrl.port || defaultPort;
      proxyHostPort = `${parsedProxyUrl.hostname}:${port}`;

      if (parsedProxyUrl.username) {
        proxyCredentials = {
          username: decodeURIComponent(parsedProxyUrl.username),
          password: decodeURIComponent(parsedProxyUrl.password || ""),
        };
      }
      logInfo(
        `[LAUNCH] Configuring Puppeteer proxy server: ${proxyHostPort}` +
          `${proxyCredentials ? " (Authentication will be handled via page.authenticate)" : ""}`,
      );
    } catch (parseError) {
      logError(
        `[LAUNCH] Failed to parse MY_HTTP_PROXY: ${proxyUrlString}`,
        parseError,
      );
      throw new Error(`Invalid MY_HTTP_PROXY format: ${proxyUrlString}`);
    }
    // --- End Proxy Parsing ---

    const launchArgs = [
      "--no-sandbox",
      `--proxy-server=${proxyHostPort}`, // *** CORRECT: Use only host:port ***
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      // "--use-gl=swiftshader",
      "--window-size=1280,720",
      // "--font-render-hinting=none",
      "--ignore-certificate-errors", // May still be needed depending on proxy/target certs
      ...extensionArgs,
    ];
    logDebug("[LAUNCH] Puppeteer launch arguments:", launchArgs);
    logDebug("[LAUNCH] Initializing browser instance...");
    browser = await puppeteer.launch({
      executablePath: EXECUTABLE_PATH,
      headless: "new", // Keep modern headless
      userDataDir,
      args: launchArgs,
      dumpio: debug && process.env.NODE_ENV === "development",
      timeout: 90000, // Keep increased timeout
      ignoreHTTPSErrors: true, // Keep corresponding flag
    });
    logDebug("[LAUNCH] Browser launched successfully.");

    // *** Store credentials on the browser context for page.authenticate later ***
    const browserContext = browser.defaultBrowserContext();
    browserContext.proxyCredentials = proxyCredentials; // Will be null if no auth needed

    return { browser, userDataDir };
  } catch (error) {
    logError("[LAUNCH] Failed to launch browser:", error.message);
    if (userDataDir) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
        logDebug("[LAUNCH] Cleaned up user data dir after launch failure.");
      } catch (e) {
        if (debug) logError("[LAUNCH] Error cleaning up user data dir:", e);
      }
    }
    throw error; // Re-throw the error
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
  if (page) {
    try {
      if (!page.isClosed()) {
        await page.close();
        logDebug("[CLEANUP] Page closed.");
      } else {
        logDebug("[CLEANUP] Page was already closed.");
      }
    } catch (e) {
      if (debug) logError("[CLEANUP] Error closing page:", e.message);
    }
  }
  if (browser) {
    try {
      if (browser.isConnected()) {
        await new Promise((resolve) => setTimeout(resolve, 500)); // Short delay before closing
        await browser.close();
        logDebug("[CLEANUP] Browser closed.");
      } else {
        logDebug("[CLEANUP] Browser was already disconnected.");
      }
    } catch (e) {
      if (debug) logError("[CLEANUP] Error closing browser:", e.message);
    }
  }
  if (userDataDir) {
    logDebug(`[CLEANUP] Removing user data dir: ${userDataDir}`);
    try {
      // Use async rm for potentially better handling on busy systems
      await fs.promises.rm(userDataDir, { recursive: true, force: true });
      logDebug("[CLEANUP] User data dir removed.");
    } catch (err) {
      if (err.code !== "ENOENT") {
        // Ignore if already deleted
        if (debug)
          logError(
            "[CLEANUP] Failed to remove user data dir:",
            userDataDir,
            err,
          );
      } else {
        logDebug("[CLEANUP] User data dir already removed or never existed.");
      }
    }
  }
  logDebug("[CLEANUP] Puppeteer cleanup finished.");
};

// --- DataDome CAPTCHA Solver ---
// Uses PROXY_INFO_FOR_2CAPTCHA which is parsed from MY_HTTP_PROXY
const solveDataDomeWith2Captcha = async (websiteURL, captchaUrl, userAgent) => {
  logInfo(`[2CAPTCHA] Attempting to solve DataDome for ${websiteURL}`);
  logDebug(`[2CAPTCHA] Captcha URL: ${captchaUrl}`);
  logDebug(`[2CAPTCHA] User Agent: ${userAgent}`);

  // Use the specifically parsed info for 2Captcha API call
  const taskPayload = {
    type: "DataDomeSliderTask",
    websiteURL: websiteURL,
    captchaUrl: captchaUrl,
    userAgent: userAgent,
    proxyType: PROXY_INFO_FOR_2CAPTCHA.type, // Should be 'HTTP' or 'HTTPS' now
    proxyAddress: PROXY_INFO_FOR_2CAPTCHA.address,
    proxyPort: PROXY_INFO_FOR_2CAPTCHA.port,
    ...(PROXY_INFO_FOR_2CAPTCHA.login && {
      proxyLogin: PROXY_INFO_FOR_2CAPTCHA.login,
    }),
    ...(PROXY_INFO_FOR_2CAPTCHA.password && {
      proxyPassword: PROXY_INFO_FOR_2CAPTCHA.password,
    }),
  };

  const requestBody = {
    clientKey: TWOCAPTCHA_API_KEY,
    task: taskPayload,
  };
  if (ENABLE_DEBUG_LOGGING) {
    const debugBody = { ...requestBody };
    if (debugBody.task.proxyPassword) debugBody.task.proxyPassword = "***";
    logDebug(
      "[2CAPTCHA] Sending createTask request with body:",
      JSON.stringify(debugBody, null, 2),
    );
  }

  let taskId;
  try {
    const createTaskResponse = await axios.post(
      TWOCAPTCHA_CREATE_TASK_URL,
      requestBody,
      { timeout: 30000 },
    );
    logDebug("[2CAPTCHA] createTask response:", createTaskResponse.data);
    if (createTaskResponse.data.errorId !== 0) {
      logError(
        `[2CAPTCHA] createTask failed: ${createTaskResponse.data.errorCode} - ${createTaskResponse.data.errorDescription}`,
      );
      return null;
    }
    taskId = createTaskResponse.data.taskId;
    logInfo(`[2CAPTCHA] Task created successfully. Task ID: ${taskId}`);
  } catch (error) {
    logError("[2CAPTCHA] Error sending createTask request:", error.message);
    if (error.response)
      logError("[2CAPTCHA] Response data:", error.response.data);
    return null;
  }

  const startTime = Date.now();
  while (Date.now() - startTime < CAPTCHA_SOLVE_TIMEOUT) {
    logDebug(`[2CAPTCHA] Polling for result for Task ID: ${taskId}...`);
    try {
      await new Promise((resolve) =>
        setTimeout(resolve, CAPTCHA_POLL_INTERVAL),
      );
      const getResultResponse = await axios.post(
        TWOCAPTCHA_GET_RESULT_URL,
        { clientKey: TWOCAPTCHA_API_KEY, taskId: taskId },
        { timeout: 20000 },
      );
      logDebug("[2CAPTCHA] getTaskResult response:", getResultResponse.data);
      if (getResultResponse.data.errorId !== 0) {
        logError(
          `[2CAPTCHA] getTaskResult failed: ${getResultResponse.data.errorCode} - ${getResultResponse.data.errorDescription}`,
        );
        if (
          getResultResponse.data.errorCode === "ERROR_CAPTCHA_UNSOLVABLE" ||
          getResultResponse.data.errorCode === "ERR_PROXY_CONNECTION_FAILED"
        ) {
          logError(
            "[2CAPTCHA] CAPTCHA unsolvable or proxy failed according to 2Captcha worker. Check proxy validity/credentials sent to 2Captcha.",
          );
        }
        return null; // Stop polling on error
      }
      const status = getResultResponse.data.status;
      if (status === "ready") {
        logInfo(
          `[2CAPTCHA] CAPTCHA solved successfully for Task ID: ${taskId}`,
        );
        const solutionCookie = getResultResponse.data.solution?.cookie;
        if (!solutionCookie) {
          logError(
            "[2CAPTCHA] Solution found but cookie is missing in response.",
          );
          return null;
        }
        logDebug("[2CAPTCHA] Received Cookie:", solutionCookie);
        return solutionCookie;
      } else if (status === "processing") {
        logDebug("[2CAPTCHA] CAPTCHA is still processing...");
      } else {
        logWarn(`[2CAPTCHA] Unknown status received: ${status}`);
      }
    } catch (error) {
      logError(
        `[2CAPTCHA] Error polling getTaskResult for Task ID ${taskId}:`,
        error.message,
      );
      if (error.response)
        logError("[2CAPTCHA] Response data:", error.response.data);
      // Don't immediately exit on polling error, maybe temporary network issue
      await new Promise((resolve) =>
        setTimeout(resolve, CAPTCHA_POLL_INTERVAL / 2),
      );
    }
  }

  logError(
    `[2CAPTCHA] CAPTCHA solving timed out after ${CAPTCHA_SOLVE_TIMEOUT / 1000} seconds for Task ID: ${taskId}.`,
  );
  return null;
};

// --- formatDataDomeCookie function remains the same ---
const formatDataDomeCookie = (cookieString, targetUrl) => {
  logDebug(`[Cookie] Formatting cookie string: ${cookieString}`);
  if (!cookieString || !cookieString.includes("=")) return null;
  try {
    const parts = cookieString.split(";").map((part) => part.trim());
    const [name, ...valueParts] = parts[0].split("=");
    const value = valueParts.join("=");
    if (!name || !value) {
      logError(
        "[Cookie] Failed to parse name/value from cookie string:",
        parts[0],
      );
      return null;
    }
    const cookie = {
      name: name.trim(),
      value: value.trim(),
      url: targetUrl, // Needs URL for domain/path context if not provided
      path: "/",
      secure: false,
      httpOnly: false,
      sameSite: "Lax",
    };

    for (let i = 1; i < parts.length; i++) {
      const [attrNameInput, ...attrValueParts] = parts[i].split("=");
      const attrName = attrNameInput.trim().toLowerCase();
      const attrValue = attrValueParts.join("=").trim();

      switch (attrName) {
        case "path":
          cookie.path = attrValue || "/";
          break;
        case "domain":
          // Ensure domain starts with a dot for subdomain matching if necessary
          cookie.domain = attrValue.startsWith(".")
            ? attrValue
            : `.${attrValue}`;
          break;
        case "secure":
          cookie.secure = true;
          break;
        case "samesite":
          const validSameSite = ["Lax", "Strict", "None"];
          const capitalizedSameSite =
            attrValue.charAt(0).toUpperCase() +
            attrValue.slice(1).toLowerCase();
          if (validSameSite.includes(capitalizedSameSite)) {
            cookie.sameSite = capitalizedSameSite;
          } else {
            logWarn(
              `[Cookie] Unknown or invalid SameSite value: ${attrValue}. Using default 'Lax'.`,
            );
            cookie.sameSite = "Lax"; // Default or keep existing
          }
          break;
        case "httponly":
          cookie.httpOnly = true;
          break;
        case "expires":
          try {
            const expiryDate = new Date(attrValue);
            if (!isNaN(expiryDate.getTime())) {
              cookie.expires = Math.floor(expiryDate.getTime() / 1000);
            } else {
              logWarn(`[Cookie] Could not parse expires date: ${attrValue}`);
            }
          } catch (dateErr) {
            logWarn(`[Cookie] Could not parse expires date: ${attrValue}`);
          }
          break;
        case "max-age":
          try {
            const maxAgeSeconds = parseInt(attrValue, 10);
            if (!isNaN(maxAgeSeconds)) {
              cookie.expires = Math.floor(Date.now() / 1000) + maxAgeSeconds;
            } else {
              logWarn(
                `[Cookie] Could not parse max-age as number: ${attrValue}`,
              );
            }
          } catch (numErr) {
            logWarn(`[Cookie] Could not parse max-age: ${attrValue}`);
          }
          break;
        default:
          // Ignore unknown attributes like 'priority' etc.
          logDebug(`[Cookie] Ignoring unknown cookie attribute: ${attrName}`);
          break;
      }
    }

    // If domain wasn't explicitly set, derive it from the targetUrl
    if (!cookie.domain) {
      try {
        const parsedUrl = new URL(targetUrl);
        // Derive domain correctly: for 'www.example.com', use '.example.com' or 'www.example.com'
        // Using '.hostname' is safer for subdomain matching.
        cookie.domain = parsedUrl.hostname.startsWith("www.")
          ? `.${parsedUrl.hostname.substring(4)}`
          : `.${parsedUrl.hostname}`;

        // Handle cases like bare domains (e.g., localhost, domain.local)
        if (cookie.domain === ".") {
          cookie.domain = parsedUrl.hostname; // Use the hostname directly if it doesn't look like a public domain
        }
        logDebug(`[Cookie] Derived domain from URL: ${cookie.domain}`);
      } catch (urlError) {
        logError(
          `[Cookie] Could not parse target URL to derive domain: ${targetUrl}`,
          urlError,
        );
        // Maybe don't fail entirely, let Puppeteer decide if domain is needed?
        // Setting domain to null might be better if derivation fails.
        cookie.domain = undefined;
      }
    }

    // Final check: if sameSite is None, secure must be true
    if (cookie.sameSite === "None" && !cookie.secure) {
      logWarn(
        "[Cookie] SameSite=None requires Secure attribute. Forcing secure=true.",
      );
      cookie.secure = true;
    }

    logDebug("[Cookie] Formatted cookie object:", cookie);
    return cookie;
  } catch (error) {
    logError("[Cookie] Error parsing cookie string:", cookieString, error);
    return null;
  }
};

/**
 * Handles DataDome detection, solving, and cookie injection if needed.
 * Uses direct HTTP proxy configured at launch and page.authenticate.
 * @param {puppeteer.Page} page
 * @param {string} url
 * @param {string} userAgent - The user agent string being used.
 * @param {boolean} debug
 * @returns {Promise<boolean>} - true if successful or not needed, false on failure.
 */
const handleDataDomeIfNeeded = async (page, url, userAgent, debug = false) => {
  const domain = getDomainFromUrl(url);
  if (!DADADOME_DOMAINS.includes(domain)) {
    logDebug(
      `[DataDome] Domain "${domain}" not in DADADOME list. Skipping check.`,
    );
    return true;
  }

  logInfo(
    `[DataDome] Domain "${domain}" requires CAPTCHA check for URL: ${url}`,
  );

  try {
    // 1. Initial Navigation (uses proxy via launch args + page.authenticate)
    logDebug("[DataDome] Performing initial navigation to detect CAPTCHA...");
    // Note: page.authenticate should already be set before this function is called
    await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 }); // Increased timeout slightly
    logDebug(
      "[DataDome] Initial navigation complete. Checking for CAPTCHA iframe...",
    );

    // 2. Detect CAPTCHA Iframe
    let captchaFrameElement;
    let captchaUrl;
    try {
      const iframeSelector =
        'iframe[src*="captcha-delivery.com"], iframe[src*="geo.captcha-delivery.com"]'; // More robust selector
      // Wait for the iframe itself, not necessarily visibility which can be tricky
      await page.waitForSelector(iframeSelector, {
        timeout: 35000, // Slightly longer wait for iframe
      });
      captchaFrameElement = await page.$(iframeSelector);
      if (!captchaFrameElement) {
        // If selector found but element is null after wait, something is odd
        logWarn(
          "[DataDome] CAPTCHA iframe selector matched but element retrieval failed. Checking page content.",
        );
        // Fall through to page content check
      } else {
        captchaUrl = await page.evaluate(
          (el) => el.getAttribute("src"),
          captchaFrameElement,
        );
        if (captchaUrl) {
          logInfo("[DataDome] Found CAPTCHA iframe.");
          logDebug(`[DataDome] Extracted captchaUrl: ${captchaUrl}`);
        } else {
          logWarn(
            "[DataDome] Found CAPTCHA iframe element but failed to extract src attribute. Checking page content.",
          );
          // Fall through to page content check
        }
      }
    } catch (error) {
      // Timeout likely means no iframe found
      logWarn(
        `[DataDome] CAPTCHA iframe not detected within timeout or error occurred for ${url}. Error: ${error.message}. Checking page content for block indicators.`,
      );
      // Proceed to check page content even if iframe wasn't found or src failed
    }

    // If no captchaUrl was extracted, check page content for definitive block
    if (!captchaUrl) {
      const pageTitle = (await page.title())?.toLowerCase() || "";
      const bodyText = await page.evaluate(
        () => document.body?.innerText?.toLowerCase() || "",
      );
      const blockedIndicators = [
        "blocked",
        "enable javascript",
        "checking your browser",
        "access denied",
        "verify you are human",
      ];

      if (
        blockedIndicators.some(
          (indicator) =>
            pageTitle.includes(indicator) || bodyText.includes(indicator),
        )
      ) {
        logError(
          `[DataDome] Page content suggests a block even though iframe/src wasn't found. Title: ${pageTitle}`,
        );
        return false; // Definitely blocked
      } else {
        logInfo(
          "[DataDome] No clear CAPTCHA iframe or block indicators found. Assuming page loaded correctly.",
        );
        return true; // Assume OK
      }
    }

    // 3. Check 't' parameter (only if captchaUrl was found)
    try {
      const fullCaptchaUrl = new URL(captchaUrl, url); // Resolve relative URLs
      const tParam = fullCaptchaUrl.searchParams.get("t");
      logDebug(`[DataDome] Found 't' parameter value: ${tParam}`);
      if (tParam === "bv") {
        logError(
          `[DataDome] IP address is banned (t=bv detected in captchaUrl). Change proxy IP and retry.`,
        );
        return false;
      }
      if (tParam !== "fe") {
        logWarn(
          `[DataDome] Unexpected 't' parameter value found: ${tParam}. Expected 'fe'. Proceeding cautiously.`,
        );
      }
    } catch (e) {
      logError(
        "[DataDome] Failed to parse captchaUrl or get 't' parameter:",
        e.message,
      );
      // Don't necessarily fail here, maybe 't' param isn't always present
      logWarn("[DataDome] Proceeding despite error parsing 't' parameter.");
    }

    // 4. Solve CAPTCHA via 2Captcha
    const dataDomeCookieString = await solveDataDomeWith2Captcha(
      url,
      captchaUrl,
      userAgent, // Pass the actual user agent
    );
    if (!dataDomeCookieString) {
      logError("[DataDome] Failed to solve CAPTCHA via 2Captcha.");
      return false;
    }

    // 5. Set Cookie in Browser
    const cookieObject = formatDataDomeCookie(dataDomeCookieString, url);
    if (!cookieObject) {
      logError("[DataDome] Failed to parse the solved datadome cookie string.");
      return false;
    }
    try {
      logInfo("[DataDome] Setting solved CAPTCHA cookie...");
      await page.setCookie(cookieObject);
      logInfo("[DataDome] Cookie set successfully.");
    } catch (error) {
      logError("[DataDome] Failed to set cookie in Puppeteer:", error);
      // This could happen if the domain/path is wrong in the cookie object
      return false;
    }

    // 6. Reload page with the cookie (uses proxy via launch args + page.authenticate)
    logInfo("[DataDome] Reloading page with the CAPTCHA cookie...");
    try {
      await page.reload({ waitUntil: "networkidle0", timeout: 60000 }); // Increased timeout
      logInfo("[DataDome] Page reloaded successfully after setting cookie.");
    } catch (reloadError) {
      logError(
        "[DataDome] Error reloading page after setting cookie:",
        reloadError,
      );
      // Check specific errors like auth failure again
      if (
        reloadError.message &&
        reloadError.message.includes("net::ERR_PROXY_AUTHENTICATION_REQUIRED")
      ) {
        logError(
          "[DataDome] CRITICAL: Proxy authentication failed during reload. Check credentials.",
        );
      } else if (reloadError.name === "TimeoutError") {
        logError(
          "[DataDome] CRITICAL: Timeout during reload. Proxy/Site issue.",
        );
      }
      return false; // Failed to reload
    }

    // 7. Final check after reload
    const reloadedTitle = (await page.title())?.toLowerCase() || "";
    const reloadedBodyText = await page.evaluate(
      () => document.body?.innerText?.toLowerCase() || "",
    );
    const blockedIndicatorsAfterReload = [
      "blocked",
      "enable javascript",
      "checking your browser",
      "access denied",
      "verify you are human",
    ];

    if (
      blockedIndicatorsAfterReload.some(
        (indicator) =>
          reloadedTitle.includes(indicator) ||
          reloadedBodyText.includes(indicator),
      )
    ) {
      logError(
        "[DataDome] Page still shows blocked title/content after reload with cookie.",
      );
      return false;
    }

    logInfo("[DataDome] CAPTCHA handled successfully.");
    return true; // CAPTCHA handled successfully
  } catch (error) {
    logError(
      `[DataDome] Error during CAPTCHA handling process for ${url}:`,
      error,
    );
    // Check for direct proxy connection errors during the initial goto
    if (
      error.message &&
      (error.message.includes("net::ERR_PROXY_CONNECTION_FAILED") ||
        error.message.includes("net::ERR_TUNNEL_CONNECTION_FAILED"))
    ) {
      logError(
        "[DataDome] CRITICAL: Proxy connection failed during initial navigation. Check MY_HTTP_PROXY details (address, port) and ensure the proxy server is reachable.",
      );
    } else if (
      error.message &&
      error.message.includes("net::ERR_PROXY_AUTHENTICATION_REQUIRED")
    ) {
      logError(
        "[DataDome] CRITICAL: Proxy authentication failed during initial navigation. Check username/password in MY_HTTP_PROXY.",
      );
    } else if (error.name === "TimeoutError") {
      logError(
        "[DataDome] CRITICAL: Timeout during DataDome handling (initial navigation or iframe wait). Proxy might be too slow or target site unresponsive.",
      );
    } else if (error.message) {
      logError(
        `[DataDome] Navigation/Page interaction error detail: ${error.message}`,
      );
    }
    return false;
  }
};

/**
 * Navigates the page, handles proxy authentication, potential DataDome, and performs initial interactions.
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @param {string} url - The URL to navigate to.
 * @param {boolean} debug - Debug flag.
 * @returns {Promise<boolean>} - True if navigation and preparation was successful, false otherwise.
 */
const navigateAndPreparePage = async (page, url, debug = false) => {
  logDebug("[NAVIGATE] Setting Viewport and User-Agent...");
  // Use a realistic, common user agent
  const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"; // Example: Use a recent Chrome UA
  await page.setViewport({ width: 1366, height: 768 }); // Common desktop resolution
  await page.setUserAgent(userAgent);

  // Set common headers to mimic a real browser
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7", // Updated Accept header
    "Sec-Ch-Ua":
      '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"', // Example Sec-CH-UA
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"', // Example Platform
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  });

  // --- *** Handle Proxy Authentication BEFORE any navigation *** ---
  const browserContext = page.browserContext();
  if (browserContext.proxyCredentials) {
    logDebug(
      "[NAVIGATE] Proxy credentials found, setting up authentication handler...",
    );
    try {
      await page.authenticate(browserContext.proxyCredentials);
      logDebug("[NAVIGATE] Authentication handler set successfully.");
    } catch (authError) {
      logError("[NAVIGATE] Failed to set page authentication:", authError);
      // This usually shouldn't fail unless credentials format is wrong, but log it.
      return false; // Cannot proceed without auth setup if credentials exist
    }
  } else {
    logDebug(
      "[NAVIGATE] No proxy credentials found, proceeding without authentication handler.",
    );
  }
  // --- *** End Proxy Authentication *** ---

  // --- Handle DataDome (will use authenticated proxy if set) ---
  // Pass the userAgent we set earlier
  const captchaHandled = await handleDataDomeIfNeeded(
    page,
    url,
    userAgent,
    debug,
  );
  if (!captchaHandled) {
    logError(
      `[NAVIGATE] Failed to handle DataDome CAPTCHA for ${url}. Aborting navigation prep.`,
    );
    return false;
  }
  // At this point, if DataDome was required, the page should be loaded correctly (or reloaded).

  // --- Final Navigation/Verification ---
  // Check if we are already on the correct URL after potential DataDome handling/reload.
  const currentUrl = page.url();
  logDebug(`[NAVIGATE] Current URL after potential DataDome: ${currentUrl}`);

  // Only navigate explicitly if we are not on the target URL
  // (e.g., DataDome wasn't needed, or the reload landed somewhere else unexpectedly)
  if (!currentUrl || !currentUrl.startsWith(url.split("?")[0])) {
    // Check base URL match
    logDebug(
      `[NAVIGATE] Current URL (${currentUrl}) doesn't match target (${url}). Explicitly navigating...`,
    );
    try {
      await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
      logDebug(`[NAVIGATE] Explicit navigation to ${url} successful.`);
    } catch (navError) {
      logError(
        `[NAVIGATE] Error during explicit page.goto for ${url}:`,
        navError,
      );
      // Check for specific proxy/network errors
      if (navError.message) {
        if (
          navError.message.includes("net::ERR_PROXY_CONNECTION_FAILED") ||
          navError.message.includes("net::ERR_TUNNEL_CONNECTION_FAILED")
        ) {
          logError(
            "[NAVIGATE] CRITICAL: Proxy connection failed during explicit goto. Check proxy server availability/address/port.",
          );
        } else if (
          navError.message.includes("net::ERR_PROXY_AUTHENTICATION_REQUIRED")
        ) {
          logError(
            "[NAVIGATE] CRITICAL: Proxy authentication failed during explicit goto. Check username/password in MY_HTTP_PROXY.",
          );
        } else if (navError.message.includes("net::ERR_NAME_NOT_RESOLVED")) {
          logError(
            `[NAVIGATE] CRITICAL: DNS resolution failed for ${url}. Check network/DNS settings or URL validity.`,
          );
        } else if (
          navError.message.includes("net::ERR_EMPTY_RESPONSE") ||
          navError.message.includes("net::ERR_CONNECTION_CLOSED")
        ) {
          logError(
            `[NAVIGATE] CRITICAL: Server closed connection unexpectedly for ${url}. Target site issue?`,
          );
        } else if (navError.name === "TimeoutError") {
          logError(
            "[NAVIGATE] CRITICAL: Timeout during explicit navigation. Proxy or target site too slow.",
          );
        } else if (navError.message.includes("net::ERR_NO_SUPPORTED_PROXIES")) {
          // This error should NOT happen now, but check just in case
          logError(
            "[NAVIGATE] UNEXPECTED: Received ERR_NO_SUPPORTED_PROXIES. Proxy configuration issue still exists?",
          );
        }
      }
      return false; // Navigation failed
    }
  } else {
    logDebug(
      `[NAVIGATE] Already on target URL ${currentUrl} (or handled by DataDome/reload). Skipping redundant goto.`,
    );
    // Wait a bit to ensure scripts finish after potential reload
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // --- Simulate Interaction (Optional but recommended) ---
  logDebug(`[NAVIGATE] Simulating minor interaction...`);
  try {
    await page.mouse.move(Math.random() * 500 + 100, Math.random() * 500 + 100);
    await page.evaluate(() => window.scrollBy(0, Math.random() * 300 + 100));
    await new Promise((resolve) =>
      setTimeout(resolve, 1000 + Math.random() * 1000),
    ); // Variable short wait
    await page.evaluate(() => window.scrollBy(0, Math.random() * 400 + 200));
    await new Promise((resolve) => setTimeout(resolve, 500));
  } catch (interactionError) {
    // Check if error is due to navigation interrupting interaction (less likely now but possible)
    if (
      !interactionError.message.includes("Navigation interrupted") &&
      !interactionError.message.includes("Target closed")
    ) {
      logWarn(
        "[NAVIGATE] Warning during post-load interaction:",
        interactionError.message,
      );
    } else {
      logDebug(
        "[NAVIGATE] Post-load interaction interrupted, likely harmless.",
      );
    }
  }

  const finalWaitDelay = 1500; // Reduced final static wait
  logDebug(`[DELAY] Final short wait ${finalWaitDelay / 1000} seconds...`);
  await new Promise((resolve) => setTimeout(resolve, finalWaitDelay));

  logInfo(`[NAVIGATE] Page preparation complete for: ${page.url()}`);
  return true; // Preparation successful
};

// --- getHtmlContent, extractArticleSnippets, queryXPathWithDetails, scoreElement ---
// --- getLlmCandidateXPaths, saveHtmlOnFailure ---
// --- These functions remain largely the same, minor logging/error handling adjustments possible ---

const getHtmlContent = async (page) => {
  logDebug("[Puppeteer] Getting full page HTML...");
  try {
    if (page.isClosed()) {
      logWarn("[Puppeteer] Attempted to get HTML from a closed page.");
      return null;
    }
    const html = await page.content();
    logDebug("[Puppeteer] Full HTML fetched.");
    return html;
  } catch (error) {
    // Check if page closed during content() call
    if (
      error.message.includes("Target closed") ||
      error.message.includes("Session closed")
    ) {
      logWarn(
        "[Puppeteer] Page closed before HTML could be retrieved:",
        error.message,
      );
    } else {
      logError("[Puppeteer] Error getting full HTML:", error.message);
    }
    return null;
  }
};

const extractArticleSnippets = async (
  page,
  numSnippets = 5,
  minLength = 50,
) => {
  logDebug("[Puppeteer] Extracting text snippets...");
  const selector = "p, h2, h3, li, blockquote"; // Keep existing selector
  try {
    if (page.isClosed()) {
      logWarn("[Puppeteer] Attempted to extract snippets from a closed page.");
      return [];
    }
    const snippets = await page.$$eval(
      selector,
      (elements, minLen, maxSnippets) => {
        const results = [];
        const MIN_CHARS_AROUND_WORD = 10; // Ensure snippets have some context

        const isVisible = (el) => {
          if (!el.offsetParent && el.tagName !== "BODY") return false; // Basic visibility check
          const style = window.getComputedStyle(el);
          return (
            style &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
          );
        };

        for (const el of elements) {
          // Skip elements likely hidden or irrelevant
          if (
            el.tagName === "SCRIPT" ||
            el.tagName === "STYLE" ||
            el.tagName === "NOSCRIPT"
          )
            continue;
          if (!isVisible(el)) continue; // Check computed style visibility

          const text = el.textContent?.trim().replace(/\s+/g, " "); // Normalize whitespace

          // Basic check for meaningful content (at least one word with surrounding chars)
          if (
            text &&
            text.length >= minLen &&
            text.match(/[a-zA-Z]{3,}/) &&
            text.length > MIN_CHARS_AROUND_WORD
          ) {
            let snippet = text.substring(0, 250); // Keep truncation
            if (text.length > 250) snippet += "...";

            // Avoid adding duplicate snippets
            if (!results.some((r) => r.includes(snippet.substring(0, 50)))) {
              // Check start of snippet for similarity
              results.push(snippet);
            }

            if (results.length >= maxSnippets) break;
          }
        }
        return results;
      },
      minLength,
      numSnippets,
    );
    logDebug(`[Puppeteer] Extracted ${snippets.length} valid snippets.`);
    return snippets;
  } catch (error) {
    if (
      error.message.includes("Target closed") ||
      error.message.includes("Session closed")
    ) {
      logWarn(
        "[Puppeteer] Page closed during snippet extraction:",
        error.message,
      );
    } else {
      logError(`[Puppeteer] Error extracting text snippets: ${error.message}`);
    }
    return [];
  }
};

const queryXPathWithDetails = async (page, xpath, tagsToCount) => {
  logDebug(`[Puppeteer] Querying XPath: ${xpath}`);
  try {
    if (page.isClosed()) {
      logWarn(
        `[Puppeteer] Attempted to query XPath "${xpath}" on a closed page.`,
      );
      return { count: 0, firstElementDetails: null };
    }
    const result = await page.evaluate(
      (xpathSelector, tagsToCountArr) => {
        try {
          const evaluateResult = document.evaluate(
            xpathSelector,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null,
          );
          const count = evaluateResult.snapshotLength;
          let firstElementDetails = null;

          if (count > 0) {
            const firstNode = evaluateResult.snapshotItem(0);
            // Ensure it's an Element node before trying to access properties
            if (firstNode && firstNode.nodeType === Node.ELEMENT_NODE) {
              const el = firstNode;
              const descendantCounts = {};
              tagsToCountArr.forEach((tag) => {
                descendantCounts[tag] = el.querySelectorAll(tag).length;
              });
              const totalDescendantElements = el.querySelectorAll("*").length;
              const textContentSample =
                el.textContent?.trim().replace(/\s+/g, " ").substring(0, 500) ||
                ""; // Normalized text sample
              const innerHTMLSample =
                el.innerHTML?.trim().substring(0, 1000) || ""; // Trimmed HTML sample

              firstElementDetails = {
                tagName: el.tagName.toUpperCase(),
                id: el.id || null, // Use null if empty
                className: el.className || null, // Use null if empty
                descendantCounts: descendantCounts,
                textContentSample: textContentSample,
                innerHTMLSample: innerHTMLSample,
                totalDescendantElements: totalDescendantElements,
              };
            } else if (firstNode) {
              // Log if the first result isn't an element (e.g., text node, comment)
              console.warn(
                `[Puppeteer Eval] XPath "${xpathSelector}" first result is Node Type ${firstNode.nodeType}, not an Element.`,
              );
            }
          }
          return { count, firstElementDetails };
        } catch (evalError) {
          // Catch errors within the evaluate function (e.g., invalid XPath syntax)
          console.error(
            `[Puppeteer Eval] XPath evaluation error for "${xpathSelector}": ${evalError.message}`,
          );
          return {
            count: -1, // Indicate error
            firstElementDetails: null,
            error: evalError.message, // Pass error message back
          };
        }
      },
      xpath,
      tagsToCount,
    );

    // Handle errors reported from page.evaluate
    if (result.error) {
      logWarn(
        `[Puppeteer] Error evaluating XPath "${xpath}" in browser context: ${result.error}`,
      );
      return { count: 0, firstElementDetails: null }; // Treat as 0 found on error
    }

    logDebug(
      `[Puppeteer] XPath query "${xpath}" found ${result.count} elements.`,
    );
    if (result.count > 0 && result.firstElementDetails) {
      logDebug(
        `[Puppeteer] Details obtained for first element (Tag: ${result.firstElementDetails.tagName}, P: ${result.firstElementDetails.descendantCounts?.p ?? 0}).`,
      );
    } else if (result.count > 0 && !result.firstElementDetails) {
      logDebug(
        // Changed from Warn to Debug as it might be expected sometimes
        `[Puppeteer] XPath "${xpath}" found elements, but first result was not an Element node or details failed.`,
      );
    }
    return result; // Return count and details (or null details)
  } catch (error) {
    if (
      error.message.includes("Target closed") ||
      error.message.includes("Session closed")
    ) {
      logWarn(
        `[Puppeteer] Page closed during XPath query for "${xpath}":`,
        error.message,
      );
    } else {
      logError(
        `[Puppeteer] Critical error querying XPath ${xpath}: ${error.message}`,
      );
    }
    return { count: 0, firstElementDetails: null }; // Return 0 on critical errors
  }
};

const scoreElement = (elementDetails, totalElementsFoundByXPath, xpath) => {
  const scoreLog = (...args) => {
    if (ENABLE_DEBUG_LOGGING) console.log("[SCORE]", ...args);
  };

  if (
    !elementDetails ||
    !elementDetails.descendantCounts ||
    typeof elementDetails.totalDescendantElements !== "number"
  ) {
    scoreLog(
      `Incomplete or missing element details for scoring ${xpath}. Score: 0`,
    );
    return 0;
  }

  let score = 0;
  const {
    tagName,
    id,
    className,
    descendantCounts,
    textContentSample, // Use the sample from queryXPathWithDetails
    innerHTMLSample, // Use the sample from queryXPathWithDetails
    totalDescendantElements,
  } = elementDetails;

  const pCount = descendantCounts["p"] || 0;
  if (pCount < MIN_PARAGRAPH_THRESHOLD) {
    scoreLog(
      `${xpath} failed min paragraph threshold (${pCount} < ${MIN_PARAGRAPH_THRESHOLD}). Score: 0`,
    );
    return 0; // Hard fail if not enough paragraphs
  }

  // Base score from paragraphs
  score += pCount * SCORE_WEIGHTS.paragraphCount;
  scoreLog(
    `${xpath} - Paragraphs (${pCount}): +${(pCount * SCORE_WEIGHTS.paragraphCount).toFixed(2)}`,
  );

  // Penalty for unwanted structural tags (nav, footer etc.) relative to total elements
  const unwantedCount = UNWANTED_TAGS.reduce(
    (sum, tag) => sum + (descendantCounts[tag] || 0),
    0,
  );
  if (totalDescendantElements > 5 && unwantedCount > 0) {
    // Avoid division by zero or tiny denominators
    const unwantedRatio = unwantedCount / totalDescendantElements;
    // Apply penalty more gently if ratio is very low
    const penaltyFactor = Math.min(1, unwantedRatio * 5); // Scale penalty up to a max factor of 1
    const penalty = penaltyFactor * SCORE_WEIGHTS.unwantedPenaltyRatio;
    score += penalty;
    scoreLog(
      `${xpath} - Unwanted ratio (${unwantedRatio.toFixed(3)}, factor ${penaltyFactor.toFixed(2)}): ${penalty.toFixed(2)}`,
    );
  } else if (unwantedCount > 1) {
    // Add small penalty if multiple unwanted exist even with few total elements
    score += SCORE_WEIGHTS.unwantedPenaltyRatio * 0.2; // Smaller fixed penalty
    scoreLog(
      `${xpath} - Unwanted tags (${unwantedCount}, low total elements): ${(SCORE_WEIGHTS.unwantedPenaltyRatio * 0.2).toFixed(2)}`,
    );
  }

  // Bonus for semantic tags
  if (tagName === "ARTICLE" || tagName === "MAIN") {
    score += SCORE_WEIGHTS.isSemanticTag;
    scoreLog(
      `${xpath} - Semantic tag (${tagName}): +${SCORE_WEIGHTS.isSemanticTag}`,
    );
  } else if (tagName === "SECTION" || tagName === "DIV") {
    // Smaller bonus/penalty based on attributes for common containers
    const descriptiveRegex =
      /article|content|body|story|main|post|entry|text|copy|primary|container/i; // Added container
    if (
      (id && descriptiveRegex.test(id)) ||
      (className && descriptiveRegex.test(className))
    ) {
      score += SCORE_WEIGHTS.hasDescriptiveIdOrClass; // Full bonus for descriptive div/section
      scoreLog(
        `${xpath} - Descriptive ID/Class on ${tagName}: +${SCORE_WEIGHTS.hasDescriptiveIdOrClass}`,
      );
    } else if (tagName === "DIV") {
      score -= 5; // Small penalty for generic div without description
      scoreLog(`${xpath} - Generic DIV penalty: -5`);
    }
  }

  // Text Density Calculation (using samples)
  if (innerHTMLSample && innerHTMLSample.length > 50) {
    // Need enough HTML to be meaningful
    const plainTextLength = textContentSample ? textContentSample.length : 0;
    const htmlLength = innerHTMLSample.length;

    if (htmlLength > 0) {
      const textDensity = plainTextLength / htmlLength;
      // Apply bonus more strongly for higher densities
      const densityBonus =
        Math.pow(textDensity, 0.5) * SCORE_WEIGHTS.textDensity; // Use sqrt for non-linear bonus
      score += densityBonus;
      scoreLog(
        `${xpath} - Text Density (${textDensity.toFixed(3)}): +${densityBonus.toFixed(2)}`,
      );

      // Penalize extremely low text density (lots of tags, little text)
      if (textDensity < 0.1 && plainTextLength > 100) {
        score -= 15;
        scoreLog(`${xpath} - Low Text Density penalty: -15`);
      }
    }
  } else if (textContentSample && textContentSample.length > 100) {
    // If no innerHTML sample but decent text, give a small bonus
    score += 10;
    scoreLog(`${xpath} - Text content present bonus: +10`);
  }

  // Link Density Penalty
  const linkCount = descendantCounts["a"] || 0;
  if (totalDescendantElements > 5 && linkCount > 1) {
    // Avoid penalty for very few links/elements
    const linkDensity = linkCount / totalDescendantElements;
    // Apply penalty more strongly if density is high
    const linkPenaltyFactor = Math.min(1, linkDensity * 10); // Scale penalty up to factor 1 for density >= 0.1
    const linkPenalty = linkPenaltyFactor * SCORE_WEIGHTS.linkDensityPenalty;
    score += linkPenalty;
    scoreLog(
      `${xpath} - Link Density (${linkDensity.toFixed(3)}, factor ${linkPenaltyFactor.toFixed(2)}): ${linkPenalty.toFixed(2)}`,
    );
    // Heavy penalty if it looks like *mostly* links (e.g., navigation menu)
    if (linkDensity > 0.5 && linkCount > 5) {
      score -= 50;
      scoreLog(`${xpath} - High Link Density penalty: -50`);
    }
  }

  // Media Presence Bonus
  const mediaCount =
    (descendantCounts["img"] || 0) +
    (descendantCounts["video"] || 0) +
    (descendantCounts["audio"] || 0) +
    (descendantCounts["picture"] || 0);
  if (mediaCount > 0 && pCount > 0) {
    // Only give bonus if text is also present
    const mediaBonus = Math.min(SCORE_WEIGHTS.mediaPresence, mediaCount * 5); // Cap bonus based on count
    score += mediaBonus;
    scoreLog(
      `${xpath} - Media Presence (${mediaCount}): +${mediaBonus.toFixed(2)}`,
    );
  }

  // XPath Complexity Penalty
  const xpathDepth = xpath.split("/").length - 1;
  const xpathPredicates = (xpath.match(/\[.*?\]/g) || []).length;
  const xpathComplexity = xpathDepth + xpathPredicates * 2; // Weight predicates more
  const complexityPenalty = Math.min(
    20,
    xpathComplexity * Math.abs(SCORE_WEIGHTS.xpathComplexityPenalty),
  ); // Cap penalty
  score -= complexityPenalty;
  scoreLog(
    `${xpath} - XPath Complexity (${xpathComplexity}): -${complexityPenalty.toFixed(2)}`,
  );

  // Single Element Bonus
  const isSingleElement = totalElementsFoundByXPath === 1;
  if (isSingleElement) {
    score += SCORE_WEIGHTS.isSingleElement;
    scoreLog(
      `${xpath} - Single element bonus: +${SCORE_WEIGHTS.isSingleElement}`,
    );
  } else if (totalElementsFoundByXPath > 1) {
    // Apply penalty if XPath is not specific enough
    const multiplePenalty = Math.min(30, (totalElementsFoundByXPath - 1) * 5); // Capped penalty
    score -= multiplePenalty;
    scoreLog(
      `${xpath} - Found ${totalElementsFoundByXPath} elements (penalty): -${multiplePenalty.toFixed(2)}`,
    );
  }

  // Final score adjustment: ensure positive score if basic criteria met
  scoreLog(`${xpath} - Pre-floor Score: ${score.toFixed(2)}`);
  return Math.max(0, score); // Ensure score is not negative
};

const getLlmCandidateXPaths = async (
  htmlContent,
  anchorSnippets,
  feedback = [],
) => {
  logInfo("[LLM API] Requesting candidate XPaths from OpenRouter...");
  const MAX_HTML_LENGTH = 120000; // Slightly increased length
  const truncatedHtml =
    htmlContent.length > MAX_HTML_LENGTH
      ? htmlContent.substring(0, MAX_HTML_LENGTH) + "\n... (HTML truncated)"
      : htmlContent;

  // System Prompt: Define the persona and task clearly
  const systemPrompt = `You are an expert AI assistant specialized in analyzing HTML document structure to identify the primary content container. Your goal is to find the most precise and robust XPath selector that targets the main article body, blog post text, or central content block. You must exclude common non-content elements like headers, footers, navigation menus, sidebars, related links sections, comment forms, and advertisement blocks. Prioritize semantic tags (<article>, <main>) and elements with descriptive IDs or classes (e.g., "content", "article-body", "main-story", "post-content", "primary"). Aim for specificity to ensure the XPath uniquely identifies the target container. You MUST respond ONLY with a JSON array of strings, where each string is a valid XPath selector. Do not include any explanations, introductions, or markdown formatting outside the JSON array itself.`;

  // User Prompt Construction
  let userPrompt = `Analyze the provided HTML source code. Identify 3 to 5 candidate XPath selectors for the main content container based on the criteria outlined in the system prompt.`;

  if (anchorSnippets && anchorSnippets.length > 0) {
    userPrompt += `\n\nConsider these text snippets extracted from the page as strong indicators of the desired content area:\n${JSON.stringify(anchorSnippets)}`;
  } else {
    userPrompt += `\n\nNo specific text snippets are available. Rely primarily on HTML structure, semantic tags, and descriptive attributes (IDs/classes).`;
  }

  if (feedback && feedback.length > 0) {
    userPrompt += `\n\nReview the feedback from previous attempts (higher score indicates better fit, score 0 means unsuitable):\n`;
    feedback.forEach((item) => {
      // Sanitize and shorten feedback result for clarity
      const cleanResult = item.result.replace(/"/g, "'").substring(0, 150);
      userPrompt += `- "${item.xpath}": ${cleanResult}\n`;
    });
    userPrompt += `\nBased on this feedback, generate *new and distinct* XPath candidates. Avoid repeating selectors that scored 0 or poorly. Focus on improving specificity, perhaps by using deeper paths, different attributes (like data-* attributes if relevant), or combining multiple conditions (e.g., //div[@class='content' and not(contains(@class,'sidebar'))]). Do not suggest overly generic selectors like "//div" or "//p".`;
  } else {
    userPrompt += `\n\nGenerate your initial list of the most promising XPath candidates.`;
  }

  userPrompt += `\n\nRespond ONLY with the JSON array of XPath strings. Example format: ["//article[@id='main-content']", "//div[contains(@class, 'post-body')]", "//main/div[@class='primary-content']"]`;
  userPrompt += "\n\nHTML Source (potentially truncated):\n" + truncatedHtml;

  try {
    logDebug("[LLM API] Sending request to OpenRouter...");
    logDebug(`[LLM API] Model: ${LLM_MODEL}`);
    // If feedback is present, log it (partially) for debugging
    if (ENABLE_DEBUG_LOGGING && feedback.length > 0) {
      logDebug(
        "[LLM API] Sending feedback to LLM:",
        JSON.stringify(feedback.slice(0, 3), null, 1),
      ); // Log first few feedback items
    }

    const response = await axios.post(
      LLM_CHAT_COMPLETIONS_ENDPOINT,
      {
        model: LLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" }, // Request JSON explicitly if model supports it
        temperature: 0.3, // Lower temperature for more deterministic XPath generation
        max_tokens: 500, // Limit token usage for the response
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "X-Title": "smartScraper", // Keep custom headers if useful
          "HTTP-Referer": "https://github.com/bogorad/smartScraper",
        },
        timeout: 75000, // Increased timeout for potentially complex analysis
      },
    );

    if (
      !response.data ||
      !response.data.choices ||
      response.data.choices.length === 0
    ) {
      logWarn("[LLM API] LLM response missing choices or invalid structure.");
      logDebug("[LLM API] Response data:", response.data);
      return [];
    }

    const llmResponseContent = response.data.choices[0].message?.content;
    if (!llmResponseContent) {
      logWarn("[LLM API] LLM response content is empty.");
      return [];
    }
    logDebug("[LLM API] Raw LLM response content:", llmResponseContent);

    let parsedCandidates = null;
    try {
      // Attempt to parse directly, assuming model respected json_object format
      parsedCandidates = JSON.parse(llmResponseContent);

      // Check if the parsed result is directly the array (ideal)
      // or if it's nested within a common key like "xpaths" or "selectors"
      if (Array.isArray(parsedCandidates)) {
        // It's already the array
        logDebug("[LLM API] Parsed response directly as array.");
      } else if (
        typeof parsedCandidates === "object" &&
        parsedCandidates !== null
      ) {
        // Look for a key containing an array of strings
        const keyWithArray = Object.keys(parsedCandidates).find(
          (key) =>
            Array.isArray(parsedCandidates[key]) &&
            parsedCandidates[key].every((item) => typeof item === "string"),
        );
        if (keyWithArray) {
          logDebug(`[LLM API] Found XPath array under key: "${keyWithArray}"`);
          parsedCandidates = parsedCandidates[keyWithArray];
        } else {
          logWarn(
            "[LLM API] Parsed JSON object, but couldn't find expected array key.",
          );
          parsedCandidates = null; // Reset if format is wrong
        }
      } else {
        logWarn(
          "[LLM API] Parsed response is not an array or expected object structure.",
        );
        parsedCandidates = null; // Reset if format is wrong
      }
    } catch (parseError) {
      logWarn(
        `[LLM API] Failed to parse direct JSON response: ${parseError.message}. Trying regex fallback...`,
      );
      // Fallback: Try extracting JSON from markdown code block or between brackets
      let contentToParse = llmResponseContent.trim();
      const jsonCodeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
      const match = contentToParse.match(jsonCodeBlockRegex);

      if (match && match[1]) {
        logDebug("[LLM API] Regex: Detected JSON in markdown code block.");
        contentToParse = match[1].trim();
      } else {
        const firstBracket = contentToParse.indexOf("[");
        const lastBracket = contentToParse.lastIndexOf("]");
        if (firstBracket !== -1 && lastBracket > firstBracket) {
          logDebug(
            "[LLM API] Regex: Extracting content between first [ and last ].",
          );
          contentToParse = contentToParse.substring(
            firstBracket,
            lastBracket + 1,
          );
        } else {
          logWarn(
            "[LLM API] Regex: Could not reliably find JSON array structure in response.",
          );
          contentToParse = null; // Indicate failure
        }
      }

      if (contentToParse) {
        try {
          parsedCandidates = JSON.parse(contentToParse);
        } catch (fallbackParseError) {
          logError(
            `[LLM API] Failed to parse JSON even with regex fallback: ${fallbackParseError.message}`,
          );
          logError(
            "[LLM API] Content that failed fallback parsing:",
            contentToParse,
          );
          return []; // Give up if both fail
        }
      } else {
        return []; // Give up if regex didn't find anything
      }
    }

    // Validate the final parsed candidates
    if (
      Array.isArray(parsedCandidates) &&
      parsedCandidates.every((item) => typeof item === "string")
    ) {
      const validLookingXPaths = parsedCandidates.filter(
        (xpath) =>
          xpath &&
          xpath.trim().length > 2 && // Basic length check
          (xpath.trim().startsWith("/") || xpath.trim().startsWith(".")), // Basic structural check
      );
      if (validLookingXPaths.length !== parsedCandidates.length) {
        logWarn(
          `[LLM API] Filtered out ${parsedCandidates.length - validLookingXPaths.length} invalid/empty XPath strings from LLM response.`,
        );
      }
      logInfo(
        `[LLM API] Successfully parsed ${validLookingXPaths.length} candidate XPaths.`,
      );
      return validLookingXPaths;
    } else {
      logError(
        "[LLM API] Parsed content, after potential extraction, is not a valid JSON array of strings:",
        parsedCandidates, // Log what was parsed
      );
      return [];
    }
  } catch (error) {
    logError(`[LLM API] Error calling OpenRouter API: ${error.message}`);
    if (error.response) {
      logError("[LLM API] Response Status:", error.response.status);
      logError("[LLM API] Response Headers:", error.response.headers);
      logError(
        "[LLM API] Response Data:",
        JSON.stringify(error.response.data, null, 2),
      );
      // Provide more specific advice based on status codes
      if (error.response.status === 401) {
        logError(
          "[LLM API] Authentication Error (401): Check your OPENROUTER_API_KEY.",
        );
      } else if (error.response.status === 402) {
        logError(
          "[LLM API] Payment Required (402): Check your OpenRouter account balance/limits.",
        );
      } else if (error.response.status === 429) {
        logError(
          "[LLM API] Rate Limit Exceeded (429): Slow down requests or check OpenRouter limits.",
        );
      } else if (error.response.status >= 500) {
        logError(
          "[LLM API] Server Error (5xx): OpenRouter might be having temporary issues. Retry later.",
        );
      }
    } else if (error.request) {
      logError(
        "[LLM API] No response received from OpenRouter. Check network connectivity and API endpoint.",
      );
    } else {
      logError("[LLM API] Error setting up the request:", error.message);
    }
    return []; // Return empty on error
  }
};

const saveHtmlOnFailure = async (url, htmlContent) => {
  if (!SAVE_HTML_ON_FAILURE) return;
  if (
    !htmlContent ||
    typeof htmlContent !== "string" ||
    htmlContent.trim().length === 0
  ) {
    logWarn("[Save HTML] No valid HTML content provided to save.");
    return;
  }
  try {
    // Ensure the directory exists
    await fs.promises.mkdir(FAILED_HTML_DIR, { recursive: true });

    // Create a somewhat unique filename
    const urlHash = crypto
      .createHash("md5")
      .update(url)
      .digest("hex")
      .substring(0, 8);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeDomain =
      getDomainFromUrl(url)?.replace(/[^a-z0-9\-.]/gi, "_") || "unknown_domain"; // Allow hyphens and dots
    const filename = `failed_${safeDomain}_${timestamp}_${urlHash}.html`;
    const filePath = path.join(FAILED_HTML_DIR, filename);

    await fs.promises.writeFile(filePath, htmlContent, "utf8");
    logInfo(
      `[Save HTML] Successfully saved failed HTML for ${url} to ${filePath}`,
    );
  } catch (error) {
    logError(`[Save HTML] Failed to save HTML for ${url}: ${error.message}`);
  }
};

/**
 * Attempts to find the best XPath and extract its content using the LLM approach.
 * Uses the direct HTTP proxy and handles authentication.
 * @param {string} url - The URL of the page.
 * @param {boolean} debug - Enable debug logging.
 * @returns {Promise<{foundXPath: string, extractedHtml: string} | null>} - The best XPath and its HTML content, or null if failed.
 */
const findArticleXPathAndExtract = async (url, debug = false) => {
  logInfo(`--- Starting XPath discovery and extraction for: ${url} ---`);
  let browser = null;
  let userDataDir = null;
  let page = null;
  let htmlContent = null; // Store HTML fetched after successful navigation
  let bestCandidateXPath = null;
  let extractedHtml = null;

  try {
    // Launch browser (handles proxy setup internally)
    const launchResult = await launchPuppeteerBrowser(debug);
    browser = launchResult.browser;
    userDataDir = launchResult.userDataDir;
    page = await browser.newPage(); // Create page *after* browser is launched

    // Navigate and prepare (handles auth, CAPTCHA, interaction)
    const navigationSuccessful = await navigateAndPreparePage(page, url, debug);
    if (!navigationSuccessful) {
      // navigateAndPreparePage should log the specific reason for failure
      logError(
        "[Discovery] Page navigation or preparation failed. Cannot proceed with discovery.",
      );
      // Attempt to get content anyway for saving, but expect it might fail
      try {
        htmlContent = await getHtmlContent(page);
      } catch {}
      await saveHtmlOnFailure(url, htmlContent); // Save what we have, if anything
      await cleanupPuppeteer(page, browser, userDataDir, debug); // Ensure cleanup
      return null; // Return null as discovery couldn't start properly
    }

    // Get HTML *after* successful navigation and preparation
    htmlContent = await getHtmlContent(page);
    if (!htmlContent) {
      logWarn(
        "[Discovery] Failed to get HTML content after successful navigation. Trying again...",
      );
      await new Promise((resolve) => setTimeout(resolve, 1500)); // Short wait
      htmlContent = await getHtmlContent(page);
      if (!htmlContent) {
        logError(
          "[Discovery] Still failed to get HTML content. Aborting discovery.",
        );
        await cleanupPuppeteer(page, browser, userDataDir, debug);
        return null;
      }
    }
    logInfo("[Discovery] Successfully retrieved HTML content for analysis.");

    // Extract snippets for LLM context
    const anchorSnippets = await extractArticleSnippets(page);
    if (anchorSnippets.length === 0) {
      logWarn(
        "[Discovery] Could not extract text snippets for LLM context. Proceeding without them.",
      );
    } else {
      logDebug(
        `[Discovery] Using ${anchorSnippets.length} snippets for LLM context.`,
      );
    }

    let allTriedXPaths = new Set();
    let feedbackForLLM = [];
    let scoredCandidates = []; // Store { xpath, score, elementDetails }

    // LLM Interaction Loop
    for (let retry = 0; retry <= MAX_LLM_RETRIES; retry++) {
      logInfo(
        `--- LLM Interaction Attempt ${retry + 1}/${MAX_LLM_RETRIES + 1} ---`,
      );

      // Get candidates from LLM, providing feedback from previous rounds
      const llmCandidateXPaths = await getLlmCandidateXPaths(
        htmlContent,
        anchorSnippets,
        retry > 0 ? feedbackForLLM : [], // Pass feedback after first attempt
      );

      if (!llmCandidateXPaths || llmCandidateXPaths.length === 0) {
        logWarn(
          `[Discovery] LLM returned no candidates on attempt ${retry + 1}.`,
        );
        if (retry < MAX_LLM_RETRIES) {
          logInfo("[Discovery] Waiting before next LLM attempt...");
          await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait longer if LLM fails
          continue; // Try next retry
        } else {
          logError(
            "[Discovery] LLM failed to provide candidates after all retries.",
          );
          break; // Exit loop if final attempt failed
        }
      }

      // Filter out XPaths already tried in previous rounds
      const newCandidateXPaths = llmCandidateXPaths.filter(
        (xpath) => !allTriedXPaths.has(xpath?.trim()), // Trim whitespace
      );

      if (newCandidateXPaths.length === 0) {
        logWarn(
          `[Discovery] LLM returned only previously tried XPaths on attempt ${retry + 1}.`,
        );
        if (retry < MAX_LLM_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue; // Try next retry if not the last one
        } else {
          break; // Exit loop if only old XPaths returned on last attempt
        }
      }

      logInfo(
        `[Discovery] Validating ${newCandidateXPaths.length} new candidate XPaths from LLM...`,
      );
      feedbackForLLM = []; // Reset feedback for this round
      let currentAttemptBestScore = -1;

      // Validate new candidates in parallel
      const validationPromises = newCandidateXPaths.map(async (xpath) => {
        const trimmedXPath = xpath.trim();
        if (!trimmedXPath) return null; // Skip empty strings

        allTriedXPaths.add(trimmedXPath); // Add to tried set
        const result = await queryXPathWithDetails(
          page,
          trimmedXPath,
          TAGS_TO_COUNT,
        );
        // Return null if query failed badly (count -1)
        return result.count >= 0 ? { xpath: trimmedXPath, ...result } : null;
      });

      const validationResults = (await Promise.all(validationPromises)).filter(
        (r) => r !== null,
      ); // Filter out nulls/errors

      // Score valid results and prepare feedback
      for (const result of validationResults) {
        const { xpath, count, firstElementDetails } = result;

        if (count <= 0 || !firstElementDetails) {
          logDebug(
            `[Validation] XPath "${xpath}" found ${count <= 0 ? "0 or errored" : count} elements or no details. Skipping scoring.`,
          );
          feedbackForLLM.push({
            xpath: xpath,
            result: `Score 0 (Found ${count}, No details)`, // Clear feedback
          });
          continue; // Skip scoring if no elements or details
        }

        // Score the element based on details
        const score = scoreElement(firstElementDetails, count, xpath);

        const feedbackEntry = {
          xpath: xpath,
          result: `Score ${score.toFixed(1)} (Found ${count}, P:${firstElementDetails.descendantCounts?.p ?? "N/A"})`,
        };
        feedbackForLLM.push(feedbackEntry);

        if (score > 0) {
          // Store candidate if it has a positive score
          scoredCandidates.push({
            xpath,
            score,
            elementDetails: firstElementDetails, // Store details for potential later use
          });
          logInfo(
            `[Validation] XPath "${xpath}" scored: ${score.toFixed(2)} (Found ${count})`,
          );
          currentAttemptBestScore = Math.max(currentAttemptBestScore, score);
        } else {
          logDebug(
            `[Validation] XPath "${xpath}" scored 0 (Found ${count}). Discarding.`,
          );
          // Feedback already added above
        }
      } // End loop through validation results

      logInfo(
        `[Discovery] Attempt ${retry + 1} finished. Best score this attempt: ${currentAttemptBestScore > -1 ? currentAttemptBestScore.toFixed(2) : "N/A"}. Total valid candidates so far: ${scoredCandidates.length}`,
      );

      // Optional: Add a small delay between LLM retries
      if (retry < MAX_LLM_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } // End LLM retry loop

    // --- Selection and Final Extraction ---
    if (scoredCandidates.length > 0) {
      // Sort all collected candidates by score (descending)
      scoredCandidates.sort((a, b) => b.score - a.score);
      bestCandidateXPath = scoredCandidates[0].xpath; // Select the highest scoring one

      logInfo(`--- Selected Best Overall XPath ---`);
      logInfo(`XPath: ${bestCandidateXPath}`);
      logInfo(`Score: ${scoredCandidates[0].score.toFixed(2)}`);
      if (ENABLE_DEBUG_LOGGING && scoredCandidates.length > 1) {
        logDebug("Top 3 candidates:");
        scoredCandidates
          .slice(0, 3)
          .forEach((c, i) =>
            logDebug(`${i + 1}. ${c.xpath} (Score: ${c.score.toFixed(2)})`),
          );
      }

      // Final extraction using the chosen XPath
      logInfo(
        `[Extraction] Attempting to extract content using final XPath: ${bestCandidateXPath}`,
      );
      try {
        if (page.isClosed()) {
          throw new Error("Page closed before final extraction.");
        }
        extractedHtml = await page.evaluate((xpath) => {
          try {
            const result = document.evaluate(
              xpath,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE, // Get only the first match
              null,
            );
            const element = result.singleNodeValue;
            // Return innerHTML only if element exists and has content
            return element?.innerHTML?.trim() || null;
          } catch (evalError) {
            console.error(
              `[Puppeteer Eval] Error evaluating XPath "${xpath}" for final extraction: ${evalError.message}`,
            );
            return null; // Return null on evaluation error
          }
        }, bestCandidateXPath); // Pass the best XPath

        if (extractedHtml) {
          logInfo(
            "[Extraction] Successfully extracted HTML content using the discovered XPath.",
          );
        } else {
          // This can happen if the element exists but has no innerHTML, or if the XPath failed this time
          logWarn(
            `[Extraction] Final XPath "${bestCandidateXPath}" returned no content during extraction (element missing, empty, or eval error).`,
          );
          bestCandidateXPath = null; // Invalidate XPath if extraction failed
        }
      } catch (extractError) {
        if (
          extractError.message.includes("Target closed") ||
          extractError.message.includes("Session closed")
        ) {
          logWarn(
            "[Extraction] Page closed during final extraction:",
            extractError.message,
          );
        } else {
          logError(
            `[Extraction] Critical error during final content extraction with XPath "${bestCandidateXPath}":`,
            extractError,
          );
        }
        bestCandidateXPath = null; // Invalidate XPath on critical error
        extractedHtml = null;
      }
    } else {
      logError(
        "[Discovery] No suitable XPath candidates found after all LLM retries and validation.",
      );
      // No XPath found, proceed to failure case
    }

    // --- Return Result or Handle Failure ---
    if (bestCandidateXPath && extractedHtml !== null) {
      // Success case
      await cleanupPuppeteer(page, browser, userDataDir, debug);
      return { foundXPath: bestCandidateXPath, extractedHtml: extractedHtml };
    } else {
      // Failure case (no XPath found, or extraction failed)
      logWarn(
        "[Discovery] Process finished but failed to find a working XPath or extract content.",
      );
      if (htmlContent) {
        // Save the original HTML if discovery failed
        await saveHtmlOnFailure(url, htmlContent);
      } else {
        logWarn(
          "[Discovery] No HTML content was obtained during the process, cannot save on failure.",
        );
      }
      await cleanupPuppeteer(page, browser, userDataDir, debug);
      return null; // Indicate failure
    }
  } catch (error) {
    logError(
      "[Discovery] An unhandled error occurred during the XPath discovery process:",
      error,
    );
    // Check for common critical errors
    if (
      error.message &&
      (error.message.includes("Target closed") ||
        error.message.includes("Session closed"))
    ) {
      logError(
        "[Discovery] Browser or page closed unexpectedly. Potential crash or resource issue.",
      );
    } else if (error.message && error.message.includes("Protocol error")) {
      logError(
        "[Discovery] Protocol error communicating with the browser. Check browser/driver compatibility or resource constraints.",
      );
    }

    // Attempt to save HTML if available, even on unexpected errors
    if (htmlContent) {
      logWarn("[Discovery] Saving full HTML due to unhandled error...");
      await saveHtmlOnFailure(url, htmlContent);
    } else if (page && !page.isClosed()) {
      try {
        htmlContent = await getHtmlContent(page); // Try one last time
        await saveHtmlOnFailure(url, htmlContent);
      } catch {}
    } else {
      logWarn(
        "[Discovery] Process failed early or page closed, no HTML content available to save.",
      );
    }

    await cleanupPuppeteer(page, browser, userDataDir, debug); // Ensure cleanup on error
    return null; // Indicate failure
  }
  // No finally needed as cleanup happens in success/fail paths and catch block
};

/**
 * Fetches content using a known XPath.
 * Uses the direct HTTP proxy and handles authentication.
 * @param {string} url - The URL to fetch.
 * @param {string} xpath - The known XPath to use.
 * @param {boolean} debug - Enable debug logging.
 * @returns {Promise<string|null>} - The extracted HTML content or null if XPath fails or navigation/preparation fails.
 */
const fetchWithKnownXpath = async (url, xpath, debug = false) => {
  logInfo(`--- Fetching content for ${url} using known XPath: ${xpath} ---`);
  let browser = null;
  let userDataDir = null;
  let page = null;
  let extractedHtml = null;
  let htmlContentForSave = null; // To store HTML for saving on failure

  try {
    // Launch browser (handles proxy setup internally)
    const launchResult = await launchPuppeteerBrowser(debug);
    browser = launchResult.browser;
    userDataDir = launchResult.userDataDir;
    page = await browser.newPage();

    // Navigate and prepare (handles auth, CAPTCHA, interaction)
    const navigationSuccessful = await navigateAndPreparePage(page, url, debug);
    if (!navigationSuccessful) {
      // navigateAndPreparePage logs the failure reason
      logError(
        `[Fetch Known] Navigation/preparation failed for ${url}. Cannot use known XPath.`,
      );
      // Try to get HTML for saving before exiting
      try {
        htmlContentForSave = await getHtmlContent(page);
      } catch {}
      await saveHtmlOnFailure(url, htmlContentForSave);
      await cleanupPuppeteer(page, browser, userDataDir, debug);
      return null; // Return null as we couldn't navigate/prepare
    }

    // Get HTML content after successful navigation (primarily for saving if XPath fails)
    try {
      htmlContentForSave = await getHtmlContent(page);
    } catch {
      logWarn(
        "[Fetch Known] Could not get full HTML content after navigation, continuing with XPath attempt.",
      );
    }

    // Evaluate the known XPath
    logInfo(`[Fetch Known] Evaluating known XPath: ${xpath}`);
    extractedHtml = await page.evaluate((xpathSelector) => {
      try {
        const result = document.evaluate(
          xpathSelector,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE, // Target the first match
          null,
        );
        const element = result.singleNodeValue;
        // Return innerHTML only if element found and has content
        return element?.innerHTML?.trim() || null;
      } catch (e) {
        // Log error within evaluate context for easier debugging
        console.error(
          `[Fetch Known Eval] Error during XPath evaluation in browser for "${xpathSelector}": ${e.message}`,
        );
        return null; // Return null on evaluation error
      }
    }, xpath); // Pass the known XPath

    // Check the result
    if (extractedHtml !== null && extractedHtml.length > 0) {
      // Check length too
      logInfo(
        `[Fetch Known] Successfully extracted content using known XPath. Length: ${extractedHtml.length}`,
      );
      await cleanupPuppeteer(page, browser, userDataDir, debug);
      return extractedHtml; // Success
    } else {
      logWarn(
        `[Fetch Known] Known XPath "${xpath}" failed to return content for ${url} (element missing, empty, or evaluation error).`,
      );
      await saveHtmlOnFailure(url, htmlContentForSave); // Save the full HTML since the XPath failed
      await cleanupPuppeteer(page, browser, userDataDir, debug);
      return null; // Indicate known XPath failure
    }
  } catch (error) {
    logError(
      `[Fetch Known] An unhandled error occurred during fetchWithKnownXpath for ${url}:`,
      error,
    );
    if (
      error.message &&
      (error.message.includes("Target closed") ||
        error.message.includes("Session closed"))
    ) {
      logError("[Fetch Known] Browser or page closed unexpectedly.");
    }
    // Attempt to save HTML if available
    if (htmlContentForSave) {
      await saveHtmlOnFailure(url, htmlContentForSave);
    } else if (page && !page.isClosed()) {
      try {
        htmlContentForSave = await getHtmlContent(page);
        await saveHtmlOnFailure(url, htmlContentForSave);
      } catch {}
    } else {
      logWarn(
        "[Fetch Known] Error occurred, and no HTML content was available to save.",
      );
    }
    await cleanupPuppeteer(page, browser, userDataDir, debug); // Ensure cleanup
    return null; // Indicate failure due to error
  }
};

// --- Main Application Logic ---

/**
 * Main function to get content for a URL.
 * Handles storage lookup, fetch with known XPath, fallback to discovery, and storage updates.
 * Uses the configured HTTP proxy via Puppeteer launch.
 * @param {string} url - The target URL.
 * @returns {Promise<{success: boolean, content?: string, error?: string}>}
 */
const getContent = async (url) => {
  logInfo(`Processing URL: ${url}`);
  const domain = getDomainFromUrl(url);
  if (!domain) {
    return { success: false, error: `Invalid URL format: ${url}` };
  }
  logInfo(`Normalized Domain: ${domain}`);

  const storageData = loadStorage();
  const knownXpath = storageData[domain];
  let extractedHtml = null;
  let finalXpathUsed = null; // Track which XPath was ultimately used

  // 1. Try with known XPath if available
  if (knownXpath) {
    logInfo(
      `Found known XPath for ${domain}: ${knownXpath}. Attempting fetch...`,
    );
    extractedHtml = await fetchWithKnownXpath(
      url,
      knownXpath,
      ENABLE_DEBUG_LOGGING,
    );

    if (extractedHtml !== null) {
      logInfo(`Extraction successful using stored XPath for ${domain}.`);
      finalXpathUsed = knownXpath;
      return { success: true, content: extractedHtml }; // Early exit on success
    } else {
      // Known XPath failed, log it and prepare for discovery
      logWarn(
        `Stored XPath "${knownXpath}" for ${domain} failed. Attempting discovery...`,
      );
      // Don't remove from storage yet, discovery might fail too.
    }
  } else {
    logInfo(`No stored XPath found for ${domain}. Starting discovery...`);
  }

  // 2. Fallback to Discovery if known XPath failed or didn't exist
  if (extractedHtml === null) {
    // Only run discovery if fetchWithKnownXpath failed or wasn't tried
    const discoveryResult = await findArticleXPathAndExtract(
      url,
      ENABLE_DEBUG_LOGGING,
    );

    if (discoveryResult && discoveryResult.extractedHtml !== null) {
      // Discovery succeeded
      logInfo(
        `XPath discovery successful for ${domain}. New XPath: ${discoveryResult.foundXPath}`,
      );
      finalXpathUsed = discoveryResult.foundXPath;
      extractedHtml = discoveryResult.extractedHtml;

      // Update storage only if the discovered XPath is different from the (failed) known one, or if none was known
      if (storageData[domain] !== finalXpathUsed) {
        if (storageData[domain]) {
          logInfo(
            `Updating storage for ${domain}: Replacing failed "${storageData[domain]}" with new "${finalXpathUsed}"`,
          );
        } else {
          logInfo(
            `Saving newly discovered XPath for ${domain}: ${finalXpathUsed}`,
          );
        }
        storageData[domain] = finalXpathUsed;
        saveStorage(storageData);
      } else if (knownXpath) {
        // This case means discovery found the *same* XPath that just failed in fetchWithKnownXpath.
        // This is odd, but we trust the content extracted during *discovery* more in this instance.
        logWarn(
          `Discovery found the same XPath (${finalXpathUsed}) that failed during the initial fetch attempt. Using content from discovery. Storage not changed.`,
        );
      }
      return { success: true, content: extractedHtml }; // Return discovered content
    } else {
      // Discovery failed
      logError(`Failed to discover a working XPath for ${domain} (${url}).`);

      // If a known XPath existed but failed, AND discovery also failed, remove the bad known XPath
      if (knownXpath && storageData[domain] === knownXpath) {
        logWarn(
          `Removing failed known XPath "${knownXpath}" from storage for ${domain} because discovery also failed.`,
        );
        delete storageData[domain];
        saveStorage(storageData);
      }
      return {
        success: false,
        error: `Failed to find or extract content for ${domain} after discovery attempt.`,
      };
    }
  }

  // Should not be reached if logic is correct, but provides a fallback error.
  logError(`[FATAL] Unexpected state reached for ${url}. No content obtained.`);
  return {
    success: false,
    error: `Unexpected processing state for ${domain}.`,
  };
};

// --- Command Line Execution ---
(async () => {
  const targetUrl = process.argv[2];

  if (!targetUrl) {
    console.error("Usage: node smartScraper2.js <url>"); // Updated script name
    process.exit(1);
  }

  // Validate URL format roughly before starting
  try {
    new URL(targetUrl);
  } catch (e) {
    console.error(`Invalid URL provided: ${targetUrl}`);
    process.exit(1);
  }

  // Initialize storage if needed
  if (!fs.existsSync(STORAGE_FILE_PATH)) {
    logInfo("Creating empty storage file.");
    try {
      saveStorage({});
    } catch (initSaveError) {
      console.error(
        "FATAL: Could not create initial storage file.",
        initSaveError,
      );
      process.exit(1);
    }
  } else {
    // Attempt to load storage early to catch parsing errors before launching browser
    try {
      loadStorage();
      logDebug("Storage file loaded successfully.");
    } catch (initLoadError) {
      console.error(
        "FATAL: Could not load or parse existing storage file.",
        initLoadError,
      );
      process.exit(1);
    }
  }

  // Removed: Starting the Local Proxy Server (no longer needed)

  // --- Run the Main Content Fetching Logic ---
  let exitCode = 1; // Default to failure exit code
  try {
    const result = await getContent(targetUrl); // Uses direct proxy setup within

    if (result.success && result.content) {
      logInfo("\n--- Extraction Successful ---");
      // Output ONLY the extracted HTML content to stdout for piping/further processing
      console.log(result.content);
      exitCode = 0; // Set success exit code
    } else {
      logError("\n--- Extraction Failed ---");
      // Output error message to stderr
      console.error(`Error: ${result.error || "Unknown extraction failure."}`);
      exitCode = 1; // Ensure failure exit code
    }
  } catch (err) {
    logError(
      "\n--- An Unhandled Top-Level Error Occurred During Processing ---",
    );
    console.error(err); // Log the full error to stderr
    exitCode = 1; // Ensure failure exit code
  } finally {
    // Removed: Stopping the Local Proxy Server
    logInfo(
      "Processing finished. Initiating final cleanup check (if any browser lingered)...",
    );
    // Minimal cleanup needed here as it's handled within functions, but log completion.
    logInfo("Exiting.");
    process.exit(exitCode); // Exit with the determined code
  }
})();
