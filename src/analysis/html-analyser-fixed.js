// src/analysis/html-analyser-fixed.js
import { JSDOM } from 'jsdom';
import { logger } from '../utils/logger.js';
import { ExtractionError } from '../utils/error-handler.js';
import { scraperSettings } from '../../config/index.js'; // For new DOM structure config

// Pre-compiled regex for CAPTCHA markers for efficiency if used frequently
const CAPTCHA_KEYWORDS_REGEX = /captcha|verify|human|challenge/i;
const CAPTCHA_IFRAME_SRC_REGEX = /recaptcha|hcaptcha|turnstile|captcha-delivery\.com|geo\.captcha-delivery\.com/i;
const CAPTCHA_SELECTORS = [
  '.g-recaptcha', // reCAPTCHA v2
  '.h-captcha',   // hCaptcha
  '.cf-turnstile' // Cloudflare Turnstile
];
const DATADOME_MARKERS = [
  'datadome',
  'captcha-delivery.com',
  'geo.captcha-delivery.com',
  'checking browser',
  'please enable js and disable any ad blocker'
];

class HtmlAnalyserFixed {
  constructor() {
    // Initialization, if any, can go here.
    // For example, pre-compiling regexes if they become complex.
    logger.info('HtmlAnalyserFixed initialized.');
  }

  /**
   * Extracts short text snippets from the HTML for LLM context.
   * @param {string} htmlString - The HTML content as a string.
   * @param {number} maxSnippets - Maximum number of snippets to extract.
   * @param {number} snippetMaxLength - Maximum length of each snippet.
   * @returns {string[]} An array of text snippets.
   */
  extractArticleSnippets(htmlString, maxSnippets = 10, snippetMaxLength = 150) {
    if (typeof htmlString !== 'string' || !htmlString.trim()) {
      logger.warn('extractArticleSnippets: htmlString is invalid.');
      throw new ExtractionError('Invalid HTML string for snippet extraction', {
        htmlProvided: typeof htmlString === 'string' ? (htmlString.length > 0 ? 'Non-empty' : 'Empty') : 'Not a string'
      });
    }

    const snippets = [];
    try {
      const dom = new JSDOM(htmlString);
      const { document } = dom.window;

      // Prioritize common content tags
      const selectors = ['article', 'main', 'p', 'h1', 'h2', 'h3', 'div']; // Added div as a general container
      for (const selector of selectors) {
        if (snippets.length >= maxSnippets) break;
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (snippets.length >= maxSnippets) break;
          // Basic visibility check (heuristic)
          if (element.closest('nav, footer, aside, form, script, style')) {
            continue;
          }
          const text = (element.textContent || '').trim().replace(/\s+/g, ' ');
          if (text.length > 20) { // Only consider reasonably long snippets
            snippets.push(text.substring(0, snippetMaxLength) + (text.length > snippetMaxLength ? '...' : ''));
          }
        }
      }
      logger.debug(`Extracted ${snippets.length} snippets.`);
    } catch (error) {
      logger.error(`Error extracting snippets: ${error.message}`);
      throw new ExtractionError('Failed to extract snippets from HTML', {
        originalError: error.message,
        htmlSnippet: htmlString.substring(0, 200)
      });
    }
    return snippets;
  }

  /**
   * Detects common CAPTCHA markers in the HTML content.
   * @param {string} htmlString - The HTML content as a string.
   * @returns {boolean} True if CAPTCHA markers are found, false otherwise.
   */
  detectCaptchaMarkers(htmlString) {
    if (typeof htmlString !== 'string' || !htmlString.trim()) {
      logger.warn('detectCaptchaMarkers: htmlString is invalid.');
      return false; // Or throw, depending on desired strictness
    }

    const lowerHtml = htmlString.toLowerCase(); // For case-insensitive keyword search

    // 1. Check for keywords in the raw HTML
    if (CAPTCHA_KEYWORDS_REGEX.test(lowerHtml)) {
      logger.info(`CAPTCHA marker found (keyword): ${CAPTCHA_KEYWORDS_REGEX.source}`);
      return true;
    }

    // 2. Check for DataDome specific markers
    if (DATADOME_MARKERS.some(marker => lowerHtml.includes(marker))) {
      logger.info('DataDome CAPTCHA marker found in HTML');
      return true;
    }

    // 3. Parse HTML and check for iframe sources and specific selectors
    try {
      const dom = new JSDOM(htmlString);
      const { document } = dom.window;

      // Check iframe sources
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        const src = iframe.getAttribute('src');
        if (src && CAPTCHA_IFRAME_SRC_REGEX.test(src.toLowerCase())) {
          logger.info(`CAPTCHA marker found (iframe src): ${src}`);
          return true;
        }
      }

      // Check for common CAPTCHA-related selectors
      for (const selector of CAPTCHA_SELECTORS) {
        if (document.querySelector(selector)) {
          logger.info(`CAPTCHA marker found (selector): ${selector}`);
          return true;
        }
      }
    } catch (error) {
      logger.warn(`Error parsing HTML for CAPTCHA iframe/selector detection: ${error.message}. Regex on raw HTML will be primary.`);
      // Fallback to regex on raw HTML already done, so no further action here.
    }

    logger.debug('No CAPTCHA markers detected.');
    return false;
  }

  /**
   * Extracts innerHTML of the first element matching an XPath from static HTML.
   * Uses document.evaluate instead of xpath.select for better compatibility.
   * @param {string} htmlString - The HTML content as a string.
   * @param {string} xpathExpression - The XPath expression.
   * @returns {string|null} The innerHTML of the matched element or null.
   */
  extractByXpath(htmlString, xpathExpression) {
    if (!htmlString || !xpathExpression) {
      logger.error('Missing HTML or XPath for extraction.');
      throw new ExtractionError('Missing HTML or XPath for extraction', {
        htmlProvided: !!htmlString,
        xpathProvided: !!xpathExpression
      });
    }

    try {
      const dom = new JSDOM(htmlString);
      const { document, XPathResult } = dom.window;

      // Use document.evaluate instead of xpath.select
      const xpathResult = document.evaluate(
        xpathExpression,
        document,
        null, // namespaceResolver
        XPathResult.FIRST_ORDERED_NODE_TYPE, // resultType
        null  // result
      );

      const firstNode = xpathResult.singleNodeValue;

      if (firstNode) {
        // Check if it's an Element node, which has innerHTML
        if (firstNode.nodeType === dom.window.Node.ELEMENT_NODE) {
          logger.debug(`Element found with XPath: ${xpathExpression}. Extracting innerHTML.`);
          return firstNode.innerHTML;
        } else {
          logger.warn(`XPath "${xpathExpression}" matched a non-element node (type: ${firstNode.nodeType}). Cannot get innerHTML.`);
          return null;
        }
      } else {
        // If we get here, no content was found with the XPath
        logger.warn(`XPath "${xpathExpression}" did not match any element.`);
        // Consider if this should be an error or just return null
        // For now, align with previous behavior of throwing if no content.
        throw new ExtractionError('XPath did not match any element with content', {
            xpath: xpathExpression,
            htmlSnippet: htmlString.substring(0, 200)
        });
      }
    } catch (error) {
      if (error instanceof ExtractionError) { // If it's already an ExtractionError, just re-throw it
        throw error;
      }
      logger.error(`Error extracting by XPath "${xpathExpression}" from static HTML: ${error.message}`);
      throw new ExtractionError('Error applying XPath to HTML', {
        xpath: xpathExpression,
        originalError: error.message,
        htmlSnippet: htmlString.substring(0, 200)
      });
    }
  }

  /**
   * Queries static HTML using XPath and gathers details about the first matched element.
   * Uses document.evaluate instead of xpath.select for better compatibility.
   * @param {string} htmlString - The HTML content.
   * @param {string} xpathExpression - The XPath to evaluate.
   * @returns {object|null} An object with details or null if no match/error.
   *                        Details include: xpath, element_found_count, tagName, id, className,
   *                                         textContentLength, innerHTMLSnippet, innerHTML (full),
   *                                         paragraphCount, linkCount, imageCount, totalDescendantElements.
   */
  queryStaticXPathWithDetails(htmlString, xpathExpression) {
    const result = {
      xpath: xpathExpression,
      element_found_count: 0,
      tagName: null,
      id: null,
      className: null,
      textContentLength: 0,
      innerHTMLSnippet: '',
      innerHTML: '', // Added to store full innerHTML
      paragraphCount: 0,
      linkCount: 0,
      imageCount: 0,
      totalDescendantElements: 0,
    };

    if (!htmlString || !xpathExpression) {
      logger.error('Missing HTML or XPath for queryStaticXPathWithDetails.');
      // Potentially throw an error or return the empty result object
      return result;
    }

    try {
      const dom = new JSDOM(htmlString);
      const { document, XPathResult } = dom.window;

      const snapshot = document.evaluate(xpathExpression, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      result.element_found_count = snapshot.snapshotLength;

      if (result.element_found_count > 0) {
        const firstElement = snapshot.snapshotItem(0);

        // Ensure it's an Element node
        if (firstElement && firstElement.nodeType === dom.window.Node.ELEMENT_NODE) {
          result.tagName = firstElement.tagName ? firstElement.tagName.toLowerCase() : null;
          result.id = firstElement.getAttribute('id') || null;
          result.className = firstElement.getAttribute('class') || null;

          const textContent = firstElement.textContent || '';
          result.textContentLength = textContent.trim().length;

          const innerHTML = firstElement.innerHTML || '';
          result.innerHTML = innerHTML; // Store full innerHTML
          result.innerHTMLSnippet = innerHTML.substring(0, 200) + (innerHTML.length > 200 ? '...' : '');

          // Count descendants using document.evaluate for consistency or querySelectorAll
          const countXPath = (xpath) => {
            try {
              const countResult = document.evaluate(
                `count(${xpath})`, // Relative XPath from the current element
                firstElement, // Context node is the firstElement
                null,
                XPathResult.NUMBER_TYPE,
                null
              );
              return countResult.numberValue || 0;
            } catch (e) {
              logger.warn(`Error counting with XPath "${xpath}" relative to element: ${e.message}`);
              return 0; // Fallback
            }
          };
          // Or using querySelectorAll for simplicity if complex relative XPaths are not needed
          result.paragraphCount = firstElement.querySelectorAll('p').length;
          result.linkCount = firstElement.querySelectorAll('a').length;
          result.imageCount = firstElement.querySelectorAll('img').length;
          // video, audio, picture can be added if needed for mediaPresence score
          result.totalDescendantElements = firstElement.querySelectorAll('*').length;

        } else {
          logger.warn(`XPath "${xpathExpression}" matched a non-element node as the first item.`);
          // Result count is still valid, but element details are not applicable.
        }
      }
    } catch (error) {
      logger.warn(`Error querying static XPath "${xpathExpression}": ${error.message}`);
      // In case of error, return the partial result (e.g., count might be 0)
      // Optionally, wrap this in an ExtractionError if it's critical
      const extractionError = new ExtractionError(`Error querying static XPath "${xpathExpression}"`, {
        originalError: error.message,
        xpath: xpathExpression,
        htmlSnippet: htmlString.substring(0, 200),
        partialResult: result // Attach the partial result
      });
      // For now, let's log and return the partial result. The caller can decide if it's fatal.
      logger.error(extractionError.message, extractionError.details);
    }
    return result;
  }

  /**
   * Extracts the DOM structure from HTML content, preserving tags and attributes but minimizing text content.
   * Adds annotations about original text size for each element.
   * Adapted from reference/test-find-xpath.js.
   * @param {string} htmlContent - The full HTML content
   * @param {number} [maxTextLength=scraperSettings.domStructureMaxTextLength] - Maximum length of text content to keep per node.
   * @param {number} [minTextSizeToAnnotate=scraperSettings.domStructureMinTextSizeToAnnotate] - Minimum text size to add an annotation.
   * @returns {string} - The simplified DOM structure with annotations, or original (truncated) on error.
   */
  extractDomStructure(
    htmlContent,
    maxTextLength = scraperSettings.domStructureMaxTextLength,
    minTextSizeToAnnotate = scraperSettings.domStructureMinTextSizeToAnnotate
  ) {
    if (typeof htmlContent !== 'string' || !htmlContent.trim()) {
      logger.warn('extractDomStructure: htmlContent is invalid.');
      return '';
    }
    try {
      logger.info(`Extracting DOM structure from HTML (${htmlContent.length} bytes)...`);
      const dom = new JSDOM(htmlContent);
      const { document, Node } = dom.window;

      const processNode = (node) => {
        if (node.nodeType === Node.COMMENT_NODE) return '';
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent.trim().replace(/\s+/g, ' ');
          if (text.length === 0) return '';
          return text.length <= maxTextLength ? text : text.substring(0, maxTextLength) + '...';
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
          const tagNameLower = node.tagName.toLowerCase();
          if (tagNameLower === 'script' || tagNameLower === 'style' || tagNameLower === 'noscript' || tagNameLower === 'meta' || tagNameLower === 'link' || tagNameLower === 'head') {
            return '';
          }

          let result = `<${tagNameLower}`;
          const importantAttrs = ['id', 'class', 'role', 'aria-label', 'itemprop', 'data-testid', 'data-component', 'name', 'type', 'href', 'src'];
          for (const attr of node.attributes) {
            if (importantAttrs.includes(attr.name.toLowerCase()) || attr.name.startsWith('data-')) {
              result += ` ${attr.name}="${attr.value.replace(/"/g, '&quot;')}"`;
            }
          }

          const originalTextLength = (node.textContent || '').trim().length;
          if (originalTextLength >= minTextSizeToAnnotate) {
            result += ` data-original-text-length="${originalTextLength}"`;
          }
          result += '>';

          if (originalTextLength >= minTextSizeToAnnotate) {
            const paragraphCount = node.querySelectorAll('p').length;
            const linkCount = node.querySelectorAll('a').length;
            const imageCount = node.querySelectorAll('img').length;
            result += `<!-- Element contains ${originalTextLength} chars of text`;
            if (paragraphCount > 0) result += `, ${paragraphCount} paragraphs`;
            if (linkCount > 0) result += `, ${linkCount} links`;
            if (imageCount > 0) result += `, ${imageCount} images`;
            result += ` -->`;
          }

          for (const child of node.childNodes) {
            result += processNode(child);
          }
          result += `</${tagNameLower}>`;
          return result;
        }
        return '';
      };

      const bodyElement = document.body;
      if (!bodyElement) {
        logger.warn('extractDomStructure: No body element found in HTML. Returning empty string.');
        return '';
      }
      const domStructure = processNode(bodyElement);
      const reduction = htmlContent.length > 0 ? Math.round((1 - domStructure.length / htmlContent.length) * 100) : 0;
      logger.info(`DOM structure extracted (${domStructure.length} bytes, ${reduction}% size reduction)`);
      return domStructure;

    } catch (error) {
      logger.error(`Error extracting DOM structure: ${error.message}`);
      return htmlContent.substring(0, 100000) + '... (original HTML truncated due to error)';
    }
  }


  /**
   * Checks if a DataDome CAPTCHA URL indicates a banned IP
   * @param {string} captchaUrl - The URL of the DataDome CAPTCHA iframe
   * @returns {object} Object with isBanned and reason properties
   */
  checkDataDomeBannedIP(captchaUrl) {
    if (!captchaUrl || typeof captchaUrl !== 'string') {
      return { isBanned: false, reason: 'Invalid CAPTCHA URL provided' };
    }
    try {
      const url = new URL(captchaUrl);
      const tParam = url.searchParams.get('t');

      if (tParam === 'bv') {
        logger.warn('DataDome CAPTCHA URL contains t=bv parameter. This indicates the IP is banned.');
        return { isBanned: true, reason: 't=bv parameter indicates banned IP' };
      }
      if (tParam !== 'fe' && tParam !== null) { // t=fe is normal, null might be before full init
        logger.warn(`DataDome CAPTCHA URL has unusual t parameter: ${tParam}. This might cause issues.`);
        // Not strictly banned, but worth noting.
      }
      return { isBanned: false, reason: `t parameter is '${tParam}'` };
    } catch (error) {
      logger.error(`Error checking DataDome banned IP from URL "${captchaUrl}": ${error.message}`);
      return { isBanned: false, reason: `Error parsing CAPTCHA URL: ${error.message}` };
    }
  }
}

export { HtmlAnalyserFixed };
