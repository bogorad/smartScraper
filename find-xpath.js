// Required libraries
require('dotenv').config(); // Load environment variables from .env file
const axios = require('axios'); // For making HTTP requests to the LLM API
const puppeteer = require('puppeteer-core'); // Use puppeteer-core as specified by wrapper
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto'); // For generating a hash for filenames

// --- Configuration ---
// Use OpenRouter base URL for OpenAI API format
const LLM_API_BASE_URL = 'https://openrouter.ai/api/v1';
const LLM_CHAT_COMPLETIONS_ENDPOINT = `${LLM_API_BASE_URL}/chat/completions`;

// Read API Key and Model from environment variables
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL; // e.g., 'openai/gpt-4o', 'anthropic/claude-3-haiku'

// Check if required environment variables are set
if (!OPENROUTER_API_KEY) {
  console.error('FATAL: OPENROUTER_API_KEY environment variable is not set.');
  process.exit(1);
}
if (!LLM_MODEL) {
  console.error('FATAL: LLM_MODEL environment variable is not set.');
  process.exit(1);
}

// Scoring weights (adjust these based on desired behavior)
const SCORE_WEIGHTS = {
  isSingleElement: 80, // Slightly reduced bonus for XPaths that select exactly one element
  paragraphCount: 1,    // Score proportional to the number of paragraphs found *within* the element
  unwantedPenaltyRatio: -75, // Penalty proportional to the ratio of unwanted tags to *total descendant elements* (Adjusted weight)
  isSemanticTag: 75,    // Bonus for <article> or <main> tags
  hasDescriptiveIdOrClass: 30, // Bonus for IDs/classes like 'article', 'content', 'body'
  textDensity: 50,      // Bonus proportional to the ratio of text length to HTML length
  linkDensityPenalty: -30, // Penalty proportional to the ratio of links to total elements
  mediaPresence: 25,    // Bonus for containing image/video/audio/picture tags
  xpathComplexityPenalty: -5, // Penalty per unit of XPath complexity (e.g., slashes, predicates)
};

// Minimum number of paragraphs required for a candidate to be considered valid
const MIN_PARAGRAPH_THRESHOLD = 5;

// Common tags to count within potential containers for statistical scoring
// Added 'a' and media tags for new scoring factors
const TAGS_TO_COUNT = ['p', 'nav', 'aside', 'footer', 'header', 'ul', 'ol', 'img', 'a', 'video', 'audio', 'picture'];
const UNWANTED_TAGS = ['nav', 'aside', 'footer', 'header']; // Tags that penalize the score if found inside

// Maximum number of LLM retry attempts
const MAX_LLM_RETRIES = 2; // Initial call + 2 retries = 3 total LLM calls

// Debugging flag (can be set via environment variable or constant)
const ENABLE_DEBUG_LOGGING = process.env.DEBUG === 'true';

// Feature flag to save HTML on failure
const SAVE_HTML_ON_FAILURE = process.env.SAVE_HTML_ON_FAILURE === 'true';
const FAILED_HTML_DIR = path.join(__dirname, 'failed_html_dumps');


// --- Puppeteer Launch Logic (Copied Exactly from Wrapper, with one line commented) ---
// This function replicates the browser launch setup from your wrapper.
/**
 * Launches a Puppeteer browser instance.
 * @param {boolean} debug - Enable debug logging.
 * @returns {Promise<{ browser: puppeteer.Browser, userDataDir: string }>} - Browser instance and user data directory path.
 * @throws {Error} - If browser launch fails.
 */
const launchPuppeteerBrowser = async (debug = false) => {
  // Create a Conditional Logger for launch process
  const logDebug = (...args) => {
    if (debug) {
      console.log(...args);
    }
  };

  let browser = null;
  let userDataDir = null;

  try {
    let extensionArgs = [];
    if (process.env.EXTENSION_PATHS) {
      logDebug(`[LAUNCH] Preparing extensions from: ${process.env.EXTENSION_PATHS}`);
      extensionArgs = [
        // `--proxy-server=socks5://r5s.bruc:1080`, // COMMENTED OUT as requested
        `--disable-extensions-except=${process.env.EXTENSION_PATHS}`,
        `--load-extension=${process.env.EXTENSION_PATHS}`
      ];
    }

    // Create temporary user data directory
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puppeteer-user-data-'));
    logDebug(`[LAUNCH] Created temporary user data dir: ${userDataDir}`);

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--use-gl=swiftshader',
      '--window-size=1280,720',
      '--font-render-hinting=none',
      ...extensionArgs
    ];

    logDebug('[LAUNCH] Initializing browser instance...');
    browser = await puppeteer.launch({
      executablePath: process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium',
      headless: false, // Reverted back to headless: false
      userDataDir,
      args: launchArgs,
      // Only dump browser IO if debug is enabled AND env is development
      dumpio: debug && process.env.NODE_ENV === 'development',
      timeout: 60000
    });
    logDebug('[LAUNCH] Browser launched successfully in non-headless mode.');
    return { browser, userDataDir }; // Return both browser instance and temp dir path

  } catch (error) {
    console.error('[LAUNCH] Failed to launch browser:', error.message);
    // Clean up temp dir if it was created before the error
    if (userDataDir) {
      try {
        if (fs.promises && fs.promises.rm) {
          await fs.promises.rm(userDataDir, { recursive: true, force: true });
        } else {
          fs.rmdirSync(userDataDir, { recursive: true });
        }
        logDebug('[LAUNCH] Cleaned up user data dir after launch failure.');
      } catch (e) {
        if (debug) console.error('[LAUNCH] Error cleaning up user data dir:', e);
      }
    }
    throw error; // Re-throw the error so the caller knows launch failed
  }
};

// --- Puppeteer Navigation and Interaction Logic (Direct API Calls) ---

/**
 * Navigates the page and performs initial interactions.
 * Replicates navigation and delay logic from the wrapper.
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @param {string} url - The URL to navigate to.
 * @param {boolean} debug - Debug flag.
 * @returns {Promise<void>}
 */
const navigateAndPreparePage = async (page, url, debug = false) => {
  const logDebug = (...args) => { if (debug) console.log(...args); };

  logDebug('[NAVIGATE] Setting Viewport and User-Agent...');
  await page.setViewport({ width: 1280, height: 720 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36');

  // Optional Delay (as in wrapper)
  logDebug('[DELAY] Waiting 3 seconds before navigating...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  logDebug(`[NAVIGATE] Loading URL: ${url}`);
  await page.goto(url, {
    waitUntil: 'networkidle2', // Use networkidle2 as in wrapper
    timeout: 45000
  });
  logDebug(`[NAVIGATE] Page loaded successfully: ${url}`);

  // Moving mouse and scrolling (as in wrapper)
  logDebug(`[NAVIGATE END] move and scroll.`);
  await page.mouse.move(100, 100);
  await page.evaluate(() => window.scrollBy(0, 200));

  // Post-navigation delay (as in wrapper)
  const postNavDelay = 5000; // Using the XPath delay duration as a general post-load delay
  logDebug(`[DELAY] Waiting ${postNavDelay / 1000} seconds after navigation before extraction...`);
  await new Promise(resolve => setTimeout(resolve, postNavDelay));
};


/**
 * Gets the full HTML content of the page using direct Puppeteer call.
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @returns {Promise<string|null>} - The HTML content or null on error.
 */
const getHtmlContent = async (page) => {
  console.log('[Puppeteer] Getting full page HTML...');
  try {
    const html = await page.content();
    console.log('[Puppeteer] Full HTML fetched.');
    return html;
  } catch (error) {
    console.error('[Puppeteer] Error getting full HTML:', error.message);
    return null;
  }
};

/**
 * Extracts text snippets from common elements using direct Puppeteer calls.
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @param {number} numSnippets - Max number of snippets to get.
 * @param {number} minLength - Minimum text length for a snippet.
 * @returns {Promise<string[]>} - Array of text snippets.
 */
const extractArticleSnippets = async (page, numSnippets = 5, minLength = 50) => {
  console.log('[Puppeteer] Extracting text snippets...');
  const selector = 'p, h2, h3, li, blockquote'; // Common text-bearing elements

  try {
    // Use $$eval to find elements and extract/filter text efficiently in the browser context
    const snippets = await page.$$eval(selector, (elements, minLength, numSnippets) => {
      const results = [];
      for (const el of elements) {
        // Basic visibility check (similar to wrapper's potential logic)
        // and avoid script/style tags
        if (!el.offsetParent && el.tagName !== 'BODY') continue;
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;

        const text = el.textContent.trim();
        if (text.length >= minLength) {
          results.push(text);
          if (results.length >= numSnippets) break; // Stop once limit is reached
        }
      }
      return results;
    }, minLength, numSnippets); // Pass arguments to the evaluate function

    console.log(`[Puppeteer] Extracted ${snippets.length} snippets.`);
    return snippets;

  } catch (error) {
    console.error(`[Puppeteer] Error extracting text snippets: ${error.message}`);
    return [];
  }
};

/**
 * Queries elements by XPath using document.evaluate in page.evaluate,
 * and gets details and descendant counts for the first matched element.
 * This replaces the separate getElementDetails call.
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @param {string} xpath - The XPath to query.
 * @param {string[]} tagsToCount - Array of tag names to count descendants.
 * @returns {Promise<{ count: number, firstElementDetails: { tagName: string, id: string, className: string, descendantCounts: { [tag: string]: number }, textContent: string, innerHTML: string, totalDescendantElements: number } | null }>}
 */
const queryXPathWithDetails = async (page, xpath, tagsToCount) => {
  // console.log(`[Puppeteer] Querying XPath: ${xpath} and getting details using document.evaluate`); // Reduced logging for parallel calls
  try {
    // Execute document.evaluate and get details in a single evaluate call
    const result = await page.evaluate((xpathSelector, tagsToCount) => {
      const evaluateResult = document.evaluate(xpathSelector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const count = evaluateResult.snapshotLength;
      let firstElementDetails = null;

      if (count > 0) {
        const firstNode = evaluateResult.snapshotItem(0);
        // Ensure the first node is an element node before trying to get details
        if (firstNode && firstNode.nodeType === Node.ELEMENT_NODE) {
          const el = firstNode; // Cast for clarity

          const descendantCounts = {};
          tagsToCount.forEach(tag => {
            // Use querySelectorAll on the element node
            descendantCounts[tag] = el.querySelectorAll(tag).length;
          });

          // Count all descendant elements
          const totalDescendantElements = el.querySelectorAll('*').length;

          firstElementDetails = {
            tagName: el.tagName.toUpperCase(),
            id: el.id,
            className: el.className,
            descendantCounts: descendantCounts,
            textContent: el.textContent, // Get text content for density
            innerHTML: el.innerHTML,     // Get inner HTML for density calculation
            totalDescendantElements: totalDescendantElements // Total elements inside
          };
        }
      }

      return { count, firstElementDetails };
    }, xpath, tagsToCount); // Pass xpath and tagsToCount as arguments

    // console.log(`[Puppeteer] XPath query "${xpath}" found ${result.count} elements.`); // Reduced logging for parallel calls
    // if (result.count > 0 && result.firstElementDetails) {
    //   console.log(`[Puppeteer] Details obtained for first element (Tag: ${result.firstElementDetails.tagName}, Paragraphs: ${result.firstElementDetails.descendantCounts?.p || 0}).`); // Reduced logging
    // } else if (result.count > 0 && !result.firstElementDetails) {
    //   console.warn(`[Puppeteer] XPath "${xpath}" found elements, but could not get details for the first one (maybe not an element node?).`); // Reduced logging
    // }


    return result; // Returns { count, firstElementDetails }

  } catch (error) {
    console.error(`[Puppeteer] Error querying XPath ${xpath} and getting details: ${error.message}`);
    // Return a structure indicating failure but don't throw
    return { count: 0, firstElementDetails: null };
  }
};

// getElementDetails is no longer needed as its logic is moved into queryXPathWithDetails
// async function getElementDetails(elementHandle) { ... }


/**
 * Scores a potential article container element based on its properties and content.
 * @param {object} elementDetails - Details obtained from queryXPathWithDetails.
 * @param {number} totalElementsFoundByXPath - The total number of elements the XPath matched.
 * @param {string} xpath - The XPath string itself (for generic penalty).
 * @returns {number} - The calculated score. Returns 0 if it fails basic criteria.
 */
const scoreElement = (elementDetails, totalElementsFoundByXPath, xpath) => {
  if (!elementDetails || !elementDetails.descendantCounts) {
    console.warn(`Scoring: Missing element details or descendantCounts for ${xpath}. Cannot score.`);
    return 0; // Cannot score properly
  }

  let score = 0;
  const { tagName, id, className, descendantCounts, textContent, innerHTML, totalDescendantElements } = elementDetails;

  const pCount = descendantCounts['p'] || 0;
  const unwantedCount = UNWANTED_TAGS.reduce((sum, tag) => sum + (descendantCounts[tag] || 0), 0);
  const linkCount = descendantCounts['a'] || 0;
  const mediaCount = (descendantCounts['img'] || 0) + (descendantCounts['video'] || 0) + (descendantCounts['audio'] || 0) + (descendantCounts['picture'] || 0);

  // Must meet minimum paragraph threshold
  if (pCount < MIN_PARAGRAPH_THRESHOLD) {
    console.log(`Scoring: ${xpath} failed min paragraph threshold (${pCount} < ${MIN_PARAGRAPH_THRESHOLD}). Score: 0`);
    return 0;
  }

  // Add score based on paragraph count
  score += pCount * SCORE_WEIGHTS.paragraphCount;
  console.log(`Scoring: ${xpath} - Paragraphs (${pCount}): +${pCount * SCORE_WEIGHTS.paragraphCount}`);


  // Penalize for unwanted content inside (proportional to ratio of unwanted to *all* descendants)
  if (totalDescendantElements > 0 && unwantedCount > 0) {
      const unwantedRatio = unwantedCount / totalDescendantElements; // Ratio to ALL descendants
      const penalty = unwantedRatio * SCORE_WEIGHTS.unwantedPenaltyRatio;
      score += penalty;
      console.log(`Scoring: ${xpath} - Unwanted tags ratio to total elements (${unwantedRatio.toFixed(2)}): ${penalty.toFixed(2)}`);
  } else if (unwantedCount > 0) {
       // Fallback if totalDescendantElements is 0 but unwantedCount > 0 (unlikely but safe)
       score += unwantedCount * SCORE_WEIGHTS.unwantedPenaltyRatio; // Apply fixed penalty per tag
       console.log(`Scoring: ${xpath} - Unwanted tags (${unwantedCount}, total elements 0): ${unwantedCount * SCORE_WEIGHTS.unwantedPenaltyRatio}`);
  }


  // Bonus for semantic tags
  if (tagName === 'ARTICLE' || tagName === 'MAIN') {
    score += SCORE_WEIGHTS.isSemanticTag;
    console.log(`Scoring: ${xpath} - Semantic tag (${tagName}): +${SCORE_WEIGHTS.isSemanticTag}`);
  }

  // Bonus for descriptive ID or class names
  const descriptiveRegex = /article|content|body|story|main|post/i;
  if ((id && descriptiveRegex.test(id)) || (className && descriptiveRegex.test(className))) {
    score += SCORE_WEIGHTS.hasDescriptiveIdOrClass;
    console.log(`Scoring: ${xpath} - Descriptive ID/Class: +${SCORE_WEIGHTS.hasDescriptiveIdOrClass}`);
  }

  // Add score based on text density
  if (innerHTML && innerHTML.length > 0) {
      // Calculate text density (ratio of text length to total HTML length)
      // Use textContent for plain text length, innerHTML for total HTML length
      const plainText = textContent.trim();
      const htmlLength = innerHTML.length;
      const textLength = plainText.length;

      if (htmlLength > 0) {
          const textDensity = textLength / htmlLength;
          const densityBonus = textDensity * SCORE_WEIGHTS.textDensity;
          score += densityBonus;
          console.log(`Scoring: ${xpath} - Text Density (${textDensity.toFixed(2)}): +${densityBonus.toFixed(2)}`);
      } else {
          console.log(`Scoring: ${xpath} - innerHTML length is 0, cannot calculate text density.`);
      }
  } else {
      console.log(`Scoring: ${xpath} - innerHTML is null or empty, cannot calculate text density.`);
  }


  // Penalize for link density
  if (totalDescendantElements > 0 && linkCount > 0) {
      const linkDensity = linkCount / totalDescendantElements;
      const linkPenalty = linkDensity * SCORE_WEIGHTS.linkDensityPenalty;
      score += linkPenalty;
      console.log(`Scoring: ${xpath} - Link Density (${linkDensity.toFixed(2)}): ${linkPenalty.toFixed(2)}`);
  } else if (linkCount > 0) {
       console.log(`Scoring: ${xpath} - Link count > 0 but total descendant elements is 0. Cannot calculate link density.`);
  }


  // Bonus for media presence
  if (mediaCount > 0) {
      score += SCORE_WEIGHTS.mediaPresence;
      console.log(`Scoring: ${xpath} - Media Presence (${mediaCount}): +${SCORE_WEIGHTS.mediaPresence}`);
  }

  // Penalize for XPath complexity (simple metric: number of slashes + number of predicates)
  const xpathComplexity = xpath.split('/').length + (xpath.match(/\[.*?\]/g) || []).length;
  const complexityPenalty = xpathComplexity * SCORE_WEIGHTS.xpathComplexityPenalty;
  score += complexityPenalty;
  console.log(`Scoring: ${xpath} - XPath Complexity (${xpathComplexity}): ${complexityPenalty.toFixed(2)}`);


  // Apply bonus/penalty based on the number of elements found by the XPath
  const isSingleElement = totalElementsFoundByXPath === 1;
  if (isSingleElement) {
    score += SCORE_WEIGHTS.isSingleElement;
    console.log(`Scoring: ${xpath} - Single element bonus: +${SCORE_WEIGHTS.isSingleElement}`);
  } else {
    console.log(`Validation: XPath "${xpath}" found ${totalElementsFoundByXPath} elements (not single).`);
  }


  console.log(`Scoring: ${xpath} - Final Score: ${score.toFixed(2)}`); // Format score for logging
  return score;
};


/**
 * Calls the LLM API (OpenRouter/OpenAI format) to get candidate XPaths.
 * Instructs the LLM to return a JSON array of strings.
 * Includes logic to handle markdown code block wrapping.
 * Can include feedback from previous attempts.
 * @param {string} htmlContent - The full HTML of the page.
 * @param {string[]} anchorSnippets - Text snippets from the article body.
 * @param {Array<{xpath: string, result: string}>} [feedback=[]] - Optional feedback from previous validation attempts.
 * @returns {Promise<string[]>} - Array of candidate XPaths from the LLM.
 */
const getLlmCandidateXPaths = async (htmlContent, anchorSnippets, feedback = []) => {
  console.log('[LLM API] Requesting candidate XPaths from OpenRouter...');

  // Craft the prompt for the LLM
  let prompt = `Analyze the following HTML source code from a webpage.
    Identify the HTML element (and provide its XPath) that appears to contain the main body content, such as the primary narrative, text paragraphs, images, and embedded media, but excluding surrounding elements like navigation, sidebars, headers, footers, comment sections, and related stories.
    Look for common patterns like <article>, <main>, or div elements with classes/IDs like 'article-body', 'main-content', 'story-text', 'post-content', 'entry-content', 'body-content', etc.
    Prioritize finding a minimal container that wraps the core content accurately.`;

  if (anchorSnippets && anchorSnippets.length > 0) {
    prompt += `\nConsider that the main content likely contains text similar to these snippets: ${JSON.stringify(anchorSnippets)}.`;
  } else {
    prompt += `\nCould not extract specific text snippets, rely on structural and semantic analysis.`;
  }

  if (feedback && feedback.length > 0) {
    prompt += `\n\nPrevious attempts to validate XPaths failed. Here is the feedback on the XPaths tried:`;
    feedback.forEach(item => {
      prompt += `\n- XPath "${item.xpath}": ${item.result}`;
    });
    prompt += `\nPlease suggest *alternative* and potentially more accurate XPaths based on this feedback. Avoid suggesting XPaths that resulted in 0 elements or were too broad/incorrectly scored based on the feedback.`;
  } else {
    prompt += `\n\nProvide a list of the most likely candidate XPaths, ordered by confidence.`;
  }


  prompt += `\n**IMPORTANT:** Respond ONLY with a JSON array of strings, where each string is a candidate XPath. Do not include any other text, explanation, or formatting outside the JSON array. Example: ["//div[@class='article-body']", "//main/article"].`;

  try {
    const response = await axios.post(LLM_CHAT_COMPLETIONS_ENDPOINT, {
      model: LLM_MODEL, // Use model from environment variable
      messages: [
        { role: "system", content: "You are a helpful assistant that analyzes HTML and provides XPaths in a specific JSON format. You MUST adhere to the requested JSON output format and include no other text." }, // Added stronger system instruction
        { role: "user", content: prompt + "\n\nHTML:\n" + htmlContent } // Include HTML in the user message
      ],
      // Optional: Adjust max_tokens if needed, but LLM should be concise
      // max_tokens: 500,
      // Optional: Adjust temperature for creativity vs determinism
      // temperature: 0.1,
      // OpenRouter specific options (optional, might help with formatting)
      // route: 'passthrough', // Sometimes helps prevent reformatting
    }, {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost', // Or your application's URL
        'Content-Type': 'application/json'
      }
    });

    // Parse the response
    if (!response.data || !response.data.choices || response.data.choices.length === 0) {
      console.warn('[LLM API] LLM response missing choices or content.');
      console.warn('[LLM API] Response data:', response.data);
      return [];
    }

    const llmResponseContent = response.data.choices[0].message.content;
    console.log('[LLM API] Received response content.');
    // console.log('[LLM API] Raw response content:', llmResponseContent); // Uncomment to see raw LLM output

    let contentToParse = llmResponseContent;

    // --- Handle markdown code block wrapping ---
    // This regex looks for ```json followed by anything (non-greedily) until ```
    const jsonCodeBlockRegex = /^```json\s*\n([\s\S]*?)\n```$/;
    const match = contentToParse.match(jsonCodeBlockRegex);

    if (match && match[1]) {
      // If it matches, extract the content inside the code block
      console.log('[LLM API] Detected JSON wrapped in markdown code block. Extracting...');
      contentToParse = match[1];
    } else {
      console.log('[LLM API] Content does not appear to be wrapped in a markdown code block. Attempting direct parse.');
    }
    // --- END NEW LOGIC ---


    try {
      // Attempt to parse the (potentially extracted) content
      const candidateXPaths = JSON.parse(contentToParse);

      if (Array.isArray(candidateXPaths) && candidateXPaths.every(item => typeof item === 'string')) {
        console.log(`[LLM API] Parsed ${candidateXPaths.length} candidate XPaths.`);
        return candidateXPaths;
      } else {
        console.error('[LLM API] Parsed content is not a valid JSON array of strings.');
        console.error('[LLM API] Content:', contentToParse); // Log the content *after* potential extraction
        return []; // Return empty array if parsing results in wrong type
      }
    } catch (parseError) {
      console.error('[LLM API] Failed to parse JSON from LLM response:', parseError.message);
      console.error('[LLM API] Content that failed parsing:', contentToParse); // Log the content *after* potential extraction
      return []; // Return empty array if JSON parsing fails
    }

  } catch (error) {
    console.error(`[LLM API] Error calling OpenRouter API: ${error.message}`);
    // Log more details for API errors
    if (error.response) {
      console.error('[LLM API] Response Status:', error.response.status);
      console.error('[LLM API] Response Data:', error.response.data);
    }
    return [];
  }
};

/**
 * Saves the provided HTML content to a file in a designated directory.
 * Filename is generated based on the URL and a timestamp/hash.
 * @param {string} url - The original URL.
 * @param {string} htmlContent - The HTML content to save.
 */
const saveHtmlOnFailure = async (url, htmlContent) => {
    if (!htmlContent) {
        console.warn('[Save HTML] No HTML content to save.');
        return;
    }

    try {
        // Ensure the directory exists
        await fs.promises.mkdir(FAILED_HTML_DIR, { recursive: true });

        // Create a simple hash of the URL for a more stable filename part
        const urlHash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
        const timestamp = new Date().toISOString().replace(/[:.-]/g, '_');
        const filename = `failed_${timestamp}_${urlHash}.html`;
        const filePath = path.join(FAILED_HTML_DIR, filename);

        await fs.promises.writeFile(filePath, htmlContent, 'utf8');
        console.log(`[Save HTML] Successfully saved HTML for ${url} to ${filePath}`);
    } catch (error) {
        console.error(`[Save HTML] Failed to save HTML for ${url}: ${error.message}`);
    }
};


// --- Main Algorithm Function ---

/**
 * Finds the best XPath for the main article content on a given URL.
 * Launches and controls Puppeteer directly.
 * @param {string} url - The URL of the news article page.
 * @param {boolean} debug - Enable debug logging.
 * @returns {Promise<string|null>} - The best XPath found, or null if none satisfactory.
 */
const findArticleXPath = async (url, debug = false) => {
  console.log(`--- Starting XPath discovery for: ${url} ---`);

  let browser = null;
  let userDataDir = null;
  let page = null;
  let htmlContent = null; // Declare htmlContent here so it's available in finally block
  let bestCandidateXPath = null; // Declare bestCandidateXPath here

  try {
    // 1. Launch Puppeteer Browser (using the provided logic)
    const launchResult = await launchPuppeteerBrowser(debug);
    browser = launchResult.browser;
    userDataDir = launchResult.userDataDir;
    page = await browser.newPage();

    // 2. Navigate and Prepare Page (using the provided logic)
    await navigateAndPreparePage(page, url, debug);

    // 3. Get Full HTML
    htmlContent = await getHtmlContent(page); // Assign to the outer htmlContent
    if (!htmlContent) {
      console.error('Failed to get HTML content. Aborting.');
      return null;
    }

    // 4. Extract Anchor Snippets (using direct Puppeteer calls)
    const anchorSnippets = await extractArticleSnippets(page);
    if (anchorSnippets.length === 0) {
      console.warn('Could not extract any text snippets. LLM might have less context.');
    }

    let allTriedXPaths = new Set();
    let feedbackForLLM = [];


    // 5. LLM Interaction Loop
    for (let retry = 0; retry <= MAX_LLM_RETRIES; retry++) {
      console.log(`\n--- LLM Interaction Attempt ${retry + 1}/${MAX_LLM_RETRIES + 1} ---`);

      // Get candidate XPaths from LLM (provide feedback on retries)
      const llmCandidateXPaths = await getLlmCandidateXPaths(
        htmlContent,
        anchorSnippets,
        retry > 0 ? feedbackForLLM : [] // Provide feedback only on retry attempts
      );

      if (llmCandidateXPaths.length === 0) {
        console.warn(`LLM did not return any candidate XPaths on attempt ${retry + 1}.`);
        if (retry === MAX_LLM_RETRIES) {
          console.error('Max LLM retries reached. Aborting.');
          break; // Exit loop if max retries reached
        }
        // If no candidates, nothing to validate, continue to next retry
        continue;
      }

      // Filter out XPaths we've already tried in previous attempts
      const newCandidateXPaths = llmCandidateXPaths.filter(xpath => !allTriedXPaths.has(xpath));

      if (newCandidateXPaths.length === 0) {
        console.warn(`LLM returned only XPaths that have already been tried. Aborting retry attempts.`);
        break; // Exit loop if LLM is stuck
      }

      console.log(`Validating ${newCandidateXPaths.length} new candidate XPaths in parallel...`);

      // --- Parallel Validation Implementation ---
      const validationPromises = [];
      const xpathsInOrder = []; // Keep track of XPath order for results mapping

      for (const xpath of newCandidateXPaths) {
        allTriedXPaths.add(xpath); // Mark as tried
        xpathsInOrder.push(xpath); // Store XPath for later mapping

        // Create a promise for each validation call
        validationPromises.push(queryXPathWithDetails(page, xpath, TAGS_TO_COUNT));
      }

      // Wait for all validation promises to complete
      const validationResults = await Promise.all(validationPromises);
      // --- End Parallel Validation Implementation ---


      // 6. Process Validation Results and Score Candidates
      const currentAttemptScoredCandidates = [];
      let currentAttemptFeedback = []; // Feedback specific to this attempt's XPaths

      // Iterate through results, which are in the same order as xpathsInOrder
      for (let i = 0; i < validationResults.length; i++) {
        const xpath = xpathsInOrder[i];
        const queryResult = validationResults[i]; // This is the result from queryXPathWithDetails

        if (queryResult.count === 0) {
          console.log(`Validation: XPath "${xpath}" found 0 elements.`);
          currentAttemptFeedback.push({ xpath, result: "Found 0 elements." });
          continue; // XPath didn't match anything
        }

        const totalElementsFound = queryResult.count;
        const firstElementDetails = queryResult.firstElementDetails;

        // Calculate the score for this element
        const score = scoreElement(firstElementDetails, totalElementsFound, xpath);

        if (score > 0) {
          // Found a good candidate!
          currentAttemptScoredCandidates.push({ xpath, score, elementDetails: firstElementDetails });
          console.log(`Validation: XPath "${xpath}" PASSED scoring criteria with score ${score.toFixed(2)}.`); // Format score for logging
        } else {
          // Candidate failed scoring
          console.log(`Validation: XPath "${xpath}" did not meet scoring criteria.`);
          const pCount = firstElementDetails?.descendantCounts?.p || 0;
          const unwantedCount = UNWANTED_TAGS.reduce((sum, tag) => sum + (firstElementDetails?.descendantCounts?.[tag] || 0), 0);
          let failureReason = `Found ${totalElementsFound} elements. Scored ${score.toFixed(2)}.`; // Format score for logging
          if (pCount < MIN_PARAGRAPH_THRESHOLD) {
            failureReason += ` Failed min paragraph threshold (${pCount} < ${MIN_PARAGRAPH_THRESHOLD}).`;
          }
          if (unwantedCount > 0) {
            failureReason += ` Contained ${unwantedCount} unwanted tags.`;
          }
          currentAttemptFeedback.push({ xpath, result: failureReason });
        }
      }

      // Add feedback from this attempt to the overall feedback for the next LLM call
      feedbackForLLM.push(...currentAttemptFeedback);

      // 7. Check if any good candidates were found in this attempt
      if (currentAttemptScoredCandidates.length > 0) {
        // Sort candidates found in this attempt by score descending
        currentAttemptScoredCandidates.sort((a, b) => b.score - a.score);
        bestCandidateXPath = currentAttemptScoredCandidates[0].xpath; // Assign to the outer variable
        console.log(`Found ${currentAttemptScoredCandidates.length} valid candidates in this attempt. Best score: ${currentAttemptScoredCandidates[0].score.toFixed(2)}.`); // Format score for logging
        break; // Found a good candidate, exit the retry loop
      } else {
        console.warn(`No valid candidates found in this attempt.`);
        if (retry === MAX_LLM_RETRIES) {
          console.error('Max LLM retries reached and no valid candidates found.');
          break; // Exit loop if max retries reached
        }
        // If no good candidates, the loop will continue to the next retry
      }
    } // End of LLM Interaction Loop

    // 8. Return the Result
    return bestCandidateXPath;

  } catch (error) {
    console.error('\nAn error occurred during the process:', error);
    // htmlContent might be null if the error happened before fetching HTML
    return null; // Indicate failure
  } finally {
    // 9. Cleanup Resources (Replicated from wrapper)
    console.log('[CLEANUP] Closing resources...');

    // Save HTML on failure if enabled and no XPath was found
    // bestCandidateXPath is now accessible here
    if (!bestCandidateXPath && SAVE_HTML_ON_FAILURE && htmlContent) {
        console.log('[CLEANUP] XPath discovery failed. Saving HTML...');
        await saveHtmlOnFailure(url, htmlContent);
    } else if (bestCandidateXPath && SAVE_HTML_ON_FAILURE) {
        console.log('[CLEANUP] XPath found successfully. Not saving HTML.');
    } else if (!SAVE_HTML_ON_FAILURE) {
        console.log('[CLEANUP] SAVE_HTML_ON_FAILURE is false. Not saving HTML on failure.');
    }


    if (page) {
      try {
        await page.close();
        console.log('[CLEANUP] Page closed.');
      } catch (e) {
        if (debug) console.error('[CLEANUP] Error closing page:', e);
      }
    }
    if (browser) {
      try {
        await browser.close();
        console.log('[CLEANUP] Browser closed.');
      } catch (e) {
        if (debug) console.error('[CLEANUP] Error closing browser:', e);
      }
    }
    if (userDataDir) {
      console.log(`[CLEANUP] Removing user data dir: ${userDataDir}`);
      try {
        if (fs.promises && fs.promises.rm) {
          await fs.promises.rm(userDataDir, { recursive: true, force: true });
        } else {
          fs.rmdirSync(userDataDir, { recursive: true });
        }
        console.log('[CLEANUP] User data dir removed.');
      } catch (err) {
        if (debug) console.error('[CLEANUP] Failed to remove user data dir:', userDataDir, err);
      }
    }
    console.log('[CLEANUP] Cleanup finished.');
  }
};

// --- Example Usage ---

// Set debug to true to see detailed logs from Puppeteer launch and process
// const ENABLE_DEBUG_LOGGING = true; // Now controlled by process.env.DEBUG

// Determine target URL from command line arguments or use default
const DEFAULT_URL = 'https://en.wikipedia.org/wiki/Dark_Enlightenment';
const targetUrl = process.argv[2] || DEFAULT_URL; // process.argv[0] is 'node', process.argv[1] is script path

console.log(`Using target URL: ${targetUrl}`);
if (ENABLE_DEBUG_LOGGING) console.log('Debug logging is enabled.');
if (SAVE_HTML_ON_FAILURE) console.log(`Saving failed HTML dumps to: ${FAILED_HTML_DIR}`);


findArticleXPath(targetUrl, ENABLE_DEBUG_LOGGING)
  .then(xpath => {
    if (xpath) {
      console.log(`\nFinal Result: Successfully found article content XPath: ${xpath}`);
      // You can now use this XPath for subsequent scraping steps
    } else {
      console.error('\nFinal Result: Failed to find a suitable article content XPath.');
    }
  })
  .catch(error => {
    console.error('\nFinal Result: An unhandled error occurred:', error);
  });
