// config/scraper-settings.js

const scraperSettings = {
  maxLlmRetries: 3,
  minParagraphThreshold: 3, // Minimum paragraphs for content to be considered valid
  domComparisonThreshold: 0.90, // For cURL vs Puppeteer DOM similarity (0.0 to 1.0)
  puppeteerDefaultTimeout: 30000, // 30 seconds
  puppeteerNavigationTimeout: 60000, // 60 seconds
  puppeteerNetworkIdleTimeout: 5000, // Wait 5s after network becomes idle
  puppeteerPostLoadDelay: 2000, // 2 seconds delay after page load for dynamic content/plugins
  puppeteerInteractionDelay: 2000, // 2 seconds for mouse/scroll interactions
  saveHtmlOnFailure: process.env.SAVE_HTML_ON_FAILURE === 'true' || false, // Default to false
  failedHtmlDumpsPath: './failed_html_dumps', // Relative to project root

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
  tagsToCount: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'video', 'ul', 'ol', 'li', 'blockquote', 'figure', 'figcaption'],
  // Tags often indicating non-main content, used for penalty calculation
  unwantedTags: ['nav', 'footer', 'aside', 'header', 'form', 'script', 'style', 'iframe[src*="ads"]', 'div[class*="ad"]', 'div[id*="ad"]'],
  // Keywords in IDs/classes that suggest main content
  descriptiveIdOrClassKeywords: ['article', 'content', 'main', 'body', 'story', 'post', 'entry', 'text', 'blog'],
};

export { scraperSettings };
