// config/scraper-settings.js
import dotenv from 'dotenv';
dotenv.config();

export const scraperSettings = {
  maxLlmRetries: 3,
  minXpathScoreThreshold: 10, // Minimum score for an XPath to be considered valid
  minParagraphThreshold: 3, // Minimum paragraphs for content to be considered valid
  domComparisonThreshold: 0.60, // For cURL vs Puppeteer DOM similarity (0.0 to 1.0)
  puppeteerDefaultTimeout: 30000, // 30 seconds
  puppeteerNavigationTimeout: 60000, // 60 seconds
  puppeteerNetworkIdleTimeout: 5000, // Wait 5s after network becomes idle
  puppeteerPostLoadDelay: 2000, // 2 seconds delay after page load for dynamic content/plugins
  puppeteerInteractionDelay: 2000, // 2 seconds for mouse/scroll interactions
  puppeteerExecutablePath: process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium', // Path to Chromium executable
  
  debug: process.env.DEBUG === 'true' || false, // For enabling debug features like saving HTML
  saveHtmlOnSuccessNav: process.env.SAVE_HTML_ON_SUCCESS_NAV === 'true' || false, // Save HTML on successful navigation (if debug is true)
  
  failedHtmlDumpsPath: './failed_html_dumps', // Relative to project root
  successHtmlDumpsPath: './success_html_dumps', // Relative to project root for successful scrapes
  knownSitesStoragePath: './known_sites_storage.json', // Relative to project root

  // Weights for scoring XPath candidates (adjust these based on testing)
  scoreWeights: {
    isSingleElement: 20,        // Bonus if XPath uniquely identifies one element
    paragraphCount: 2,          // Points per <p> tag
    unwantedPenaltyRatio: -50,  // Penalty if too many unwanted tags (e.g., -50 * (unwanted_tags / total_tags))
    isSemanticTag: 15,          // Bonus for <article> or <main>
    hasDescriptiveIdOrClass: 10,// Bonus for IDs/classes like "content", "article"
    textDensity: 30,            // Bonus for high text-to-HTML ratio (e.g., 30 * text_density_score)
    linkDensityPenalty: -40,    // Penalty for too many links (e.g., -40 * link_density_score)
    mediaPresence: 5,           // Small bonus for <img> or <video>
    xpathComplexityPenalty: -0.5 // Small penalty per XPath segment length (e.g., -0.5 * (xpath.length / 10))
  },

  // Tags considered important for content scoring
  tagsToCount: ['p', 'h1', 'h2', 'h3', 'img', 'video', 'ul', 'ol', 'blockquote', 'figure', 'figcaption', 'pre', 'code', 'table'],
  // Tags often indicating non-main content, used for penalty calculation
  unwantedTags: ['nav', 'footer', 'aside', 'header', 'form', 'script', 'style', 'noscript', 'iframe', 'link', 'meta', 'button', 'input', 'select', 'textarea', 'label', 'option', 'optgroup', 'fieldset', 'legend', 'details', 'summary', 'dialog'],
  // Keywords in IDs/classes that suggest main content
  descriptiveIdOrClassKeywords: ['article', 'content', 'main', 'body', 'story', 'post', 'entry', 'text', 'container', 'wrapper', 'block', 'component', 'section', 'primary', 'column', 'center', 'middle', 'paywall']
};
