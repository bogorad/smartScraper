// config/scraper-settings.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env') }); // Ensure .env is loaded relative to project root

const scraperSettings = {
  // General settings
  maxLlmRetries: process.env.MAX_LLM_RETRIES ? parseInt(process.env.MAX_LLM_RETRIES, 10) : 2,
  minXpathScoreThreshold: process.env.MIN_XPATH_SCORE_THRESHOLD ? parseFloat(process.env.MIN_XPATH_SCORE_THRESHOLD) : 10,
  domComparisonThreshold: process.env.DOM_COMPARISON_THRESHOLD ? parseFloat(process.env.DOM_COMPARISON_THRESHOLD) : 0.60,
  knownSitesStoragePath: process.env.KNOWN_SITES_STORAGE_PATH || './data/known_sites_storage.json', // Default path

  // Puppeteer settings
  puppeteerHeadless: process.env.PUPPETEER_HEADLESS ? (process.env.PUPPETEER_HEADLESS === 'true' ? true : process.env.PUPPETEER_HEADLESS === 'false' ? false : 'new') : 'new',
  puppeteerDefaultTimeout: process.env.PUPPETEER_TIMEOUT ? parseInt(process.env.PUPPETEER_TIMEOUT, 10) : 30000,
  puppeteerNavigationTimeout: process.env.PUPPETEER_NAV_TIMEOUT ? parseInt(process.env.PUPPETEER_NAV_TIMEOUT, 10) : 60000,
  puppeteerLaunchTimeout: process.env.PUPPETEER_LAUNCH_TIMEOUT ? parseInt(process.env.PUPPETEER_LAUNCH_TIMEOUT, 10) : 60000,
  puppeteerPostLoadDelay: process.env.PUPPETEER_POST_LOAD_DELAY ? parseInt(process.env.PUPPETEER_POST_LOAD_DELAY, 10) : 2000,
  puppeteerInteractionDelay: process.env.PUPPETEER_INTERACTION_DELAY ? parseInt(process.env.PUPPETEER_INTERACTION_DELAY, 10) : 1000,
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
  extensionPaths: process.env.EXTENSION_PATHS ? process.env.EXTENSION_PATHS.split(',') : [],
  puppeteerViewport: {
    width: process.env.PUPPETEER_VIEWPORT_WIDTH ? parseInt(process.env.PUPPETEER_VIEWPORT_WIDTH, 10) : 1920,
    height: process.env.PUPPETEER_VIEWPORT_HEIGHT ? parseInt(process.env.PUPPETEER_VIEWPORT_HEIGHT, 10) : 1080,
  },

  // HTTP Proxy settings
  httpProxy: process.env.HTTP_PROXY || null, 

  // Debugging and HTML saving
  debug: (process.env.LOG_LEVEL || 'INFO').toUpperCase() === 'DEBUG',
  saveHtmlOnSuccessNav: process.env.SAVE_HTML_ON_SUCCESS_NAV === 'true', 
  htmlSuccessDumpPath: process.env.HTML_SUCCESS_DUMP_PATH || './success_html_dumps',
  htmlFailureDumpPath: process.env.HTML_FAILURE_DUMP_PATH || './failed_html_dumps',

  // DOM Structure Extraction for LLM settings
  domStructureMaxTextLength: process.env.DOM_STRUCTURE_MAX_TEXT_LENGTH ? parseInt(process.env.DOM_STRUCTURE_MAX_TEXT_LENGTH, 10) : 15,
  domStructureMinTextSizeToAnnotate: process.env.DOM_STRUCTURE_MIN_TEXT_SIZE_TO_ANNOTATE ? parseInt(process.env.DOM_STRUCTURE_MIN_TEXT_SIZE_TO_ANNOTATE, 10) : 100,

  // Default User Agent
  defaultUserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

  // Content Scoring Weights
  scoreWeights: {
    isSingleElement: 20,
    paragraphCount: 2,
    contentSpecificIdBonus: 50,
    contentSpecificClassBonus: 40,
    classNameIncludesContentBonus: 20,
    attributeNameBonus: 15, 
    shallowHierarchyPenalty: -30, 
    textDensity: 30,
    linkDensityPenaltyFactor: -40, 
    mediaPresenceBonus: 5, 
    unwantedTagPenalty: -10, 
    xpathDepthBonus: 1, 
    hasDescriptiveIdOrClass: 25, 
  },
  minParagraphThreshold: 3,
  descriptiveKeywords: [ 
    'article', 'content', 'main', 'story', 'post', 'body', 'text', 'entry', 'blog', 'news', 'paywall'
  ],
  contentIdKeywordsRegex: /(article|content|main|story|post|blog|body|container)/i,
  contentClassKeywordsRegex: /(article|content|main|story|post|body|text|entry|blog|news|paywall|wrap|inner|container)/i,
  rejectUnauthorizedTLS: process.env.REJECT_UNAUTHORIZED_TLS !== 'false', 
  curlTimeout: process.env.CURL_TIMEOUT ? parseInt(process.env.CURL_TIMEOUT, 10) : 30000,
};

export default scraperSettings;
