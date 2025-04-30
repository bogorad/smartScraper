// smartScraper.js

// --- Required Libraries ---
require("dotenv").config(); // Load environment variables from .env file
const axios = require("axios"); // For making HTTP requests to the LLM API
const puppeteer = require("puppeteer-core"); // Use puppeteer-core
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto"); // For generating a hash for filenames (used in saveHtmlOnFailure)
const { URL } = require("url"); // For parsing URLs to get domain

// --- Configuration ---
const STORAGE_FILE_PATH = path.join(__dirname, "xpath_storage.json");
const LLM_API_BASE_URL = "https://openrouter.ai/api/v1";
const LLM_CHAT_COMPLETIONS_ENDPOINT = `${LLM_API_BASE_URL}/chat/completions`;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL;
const EXECUTABLE_PATH =
  process.env.EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"; // Adjust if needed
const EXTENSION_PATHS = process.env.EXTENSION_PATHS; // Optional: Path to browser extensions
// const MY_SOCKS5_PROXY = process.env.MY_SOCKS5_PROXY;

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
  // Depending on your setup, you might want to exit here: process.exit(1);
}
// if (!MY_SOCKS5_PROXY) {
//   console.error("FATAL: MY_SOCKS5_PROXY environment variable is not set.");
//   process.exit(1);
// }

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
const logDebug = (...args) => {
  if (ENABLE_DEBUG_LOGGING) {
    console.log("[DEBUG]", ...args);
  }
};
const logInfo = (...args) => console.log("[INFO]", ...args);
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
    logInfo(
      `Storage file not found at ${STORAGE_FILE_PATH}. Starting with empty storage.`,
    );
    return {}; // Return empty object if file doesn't exist
  } catch (error) {
    logError(
      `Failed to load or parse storage file ${STORAGE_FILE_PATH}:`,
      error,
    );
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

// --- Puppeteer and Extraction Logic (Adapted from find-xpath.js) ---

/**
 * Launches a Puppeteer browser instance.
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
    const launchArgs = [
      "--no-sandbox",
      // `--proxy-server=${MY_SOCKS5_PROXY}`,
      "--disable-features=DnsOverHttps",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--use-gl=swiftshader", // Added for compatibility
      "--window-size=1280,720",
      "--font-render-hinting=none", // Added for consistency
      ...extensionArgs,
    ];
    logDebug(`[LAUNCH] Initializing browser instance... ${launchArgs}`);
    browser = await puppeteer.launch({
      executablePath: EXECUTABLE_PATH,
      headless: "new",
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
        // Use fs.rmSync for newer Node versions, fallback for older
        if (fs.rmSync) {
          fs.rmSync(userDataDir, { recursive: true, force: true });
        } else {
          fs.rmdirSync(userDataDir, { recursive: true }); // Deprecated but fallback
        }
        logDebug("[LAUNCH] Cleaned up user data dir after launch failure.");
      } catch (e) {
        if (debug) logError("[LAUNCH] Error cleaning up user data dir:", e);
      }
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
  if (page) {
    try {
      await page.close();
      logDebug("[CLEANUP] Page closed.");
    } catch (e) {
      if (debug) logError("[CLEANUP] Error closing page:", e);
    }
  }
  if (browser) {
    try {
      await browser.close();
      logDebug("[CLEANUP] Browser closed.");
    } catch (e) {
      if (debug) logError("[CLEANUP] Error closing browser:", e);
    }
  }
  if (userDataDir) {
    logDebug(`[CLEANUP] Removing user data dir: ${userDataDir}`);
    try {
      // Use fs.rmSync for newer Node versions, fallback for older
      if (fs.rmSync) {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } else {
        fs.rmdirSync(userDataDir, { recursive: true }); // Deprecated but fallback
      }
      logDebug("[CLEANUP] User data dir removed.");
    } catch (err) {
      if (debug)
        logError("[CLEANUP] Failed to remove user data dir:", userDataDir, err);
    }
  }
  logDebug("[CLEANUP] Puppeteer cleanup finished.");
};

/**
 * Navigates the page and performs initial interactions.
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @param {string} url - The URL to navigate to.
 * @param {boolean} debug - Debug flag.
 * @returns {Promise<void>}
 */
const navigateAndPreparePage = async (page, url, debug = false) => {
  logDebug("[NAVIGATE] Setting Viewport and User-Agent...");
  await page.setViewport({ width: 1280, height: 720 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  ); // Use a recent UA

  logDebug("[DELAY] Waiting 3 seconds before navigating...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  logDebug(`[NAVIGATE] Loading URL: ${url}`);
  await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 45000,
  });
  logDebug(`[NAVIGATE] Page loaded successfully: ${url}`);

  logDebug(`[NAVIGATE END] move and scroll.`);
  await page.mouse.move(100, 100);
  await page.evaluate(() => window.scrollBy(0, 200));

  const postNavDelay = 5000;
  logDebug(
    `[DELAY] Waiting ${postNavDelay / 1000} seconds after navigation...`,
  );
  await new Promise((resolve) => setTimeout(resolve, postNavDelay));
};

/**
 * Gets the full HTML content of the page.
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @returns {Promise<string|null>} - The HTML content or null on error.
 */
const getHtmlContent = async (page) => {
  logDebug("[Puppeteer] Getting full page HTML...");
  try {
    const html = await page.content();
    logDebug("[Puppeteer] Full HTML fetched.");
    return html;
  } catch (error) {
    logError("[Puppeteer] Error getting full HTML:", error.message);
    return null;
  }
};

/**
 * Extracts text snippets from common elements.
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @param {number} numSnippets - Max number of snippets.
 * @param {number} minLength - Minimum text length.
 * @returns {Promise<string[]>} - Array of text snippets.
 */
const extractArticleSnippets = async (
  page,
  numSnippets = 5,
  minLength = 50,
) => {
  logDebug("[Puppeteer] Extracting text snippets...");
  const selector = "p, h2, h3, li, blockquote";
  try {
    const snippets = await page.$$eval(
      selector,
      (elements, minLength, numSnippets) => {
        const results = [];
        for (const el of elements) {
          if (!el.offsetParent && el.tagName !== "BODY") continue;
          if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
          const text = el.textContent.trim();
          if (text.length >= minLength) {
            results.push(text);
            if (results.length >= numSnippets) break;
          }
        }
        return results;
      },
      minLength,
      numSnippets,
    );
    logDebug(`[Puppeteer] Extracted ${snippets.length} snippets.`);
    return snippets;
  } catch (error) {
    logError(`[Puppeteer] Error extracting text snippets: ${error.message}`);
    return [];
  }
};

/**
 * Queries elements by XPath and gets details for the first matched element.
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @param {string} xpath - The XPath to query.
 * @param {string[]} tagsToCount - Array of tag names to count descendants.
 * @returns {Promise<{ count: number, firstElementDetails: object | null }>}
 */
const queryXPathWithDetails = async (page, xpath, tagsToCount) => {
  logDebug(`[Puppeteer] Querying XPath: ${xpath}`);
  try {
    const result = await page.evaluate(
      (xpathSelector, tagsToCount) => {
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
          if (firstNode && firstNode.nodeType === Node.ELEMENT_NODE) {
            const el = firstNode;
            const descendantCounts = {};
            tagsToCount.forEach((tag) => {
              descendantCounts[tag] = el.querySelectorAll(tag).length;
            });
            const totalDescendantElements = el.querySelectorAll("*").length;
            firstElementDetails = {
              tagName: el.tagName.toUpperCase(),
              id: el.id,
              className: el.className,
              descendantCounts: descendantCounts,
              textContent: el.textContent,
              innerHTML: el.innerHTML,
              totalDescendantElements: totalDescendantElements,
            };
          }
        }
        return { count, firstElementDetails };
      },
      xpath,
      tagsToCount,
    );

    logDebug(
      `[Puppeteer] XPath query "${xpath}" found ${result.count} elements.`,
    );
    if (result.count > 0 && result.firstElementDetails) {
      logDebug(
        `[Puppeteer] Details obtained for first element (Tag: ${result.firstElementDetails.tagName}, Paragraphs: ${result.firstElementDetails.descendantCounts?.p || 0}).`,
      );
    } else if (result.count > 0 && !result.firstElementDetails) {
      logWarn(
        `[Puppeteer] XPath "${xpath}" found elements, but could not get details for the first one.`,
      );
    }
    return result;
  } catch (error) {
    // Don't log every XPath error here as some LLM suggestions might be invalid
    logDebug(`[Puppeteer] Error querying XPath ${xpath}: ${error.message}`);
    return { count: 0, firstElementDetails: null };
  }
};

/**
 * Scores a potential article container element.
 * @param {object} elementDetails - Details from queryXPathWithDetails.
 * @param {number} totalElementsFoundByXPath - Total elements matched by XPath.
 * @param {string} xpath - The XPath string.
 * @returns {number} - The calculated score. Returns 0 if basic criteria fail.
 */
const scoreElement = (elementDetails, totalElementsFoundByXPath, xpath) => {
  // ... (Scoring logic exactly as in find-xpath.js) ...
  // (Keeping the detailed logging within scoreElement as it's useful for debugging XPath selection)
  if (!elementDetails || !elementDetails.descendantCounts) {
    console.log(`Scoring: Missing element details for ${xpath}. Score: 0`); // Use console.log for scoring details
    return 0;
  }
  let score = 0;
  const {
    tagName,
    id,
    className,
    descendantCounts,
    textContent,
    innerHTML,
    totalDescendantElements,
  } = elementDetails;
  const pCount = descendantCounts["p"] || 0;
  const unwantedCount = UNWANTED_TAGS.reduce(
    (sum, tag) => sum + (descendantCounts[tag] || 0),
    0,
  );
  const linkCount = descendantCounts["a"] || 0;
  const mediaCount =
    (descendantCounts["img"] || 0) +
    (descendantCounts["video"] || 0) +
    (descendantCounts["audio"] || 0) +
    (descendantCounts["picture"] || 0);

  if (pCount < MIN_PARAGRAPH_THRESHOLD) {
    console.log(
      `Scoring: ${xpath} failed min paragraph threshold (${pCount} < ${MIN_PARAGRAPH_THRESHOLD}). Score: 0`,
    );
    return 0;
  }
  score += pCount * SCORE_WEIGHTS.paragraphCount;
  console.log(
    `Scoring: ${xpath} - Paragraphs (${pCount}): +${(pCount * SCORE_WEIGHTS.paragraphCount).toFixed(2)}`,
  );

  if (totalDescendantElements > 0 && unwantedCount > 0) {
    const unwantedRatio = unwantedCount / totalDescendantElements;
    const penalty = unwantedRatio * SCORE_WEIGHTS.unwantedPenaltyRatio;
    score += penalty;
    console.log(
      `Scoring: ${xpath} - Unwanted ratio (${unwantedRatio.toFixed(2)}): ${penalty.toFixed(2)}`,
    );
  } else if (unwantedCount > 0) {
    score += unwantedCount * SCORE_WEIGHTS.unwantedPenaltyRatio;
    console.log(
      `Scoring: ${xpath} - Unwanted tags (${unwantedCount}, total elements 0): ${(unwantedCount * SCORE_WEIGHTS.unwantedPenaltyRatio).toFixed(2)}`,
    );
  }

  if (tagName === "ARTICLE" || tagName === "MAIN") {
    score += SCORE_WEIGHTS.isSemanticTag;
    console.log(
      `Scoring: ${xpath} - Semantic tag (${tagName}): +${SCORE_WEIGHTS.isSemanticTag}`,
    );
  }

  const descriptiveRegex = /article|content|body|story|main|post|entry/i; // Added 'entry'
  if (
    (id && descriptiveRegex.test(id)) ||
    (className && descriptiveRegex.test(className))
  ) {
    score += SCORE_WEIGHTS.hasDescriptiveIdOrClass;
    console.log(
      `Scoring: ${xpath} - Descriptive ID/Class: +${SCORE_WEIGHTS.hasDescriptiveIdOrClass}`,
    );
  }

  if (innerHTML && innerHTML.length > 0) {
    const plainText = textContent ? textContent.trim() : "";
    const htmlLength = innerHTML.length;
    const textLength = plainText.length;
    if (htmlLength > 0) {
      const textDensity = textLength / htmlLength;
      const densityBonus = textDensity * SCORE_WEIGHTS.textDensity;
      score += densityBonus;
      console.log(
        `Scoring: ${xpath} - Text Density (${textDensity.toFixed(2)}): +${densityBonus.toFixed(2)}`,
      );
    }
  }

  if (totalDescendantElements > 0 && linkCount > 0) {
    const linkDensity = linkCount / totalDescendantElements;
    const linkPenalty = linkDensity * SCORE_WEIGHTS.linkDensityPenalty;
    score += linkPenalty;
    console.log(
      `Scoring: ${xpath} - Link Density (${linkDensity.toFixed(2)}): ${linkPenalty.toFixed(2)}`,
    );
  }

  if (mediaCount > 0) {
    score += SCORE_WEIGHTS.mediaPresence;
    console.log(
      `Scoring: ${xpath} - Media Presence (${mediaCount}): +${SCORE_WEIGHTS.mediaPresence}`,
    );
  }

  const xpathComplexity =
    xpath.split("/").length + (xpath.match(/\[.*?\]/g) || []).length;
  const complexityPenalty =
    xpathComplexity * SCORE_WEIGHTS.xpathComplexityPenalty;
  score += complexityPenalty;
  console.log(
    `Scoring: ${xpath} - XPath Complexity (${xpathComplexity}): ${complexityPenalty.toFixed(2)}`,
  );

  const isSingleElement = totalElementsFoundByXPath === 1;
  if (isSingleElement) {
    score += SCORE_WEIGHTS.isSingleElement;
    console.log(
      `Scoring: ${xpath} - Single element bonus: +${SCORE_WEIGHTS.isSingleElement}`,
    );
  } else {
    console.log(
      `Validation: XPath "${xpath}" found ${totalElementsFoundByXPath} elements (not single).`,
    );
  }

  console.log(`Scoring: ${xpath} - Final Score: ${score.toFixed(2)}`);
  return score;
};

/**
 * Calls the LLM API to get candidate XPaths.
 * @param {string} htmlContent - Full HTML.
 * @param {string[]} anchorSnippets - Text snippets.
 * @param {Array<{xpath: string, result: string}>} [feedback=[]] - Feedback from previous attempts.
 * @returns {Promise<string[]>} - Array of candidate XPaths.
 */
const getLlmCandidateXPaths = async (
  htmlContent,
  anchorSnippets,
  feedback = [],
) => {
  // ... (LLM interaction logic exactly as in find-xpath.js) ...
  logInfo("[LLM API] Requesting candidate XPaths from OpenRouter...");
  let prompt = `Analyze the following HTML source code. Identify the XPath for the main content element (article body, primary text, images), excluding headers, footers, nav, sidebars, comments. Prioritize semantic tags (<article>, <main>) or descriptive IDs/classes (content, article-body, main, post). Aim for a single, precise container.`;
  if (anchorSnippets && anchorSnippets.length > 0) {
    prompt += `\nThe content likely includes text like: ${JSON.stringify(anchorSnippets)}.`;
  } else {
    prompt += `\nNo specific text snippets available; rely on structure/semantics.`;
  }
  if (feedback && feedback.length > 0) {
    prompt += `\n\nFeedback on previous XPath attempts:`;
    feedback.forEach((item) => {
      prompt += `\n- "${item.xpath}": ${item.result}`;
    });
    prompt += `\nPlease suggest *alternative* XPaths based on this feedback. Avoid repeating failed patterns.`;
  } else {
    prompt += `\n\nProvide likely candidate XPaths.`;
  }
  prompt += `\n**IMPORTANT:** Respond ONLY with a JSON array of strings (XPaths). Example: ["//article", "//div[@id='main']"]`;

  try {
    const response = await axios.post(
      LLM_CHAT_COMPLETIONS_ENDPOINT,
      {
        model: LLM_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are an expert HTML analyzer providing XPaths in JSON format. Respond ONLY with the JSON array.",
          },
          { role: "user", content: prompt + "\n\nHTML:\n" + htmlContent },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "http://localhost", // Optional but recommended
          "Content-Type": "application/json",
          "X-Title": "smartScraper",
          "HTTP-Referer": "https://github.com/bogorad/smartScraper",
        },
      },
    );

    if (
      !response.data ||
      !response.data.choices ||
      response.data.choices.length === 0
    ) {
      logWarn("[LLM API] LLM response missing choices.");
      logDebug("[LLM API] Response data:", response.data);
      return [];
    }
    const llmResponseContent = response.data.choices[0].message.content;
    logDebug("[LLM API] Raw response content:", llmResponseContent);

    let contentToParse = llmResponseContent.trim();
    const jsonCodeBlockRegex = /^```json\s*\n([\s\S]*?)\n```$/;
    const match = contentToParse.match(jsonCodeBlockRegex);
    if (match && match[1]) {
      logDebug("[LLM API] Detected JSON in markdown code block. Extracting...");
      contentToParse = match[1];
    }

    try {
      const candidateXPaths = JSON.parse(contentToParse);
      if (
        Array.isArray(candidateXPaths) &&
        candidateXPaths.every((item) => typeof item === "string")
      ) {
        logInfo(`[LLM API] Parsed ${candidateXPaths.length} candidate XPaths.`);
        return candidateXPaths;
      } else {
        logError(
          "[LLM API] Parsed content is not a valid JSON array of strings:",
          contentToParse,
        );
        return [];
      }
    } catch (parseError) {
      logError(
        "[LLM API] Failed to parse JSON from LLM response:",
        parseError.message,
      );
      logError("[LLM API] Content that failed parsing:", contentToParse);
      return [];
    }
  } catch (error) {
    logError(`[LLM API] Error calling OpenRouter API: ${error.message}`);
    if (error.response) {
      logError("[LLM API] Response Status:", error.response.status);
      logError("[LLM API] Response Data:", error.response.data);
    }
    return [];
  }
};

/**
 * Saves HTML content to a file on failure.
 * @param {string} url - The original URL.
 * @param {string} htmlContent - The HTML content to save.
 */
const saveHtmlOnFailure = async (url, htmlContent) => {
  // ... (saveHtmlOnFailure logic exactly as in find-xpath.js) ...
  if (!htmlContent) {
    logWarn("[Save HTML] No HTML content provided to save.");
    return;
  }
  try {
    await fs.promises.mkdir(FAILED_HTML_DIR, { recursive: true });
    const urlHash = crypto
      .createHash("md5")
      .update(url)
      .digest("hex")
      .substring(0, 8);
    const timestamp = new Date().toISOString().replace(/[:.-]/g, "_");
    const filename = `failed_${timestamp}_${urlHash}.html`;
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
 * Reuses the browser session for extraction if successful.
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
    const launchResult = await launchPuppeteerBrowser(debug);
    browser = launchResult.browser;
    userDataDir = launchResult.userDataDir;
    page = await browser.newPage();

    await navigateAndPreparePage(page, url, debug);
    htmlContent = await getHtmlContent(page);
    if (!htmlContent) {
      throw new Error("Failed to get HTML content.");
    }

    const anchorSnippets = await extractArticleSnippets(page);
    if (anchorSnippets.length === 0) {
      logWarn("Could not extract text snippets for LLM context.");
    }

    let allTriedXPaths = new Set();
    let feedbackForLLM = [];

    for (let retry = 0; retry <= MAX_LLM_RETRIES; retry++) {
      logInfo(
        `--- LLM Interaction Attempt ${retry + 1}/${MAX_LLM_RETRIES + 1} ---`,
      );
      const llmCandidateXPaths = await getLlmCandidateXPaths(
        htmlContent,
        anchorSnippets,
        retry > 0 ? feedbackForLLM : [],
      );

      if (llmCandidateXPaths.length === 0) {
        logWarn(`LLM returned no candidates on attempt ${retry + 1}.`);
        if (retry === MAX_LLM_RETRIES) break;
        continue;
      }

      const newCandidateXPaths = llmCandidateXPaths.filter(
        (xpath) => !allTriedXPaths.has(xpath),
      );
      if (newCandidateXPaths.length === 0) {
        logWarn(`LLM returned only previously tried XPaths.`);
        break;
      }

      logInfo(
        `Validating ${newCandidateXPaths.length} new candidate XPaths...`,
      );
      const validationPromises = newCandidateXPaths.map((xpath) => {
        allTriedXPaths.add(xpath);
        return queryXPathWithDetails(page, xpath, TAGS_TO_COUNT).then(
          (result) => ({ xpath, ...result }),
        ); // Include xpath in result
      });

      const validationResults = await Promise.all(validationPromises);

      const currentAttemptScoredCandidates = [];
      let currentAttemptFeedback = [];

      for (const result of validationResults) {
        const { xpath, count, firstElementDetails } = result;
        if (count === 0) {
          logDebug(`Validation: XPath "${xpath}" found 0 elements.`);
          currentAttemptFeedback.push({ xpath, result: "Found 0 elements." });
          continue;
        }
        const score = scoreElement(firstElementDetails, count, xpath);
        if (score > 0) {
          currentAttemptScoredCandidates.push({
            xpath,
            score,
            elementDetails: firstElementDetails,
          });
          logDebug(
            `Validation: XPath "${xpath}" PASSED scoring with score ${score.toFixed(2)}.`,
          );
        } else {
          logDebug(`Validation: XPath "${xpath}" FAILED scoring.`);
          const pCount = firstElementDetails?.descendantCounts?.p || 0;
          let reason = `Found ${count} elements. Scored ${score.toFixed(2)}.`;
          if (pCount < MIN_PARAGRAPH_THRESHOLD)
            reason += ` Low paragraphs (${pCount}).`;
          currentAttemptFeedback.push({ xpath, result: reason });
        }
      }

      feedbackForLLM.push(...currentAttemptFeedback);

      if (currentAttemptScoredCandidates.length > 0) {
        currentAttemptScoredCandidates.sort((a, b) => b.score - a.score);
        bestCandidateXPath = currentAttemptScoredCandidates[0].xpath;
        logInfo(
          `Found best candidate XPath: ${bestCandidateXPath} with score ${currentAttemptScoredCandidates[0].score.toFixed(2)}`,
        );
        break; // Found a good candidate, exit loop
      } else {
        logWarn(`No valid candidates found in attempt ${retry + 1}.`);
        if (retry === MAX_LLM_RETRIES) {
          logError("Max LLM retries reached, no valid XPath found.");
        }
      }
    } // End LLM retry loop

    // --- Extraction Step (if XPath found) ---
    if (bestCandidateXPath) {
      logInfo(
        `Attempting to extract content using discovered XPath: ${bestCandidateXPath}`,
      );
      try {
        // Use page.evaluate to get the innerHTML of the element found by the XPath
        extractedHtml = await page.evaluate((xpath) => {
          const result = document.evaluate(
            xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          );
          const element = result.singleNodeValue;
          return element ? element.innerHTML : null; // Return innerHTML
        }, bestCandidateXPath); // Pass XPath as argument

        if (extractedHtml !== null) {
          logInfo(
            "Successfully extracted HTML content using the discovered XPath.",
          );
        } else {
          logWarn(
            `Discovered XPath "${bestCandidateXPath}" did not find a matching element during final extraction.`,
          );
          bestCandidateXPath = null; // Mark as failed if extraction didn't work
        }
      } catch (extractError) {
        logError(
          `Error extracting content with XPath "${bestCandidateXPath}":`,
          extractError,
        );
        bestCandidateXPath = null; // Mark as failed
        extractedHtml = null;
      }
    }

    // --- Return Result ---
    if (bestCandidateXPath && extractedHtml !== null) {
      return { foundXPath: bestCandidateXPath, extractedHtml: extractedHtml };
    } else {
      // If we reached here without a valid XPath/HTML, it's a failure
      if (SAVE_HTML_ON_FAILURE && htmlContent) {
        logWarn(
          "XPath discovery failed or final extraction failed. Saving full HTML...",
        );
        await saveHtmlOnFailure(url, htmlContent);
      }
      return null;
    }
  } catch (error) {
    logError("An error occurred during XPath discovery and extraction:", error);
    if (SAVE_HTML_ON_FAILURE && htmlContent) {
      logWarn("Process failed due to error. Saving full HTML...");
      await saveHtmlOnFailure(url, htmlContent);
    }
    return null; // Indicate failure
  } finally {
    // --- Cleanup ---
    await cleanupPuppeteer(page, browser, userDataDir, debug);
  }
};

/**
 * Fetches content using a known XPath. Launches/closes browser.
 * @param {string} url - The URL to fetch.
 * @param {string} xpath - The known XPath to use.
 * @param {boolean} debug - Enable debug logging.
 * @returns {Promise<string|null>} - The extracted HTML content or null if XPath fails.
 */
const fetchWithKnownXpath = async (url, xpath, debug = false) => {
  logInfo(`Attempting to fetch content for ${url} using known XPath: ${xpath}`);
  let browser = null;
  let userDataDir = null;
  let page = null;
  let extractedHtml = null;

  try {
    const launchResult = await launchPuppeteerBrowser(debug);
    browser = launchResult.browser;
    userDataDir = launchResult.userDataDir;
    page = await browser.newPage();

    // Use a shorter navigation/wait time as we aren't doing complex analysis
    logDebug("[NAVIGATE-KNOWN] Setting Viewport and User-Agent...");
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    );

    logDebug(`[NAVIGATE-KNOWN] Loading URL: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); // Faster wait
    logDebug(`[NAVIGATE-KNOWN] Page loaded. Waiting briefly...`);
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Short delay

    logDebug(`[EXTRACT-KNOWN] Evaluating XPath: ${xpath}`);
    extractedHtml = await page.evaluate((xpathSelector) => {
      try {
        const result = document.evaluate(
          xpathSelector,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        );
        const element = result.singleNodeValue;
        // Check if element exists and has content
        if (element && element.innerHTML.trim().length > 0) {
          return element.innerHTML;
        }
        return null; // Return null if element not found or empty
      } catch (e) {
        // Log error within evaluate if needed, but primarily handle null return
        console.error("Error during XPath evaluation in browser:", e);
        return null;
      }
    }, xpath);

    if (extractedHtml !== null) {
      logInfo(`Successfully extracted content using known XPath.`);
      return extractedHtml;
    } else {
      logWarn(
        `Known XPath "${xpath}" failed to find a valid element for ${url}.`,
      );
      return null; // Indicate XPath failure
    }
  } catch (error) {
    logError(`Error during fetchWithKnownXpath for ${url}:`, error);
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
  logInfo(`Processing URL: ${url}`);
  const domain = getDomainFromUrl(url);
  if (!domain) {
    return { success: false, error: `Invalid URL format: ${url}` };
  }
  logInfo(`Normalized Domain: ${domain}`);

  const storageData = loadStorage();
  const knownXpath = storageData[domain];
  let extractedHtml = null;
  let finalXpath = knownXpath; // Keep track of the XPath used/found

  if (knownXpath) {
    logInfo(`Found known XPath for ${domain}: ${knownXpath}`);
    extractedHtml = await fetchWithKnownXpath(
      url,
      knownXpath,
      ENABLE_DEBUG_LOGGING,
    );

    if (extractedHtml !== null) {
      logInfo(`Extraction successful using stored XPath for ${domain}.`);
      return { success: true, content: extractedHtml };
    } else {
      // Stored XPath failed, proceed to discovery
      logWarn(`Stored XPath for ${domain} failed. Attempting discovery...`);
      finalXpath = null; // Reset finalXpath as the known one is invalid
    }
  } else {
    logInfo(`No stored XPath found for ${domain}. Starting discovery...`);
  }

  // If we reach here, either no XPath was known, or the known one failed.
  const discoveryResult = await findArticleXPathAndExtract(
    url,
    ENABLE_DEBUG_LOGGING,
  );

  if (discoveryResult) {
    logInfo(
      `XPath discovery successful for ${domain}. New XPath: ${discoveryResult.foundXPath}`,
    );
    finalXpath = discoveryResult.foundXPath;
    extractedHtml = discoveryResult.extractedHtml;

    // Update and save storage
    if (storageData[domain] !== finalXpath) {
      logInfo(`Updating storage for ${domain} with new XPath.`);
      storageData[domain] = finalXpath;
      saveStorage(storageData);
    } else {
      logInfo(
        `Discovered XPath is the same as the failed one? This might indicate a temporary issue or unstable site. Storing it anyway.`,
      );
      storageData[domain] = finalXpath; // Still save it, maybe it works now
      saveStorage(storageData);
    }

    return { success: true, content: extractedHtml };
  } else {
    // Discovery failed
    logError(`Failed to discover a working XPath for ${domain} (${url}).`);
    // Optionally remove the failed knownXpath from storage if it existed?
    // if (knownXpath && storageData[domain] === knownXpath) {
    //     logWarn(`Removing failed XPath ${knownXpath} from storage for ${domain}.`);
    //     delete storageData[domain];
    //     saveStorage(storageData);
    // }
    return {
      success: false,
      error: `Failed to find or extract content for ${domain}`,
    };
  }
};

// --- Command Line Execution ---
(async () => {
  const targetUrl = process.argv[2]; // Get URL from command line argument

  if (!targetUrl) {
    console.error("Usage: node smartScraper.js <url>");
    process.exit(1);
  }

  // Pre-populate storage if the file is empty/doesn't exist (example)
  let initialStorage = loadStorage();
  if (Object.keys(initialStorage).length === 0) {
    logInfo("Pre-populating storage with example entry.");
    // Example: Pre-populate for a specific domain if needed
    // const exampleDomain = getDomainFromUrl("http://some.martina-light.example/article1");
    // if (exampleDomain) {
    //     initialStorage[exampleDomain] = "//*[@class=\"richText martina-light\"]";
    //     saveStorage(initialStorage);
    // }
    // For now, just ensure the file exists if empty
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
