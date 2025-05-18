// config/scraper-settings.ts
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') }); 

export interface ScoreWeights {
  isSingleElement: number;
  paragraphCount: number;
  textDensity: number;
  linkDensityPenaltyFactor: number;
  isSemanticTag: number;
  hasDescriptiveIdOrClass: number; 
  xpathDepthBonus: number;
  mediaPresenceBonus: number;
  unwantedTagPenalty: number;
  contentSpecificIdBonus: number; 
  contentSpecificClassBonus: number; 
  classNameIncludesContentBonus: number; 
  attributeNameBonus: number; 
  shallowHierarchyPenalty: number; 
  minDepthForShallowPenalty: number; 
  [key: string]: number; 
}

export interface PuppeteerViewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  isLandscape?: boolean;
}

export interface ScraperSettings {
  maxLlmRetries: number;
  minXpathScoreThreshold: number;
  domComparisonThreshold: number;
  knownSitesStoragePath: string;
  puppeteerExecutablePath?: string;
  puppeteerHeadless: boolean | 'new';
  puppeteerDefaultTimeout: number;
  puppeteerNavigationTimeout: number;
  puppeteerLaunchTimeout: number;
  puppeteerPostLoadDelay: number;
  puppeteerInteractionDelay: number;
  puppeteerViewport: PuppeteerViewport;
  extensionPaths: string[];
  httpProxy?: string;
  debug: boolean;
  saveHtmlOnSuccessNav: boolean;
  failedHtmlDumpPath: string;
  successHtmlDumpPath: string;
  domStructureMaxTextLength: number;
  domStructureMinTextSizeToAnnotate: number;
  defaultUserAgent: string; // Will be sourced from ENV or fallback
  scoreWeights: ScoreWeights;
  minParagraphThreshold: number;
  descriptiveKeywords: string[];
  contentIdKeywordsRegex: RegExp;
  contentClassKeywordsRegex: RegExp;
  curlTimeout: number;
}

const scraperSettings: ScraperSettings = {
  maxLlmRetries: process.env.MAX_LLM_RETRIES ? parseInt(process.env.MAX_LLM_RETRIES, 10) : 2,
  minXpathScoreThreshold: process.env.MIN_XPATH_SCORE_THRESHOLD ? parseFloat(process.env.MIN_XPATH_SCORE_THRESHOLD) : 10,
  domComparisonThreshold: process.env.DOM_COMPARISON_THRESHOLD ? parseFloat(process.env.DOM_COMPARISON_THRESHOLD) : 0.60,
  knownSitesStoragePath: process.env.KNOWN_SITES_STORAGE_PATH || path.resolve(__dirname, '..', 'data', 'known_sites_storage.json'), 
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  puppeteerHeadless: process.env.PUPPETEER_HEADLESS === 'false' ? false : (process.env.PUPPETEER_HEADLESS === 'new' ? 'new' : true),
  puppeteerDefaultTimeout: process.env.PUPPETEER_TIMEOUT ? parseInt(process.env.PUPPETEER_TIMEOUT, 10) : 30000,
  puppeteerNavigationTimeout: process.env.PUPPETEER_NAV_TIMEOUT ? parseInt(process.env.PUPPETEER_NAV_TIMEOUT, 10) : 60000,
  puppeteerLaunchTimeout: process.env.PUPPETEER_LAUNCH_TIMEOUT ? parseInt(process.env.PUPPETEER_LAUNCH_TIMEOUT, 10) : 60000,
  puppeteerPostLoadDelay: process.env.PUPPETEER_POST_LOAD_DELAY ? parseInt(process.env.PUPPETEER_POST_LOAD_DELAY, 10) : 2000,
  puppeteerInteractionDelay: process.env.PUPPETEER_INTERACTION_DELAY ? parseInt(process.env.PUPPETEER_INTERACTION_DELAY, 10) : 1000,
  puppeteerViewport: {
    width: process.env.PUPPETEER_VIEWPORT_WIDTH ? parseInt(process.env.PUPPETEER_VIEWPORT_WIDTH, 10) : 1920,
    height: process.env.PUPPETEER_VIEWPORT_HEIGHT ? parseInt(process.env.PUPPETEER_VIEWPORT_HEIGHT, 10) : 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    isLandscape: false,
  },
  extensionPaths: process.env.EXTENSION_PATHS ? process.env.EXTENSION_PATHS.split(',') : [],
  httpProxy: process.env.HTTP_PROXY || undefined,
  debug: (process.env.LOG_LEVEL || 'INFO').toUpperCase() === 'DEBUG',
  saveHtmlOnSuccessNav: process.env.SAVE_HTML_ON_SUCCESS_NAV === 'true',
  failedHtmlDumpPath: './failed_html_dumps',
  successHtmlDumpPath: './success_html_dumps',
  domStructureMaxTextLength: process.env.DOM_STRUCTURE_MAX_TEXT_LENGTH ? parseInt(process.env.DOM_STRUCTURE_MAX_TEXT_LENGTH, 10) : 15,
  domStructureMinTextSizeToAnnotate: process.env.DOM_STRUCTURE_MIN_TEXT_SIZE_TO_ANNOTATE ? parseInt(process.env.DOM_STRUCTURE_MIN_TEXT_SIZE_TO_ANNOTATE, 10) : 100,
  defaultUserAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  scoreWeights: {
    isSingleElement: 20,
    paragraphCount: 2,
    textDensity: 30, 
    linkDensityPenaltyFactor: -40, 
    isSemanticTag: 15, 
    hasDescriptiveIdOrClass: 25, 
    xpathDepthBonus: 1, 
    mediaPresenceBonus: 5, 
    unwantedTagPenalty: -10, 
    contentSpecificIdBonus: 50, 
    contentSpecificClassBonus: 40, 
    classNameIncludesContentBonus: 20, 
    attributeNameBonus: 15, 
    shallowHierarchyPenalty: -30, 
    minDepthForShallowPenalty: 3, 
  },
  minParagraphThreshold: 3, 
  descriptiveKeywords: [ 
    'article', 'content', 'main', 'story', 'post', 'body', 'text', 'entry', 'blog', 'news', 'container', 'wrapper', 'paywall'
  ],
  contentIdKeywordsRegex: /^(article|post|story|main)[-_]?(content|body|text|area|container|wrapper)$/i,
  contentClassKeywordsRegex: /^(article|post|story|entry|blog|main|text|news)[-_]?(content|body|text|area|container|wrapper|inner|item|element)|paywall|dropcap/i,
  curlTimeout: process.env.CURL_TIMEOUT ? parseInt(process.env.CURL_TIMEOUT, 10) : 30000,
};

export default scraperSettings;
