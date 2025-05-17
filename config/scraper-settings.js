// config/scraper-settings.js
import dotenv from 'dotenv';
dotenv.config();

export const scraperSettings = {
  // General settings
  maxLlmRetries: process.env.MAX_LLM_RETRIES ? parseInt(process.env.MAX_LLM_RETRIES, 10) : 2, // Max LLM retries for XPath discovery
  minXpathScoreThreshold: 10, // Minimum score for an XPath to be considered valid
  minParagraphThreshold: 3, // Minimum paragraphs for content to be considered valid
  domComparisonThreshold: process.env.DOM_COMPARISON_THRESHOLD ? parseFloat(process.env.DOM_COMPARISON_THRESHOLD) : 0.60, // For cURL vs Puppeteer DOM similarity (0.0 to 1.0)

  // Puppeteer settings
  puppeteerDefaultTimeout: process.env.PUPPETEER_TIMEOUT ? parseInt(process.env.PUPPETEER_TIMEOUT, 10) : 30000, // 30 seconds
  puppeteerNavigationTimeout: process.env.PUPPETEER_NAV_TIMEOUT ? parseInt(process.env.PUPPETEER_NAV_TIMEOUT, 10) : 60000, // 60 seconds
  puppeteerNetworkIdleTimeout: 5000, // Wait 5s after network becomes idle
  puppeteerPostLoadDelay: 2000, // 2 seconds delay after page load for dynamic content/plugins
  puppeteerInteractionDelay: 2000, // 2 seconds for mouse/scroll interactions
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium', // Path to Chromium executable
  puppeteerHeadlessMode: process.env.PUPPETEER_HEADLESS === 'false' ? false : (process.env.PUPPETEER_HEADLESS === 'new' ? 'new' : true), // true, false, or 'new'

  // Debugging and HTML saving
  debug: process.env.DEBUG === 'true' || false, // For enabling debug features like saving HTML
  saveHtmlOnSuccessNav: process.env.SAVE_HTML_ON_SUCCESS_NAV === 'true' || false, // Save HTML on successful navigation (if debug is true)
  failedHtmlDumpsPath: './failed_html_dumps', // Relative to project root
  successHtmlDumpsPath: './success_html_dumps', // Relative to project root for successful scrapes
  knownSitesStoragePath: './data/known_sites_storage.json', // Relative to project root (Note: data/ is in .gitignore by default)

  // DOM Structure Extraction for LLM settings
  domStructureMaxTextLength: process.env.DOM_STRUCTURE_MAX_TEXT_LENGTH ? parseInt(process.env.DOM_STRUCTURE_MAX_TEXT_LENGTH, 10) : 15, // Max text length to keep per node in simplified DOM
  domStructureMinTextSizeToAnnotate: process.env.DOM_STRUCTURE_MIN_TEXT_SIZE_TO_ANNOTATE ? parseInt(process.env.DOM_STRUCTURE_MIN_TEXT_SIZE_TO_ANNOTATE, 10) : 100, // Min text size in an element to add data-original-text-length attribute

  // Weights for scoring XPath candidates (adjust these based on testing)
  scoreWeights: {
    isSingleElement: 20,        // Bonus if XPath uniquely identifies one element
    paragraphCount: 2,          // Points per <p> tag
    unwantedPenaltyRatio: -75,  // Penalty proportional to ratio of unwanted tags to total descendants
    isSemanticTag: 15,          // Bonus for <article> or <main>
    hasDescriptiveIdOrClass: 10,// Bonus for general descriptive IDs/classes (e.g., "content", "article")
    textDensity: 30,            // Bonus for high text-to-HTML ratio (e.g., 30 * text_density_score)
    linkDensityPenalty: -40,    // Penalty for too many links (e.g., -40 * link_density_score)
    mediaPresence: 5,           // Small bonus for <img> or <video>
    xpathComplexityPenalty: -0.5, // Small penalty per XPath segment length (e.g., -0.5 * (xpath.length / 10))

    // New/Enhanced weights from reference/test-find-xpath.js and discussion
    contentSpecificIdBonus: 60,     // Bonus for highly specific content IDs (e.g., "article-content")
    contentSpecificClassBonus: 50,  // Bonus for highly specific content classes (e.g., "entry-content")
    classNameIncludesContentBonus: 30, // Bonus if 'content' is part of a class name
    attributeNameArticleBodyBonus: 70, // Bonus for specific attributes like name="articleBody"
    shallowHierarchyPenalty: -20,   // Penalty for very shallow XPaths (e.g., //main)
  },

  // Keywords for specific scoring bonuses
  // General descriptive keywords (already used)
  descriptiveKeywords: ['article', 'content', 'main', 'body', 'story', 'post', 'entry', 'text', 'copy', 'primary', 'container'],
  // Keywords for contentSpecificIdBonus (can be regex or array)
  contentIdKeywordsRegex: /article-content|content|article-body|main-content|story-content|post-content/i,
  // Keywords for contentSpecificClassBonus (can be regex or array)
  contentClassKeywordsRegex: /article__content|article-content|entry-content|post-body|story-body|content-body|article-body|article__body|article-dropcap|paywall-content/i,


  // Tags considered important for content scoring
  // (ContentScoringEngine defines its own, but this could be centralized if needed)
  // importantContentTags: ['p', 'h1', 'h2', 'h3', 'img', 'video', 'ul', 'ol', 'blockquote', 'figure', 'figcaption'],

  // Tags often indicating non-main content, used for penalty calculation
  // (ContentScoringEngine defines its own)
  // unwantedContentTags: ['nav', 'footer', 'aside', 'header', 'form', 'script', 'style', 'figcaption', 'figure', 'details', 'summary', 'menu', 'dialog'],
};

export const llmConfig = {
  apiKey: process.env.OPENROUTER_API_KEY,
  model: process.env.LLM_MODEL || 'meta-llama/llama-3-8b-instruct:free', // Default if not set
  chatCompletionsEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
  temperature: process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : 0, // Default to 0 for deterministic output
};

export const captchaSolverConfig = {
  apiKey: process.env.TWOCAPTCHA_API_KEY,
  service: process.env.CAPTCHA_SERVICE_NAME || '2captcha', // Default service
  // dataDomeDomains: (process.env.DATADOME_DOMAINS || '').split(',').map(d => d.trim()).filter(d => d),
  // Endpoints for 2Captcha
  twoCaptchaInUrl: 'https://2captcha.com/in.php',
  twoCaptchaResUrl: 'https://2captcha.com/res.php',
  // Endpoints for DataDome specific tasks (if different, usually same as above for 2captcha)
  dataDomeCreateTaskUrl: 'https://api.2captcha.com/createTask',
  dataDomeGetResultUrl: 'https://api.2captcha.com/getTaskResult',
  defaultTimeout: 120, // Default timeout for polling CAPTCHA solution in seconds
  pollingInterval: 5000, // Interval in ms to poll for CAPTCHA solution
  postCaptchaSubmitDelay: 5000, // ms to wait after submitting a CAPTCHA solution
};

export const proxyConfig = {
  httpProxy: process.env.HTTP_PROXY || null, // e.g., http://username:password@proxy.example.com:8080
};

export const allConfigs = {
  scraper: scraperSettings,
  llm: llmConfig,
  captchaSolver: captchaSolverConfig,
  proxy: proxyConfig,
};
