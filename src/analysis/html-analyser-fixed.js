// src/analysis/html-analyser-fixed.js
// Enhanced debug logging for success paths.

import { JSDOM } from 'jsdom';
import { logger } from '../utils/logger.js';
import { ExtractionError, ScraperError } from '../utils/error-handler.js';
import { scraperSettings } from '../../config/index.js'; 

const COMMON_CAPTCHA_SELECTORS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '.g-recaptcha',
  '.h-captcha',
  'div[class*="cf-turnstile"]',
  'div[class*="g-recaptcha"]',
  'div[id*="recaptcha"]',
  'div[id*="h-captcha"]',
  'iframe[title*="captcha" i]',
  'iframe[name*="captcha" i]',
];

const COMMON_CAPTCHA_TEXT_MARKERS = [
  /verify you are human/i,
  /prove you are not a robot/i,
  /recaptcha/i,
  /hcaptcha/i,
  /cloudflare/i, // Often part of challenge pages
  /checking your browser/i,
  /security check/i,
  /access denied/i, // Can sometimes indicate a block page with a CAPTCHA
  /are you a robot/i,
  /captcha-delivery\.com/i, // DataDome
  /geo\.captcha-delivery\.com/i, // DataDome
];


class HtmlAnalyserFixed {
  constructor() {
    logger.debug('[HtmlAnalyserFixed constructor] Initialized.');
  }

  extractArticleSnippets(htmlString, maxSnippets = 10, snippetMaxLength = 150) {
    logger.debug(`[HtmlAnalyserFixed extractArticleSnippets] Extracting up to ${maxSnippets} snippets.`);
    if (!htmlString || typeof htmlString !== 'string') {
        logger.warn('[HtmlAnalyserFixed extractArticleSnippets] htmlString is invalid or empty.');
        return [];
    }
    try {
      const dom = new JSDOM(htmlString);
      const { document } = dom.window;
      const snippets = [];
      const selectors = ['p', 'article', 'main', 'div[class*="content"]', 'div[class*="article"]', 'section[id*="content"]'];
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
          if (text.length > 50) { // Only consider reasonably long text segments
            snippets.push(text.substring(0, snippetMaxLength));
          }
        });
        if (snippets.length >= maxSnippets) break;
      }
      logger.debug(`[HtmlAnalyserFixed extractArticleSnippets] Extracted ${snippets.length} snippets.`);
      return snippets.slice(0, maxSnippets);
    } catch (error) {
      logger.error(`[HtmlAnalyserFixed extractArticleSnippets] Error extracting snippets: ${error.message}`);
      if (scraperSettings.debug) {
        logger.error('[DEBUG_MODE] Full error during snippet extraction:', error);
        logger.debug(`[DEBUG_MODE] HTML snippet causing error (first 500 chars): ${htmlString.substring(0,500)}`);
      }
      throw new ExtractionError('Failed to extract snippets from HTML', { originalError: error.message });
    }
  }

  detectCaptchaMarkers(htmlString) {
    logger.debug('[HtmlAnalyserFixed detectCaptchaMarkers] Detecting CAPTCHA markers.');
    if (!htmlString || typeof htmlString !== 'string') {
        logger.warn('[HtmlAnalyserFixed detectCaptchaMarkers] htmlString is invalid or empty.');
        return false;
    }

    // Text-based detection (more resilient to obfuscation)
    for (const marker of COMMON_CAPTCHA_TEXT_MARKERS) {
      if (marker.test(htmlString)) {
        logger.info(`[HtmlAnalyserFixed detectCaptchaMarkers] CAPTCHA text marker found: ${marker}`);
        return true;
      }
    }

    // Selector-based detection (can be brittle)
    try {
      const dom = new JSDOM(htmlString);
      const { document } = dom.window;
      for (const selector of COMMON_CAPTCHA_SELECTORS) {
        if (document.querySelector(selector)) {
          logger.info(`[HtmlAnalyserFixed detectCaptchaMarkers] CAPTCHA selector found: ${selector}`);
          return true;
        }
      }
    } catch (error) {
      logger.warn(`[HtmlAnalyserFixed detectCaptchaMarkers] Error parsing HTML for CAPTCHA selector detection: ${error.message}. Relying on text markers.`);
      if (scraperSettings.debug) {
        logger.warn('[DEBUG_MODE] Full error during CAPTCHA selector parsing:', error);
      }
    }
    logger.debug('[HtmlAnalyserFixed detectCaptchaMarkers] No common CAPTCHA markers found.');
    return false;
  }

  extractByXpath(htmlString, xpathExpression) {
    logger.debug(`[HtmlAnalyserFixed extractByXpath] Extracting by XPath: ${xpathExpression}`);
    if (!htmlString || typeof htmlString !== 'string') {
        logger.warn('[HtmlAnalyserFixed extractByXpath] htmlString is invalid or empty.');
        return null;
    }
    try {
      const dom = new JSDOM(htmlString);
      const { document } = dom.window;
      const result = document.evaluate(xpathExpression, document, null, dom.window.XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      const node = result.singleNodeValue;
      if (node) {
        const extractedHtml = node.innerHTML;
        logger.debug(`[HtmlAnalyserFixed extractByXpath] Successfully extracted content. Length: ${extractedHtml?.length}`);
        return extractedHtml;
      }
      logger.warn(`[HtmlAnalyserFixed extractByXpath] XPath "${xpathExpression}" did not find any node.`);
      return null;
    } catch (error) {
      if (error instanceof ExtractionError) throw error;
      logger.error(`[HtmlAnalyserFixed extractByXpath] Error extracting by XPath "${xpathExpression}" from static HTML: ${error.message}`);
      if (scraperSettings.debug) {
        logger.error('[DEBUG_MODE] Full error during XPath extraction:', error);
      }
      throw new ExtractionError('Error applying XPath to HTML', { xpath: xpathExpression, originalError: error.message });
    }
  }

  queryStaticXPathWithDetails(htmlString, xpathExpression) {
    logger.debug(`[HtmlAnalyserFixed queryStaticXPathWithDetails] Querying XPath for details: ${xpathExpression}`);
    const result = {
        xpath: xpathExpression, element_found_count: 0, tagName: null, id: null, className: null,
        textContentLength: 0, innerHTML: null, paragraphCount: 0, linkCount: 0, imageCount: 0,
        videoCount: 0, audioCount: 0, pictureCount: 0, unwantedTagCount: 0, totalDescendantElements: 0,
    };
    if (!htmlString || typeof htmlString !== 'string') {
        logger.warn('[HtmlAnalyserFixed queryStaticXPathWithDetails] htmlString is invalid or empty.');
        return result;
    }

    try {
      const dom = new JSDOM(htmlString);
      const { document } = dom.window;
      const xPathResult = document.evaluate(xpathExpression, document, null, dom.window.XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
      
      let node = xPathResult.iterateNext();
      const elements = [];
      while(node) {
        elements.push(node);
        node = xPathResult.iterateNext();
      }
      result.element_found_count = elements.length;

      if (elements.length > 0) {
        const mainElement = elements[0]; // Analyze the first matched element
        result.tagName = mainElement.tagName ? mainElement.tagName.toLowerCase() : null;
        result.id = mainElement.id || null;
        result.className = mainElement.className || null;
        result.innerHTML = mainElement.innerHTML; // Consider truncating for logs if too large
        
        const getTextLength = (elNode) => { /* ... */ return 0; }; // Simplified, actual logic in Puppeteer version
        result.textContentLength = (mainElement.textContent || '').replace(/\s+/g, ' ').trim().length; // Basic version
        
        result.paragraphCount = mainElement.getElementsByTagName('p').length;
        result.linkCount = mainElement.getElementsByTagName('a').length;
        result.imageCount = mainElement.getElementsByTagName('img').length;
        result.videoCount = mainElement.getElementsByTagName('video').length;
        result.audioCount = mainElement.getElementsByTagName('audio').length;
        result.pictureCount = mainElement.getElementsByTagName('picture').length;
        result.totalDescendantElements = mainElement.getElementsByTagName('*').length;

        const unwantedTagsSet = new Set(['nav', 'footer', 'aside', 'header', 'form', 'script', 'style', 'figcaption', 'figure', 'details', 'summary', 'menu', 'dialog']);
        let unwanted = 0;
        mainElement.querySelectorAll('*').forEach(descendant => {
            if (unwantedTagsSet.has(descendant.tagName.toLowerCase())) {
                unwanted++;
            }
        });
        result.unwantedTagCount = unwanted;
        logger.debug(`[HtmlAnalyserFixed queryStaticXPathWithDetails] Details for XPath "${xpathExpression}": found=${result.element_found_count}, tagName=${result.tagName}, pCount=${result.paragraphCount}, textLen=${result.textContentLength}`);
      } else {
        logger.debug(`[HtmlAnalyserFixed queryStaticXPathWithDetails] XPath "${xpathExpression}" found 0 elements.`);
      }
    } catch (error) {
      logger.warn(`[HtmlAnalyserFixed queryStaticXPathWithDetails] Error querying static XPath "${xpathExpression}": ${error.message}`);
      if (scraperSettings.debug) {
        const extractionError = new ExtractionError(`Error querying static XPath "${xpathExpression}"`, { originalError: error.message, xpath: xpathExpression });
        logger.error('[DEBUG_MODE]', extractionError.message, extractionError.details);
      }
    }
    return result; 
  }

  extractDomStructure(htmlContent, maxTextLength = scraperSettings.domStructureMaxTextLength, minTextSizeToAnnotate = scraperSettings.domStructureMinTextSizeToAnnotate) {
    logger.debug(`[HtmlAnalyserFixed extractDomStructure] Extracting DOM structure. MaxTextLen: ${maxTextLength}, MinAnnotateSize: ${minTextSizeToAnnotate}`);
    if (!htmlContent || typeof htmlContent !== 'string') {
        logger.warn('[HtmlAnalyserFixed extractDomStructure] htmlContent is invalid or empty.');
        return ""; // Return empty string for invalid input
    }
    try {
      const dom = new JSDOM(htmlContent);
      const { document } = dom.window;

      // Remove script, style, noscript, meta, link, head, comments, svg, path, iframe
      ['script', 'style', 'noscript', 'meta', 'link', 'head', 'svg', 'path', 'iframe'].forEach(tagName => {
        Array.from(document.getElementsByTagName(tagName)).forEach(el => el.remove());
      });
      // Remove comments
      const comments = [];
      const treeWalker = document.createTreeWalker(document.body || document.documentElement, dom.window.NodeFilter.SHOW_COMMENT);
      let currentNode;
      while(currentNode = treeWalker.nextNode()) comments.push(currentNode);
      comments.forEach(comment => comment.parentNode.removeChild(comment));


      let idCounter = 0;
      const processNode = (node) => {
        if (node.nodeType === dom.window.Node.ELEMENT_NODE) {
          // Assign a unique ID for LLM reference if it doesn't have one
          if (!node.id) {
            node.id = `llm-ref-${idCounter++}`;
          }

          const originalTextLength = (node.textContent || '').trim().length;
          if (originalTextLength > 0) {
            node.setAttribute('data-original-text-length', originalTextLength.toString());
          }
          
          const paragraphCount = node.getElementsByTagName('p').length;
           if (paragraphCount > 0) {
            node.setAttribute('data-paragraph-count', paragraphCount.toString());
          }

          if (originalTextLength > minTextSizeToAnnotate && node.childNodes.length > 0) {
            // Add a comment for LLM if text is significant
            // const summaryComment = document.createComment(`LLM_INFO: Element ${node.id} contains ${originalTextLength} chars, ${paragraphCount} paragraphs.`);
            // node.parentNode.insertBefore(summaryComment, node); // This might be too intrusive, attributes are better
          }


          Array.from(node.childNodes).forEach(child => {
            if (child.nodeType === dom.window.Node.TEXT_NODE) {
              const trimmedText = (child.textContent || '').trim();
              if (trimmedText.length > maxTextLength) {
                child.textContent = trimmedText.substring(0, maxTextLength) + '...';
              } else if (!trimmedText && child.parentNode && child.parentNode.childNodes.length === 1) {
                // If it's an empty text node and the only child, replace with a placeholder or remove
                // This helps reduce noise from empty paragraphs or divs.
                // child.textContent = '(empty_text_node)'; // Or remove: child.remove();
              }
            } else {
              processNode(child);
            }
          });
        }
      };

      processNode(document.body || document.documentElement);
      
      // Serialize only the body or the whole document if body is not present
      const resultHTML = (document.body || document.documentElement).innerHTML;
      logger.debug(`[HtmlAnalyserFixed extractDomStructure] DOM structure extracted. Original length: ${htmlContent.length}, Simplified length: ${resultHTML.length}`);
      return resultHTML;

    } catch (error) {
      logger.error(`[HtmlAnalyserFixed extractDomStructure] Error extracting DOM structure: ${error.message}`);
      if (scraperSettings.debug) {
        logger.error('[DEBUG_MODE] Full error during DOM structure extraction:', error);
      }
      return htmlContent.substring(0, 100000) + '... (original HTML truncated due to error)';
    }
  }

  checkDataDomeBannedIP(captchaUrl) {
    logger.debug(`[HtmlAnalyserFixed checkDataDomeBannedIP] Checking URL for banned IP: ${captchaUrl}`);
    if (!captchaUrl || typeof captchaUrl !== 'string') {
        logger.warn('[HtmlAnalyserFixed checkDataDomeBannedIP] Invalid captchaUrl provided.');
        return { isBanned: false, reason: 'Invalid CAPTCHA URL provided' };
    }
    try {
      const url = new URL(captchaUrl);
      const params = url.searchParams;
      const t = params.get('t');
      if (t === 'bv') {
        logger.warn(`[HtmlAnalyserFixed checkDataDomeBannedIP] 't=bv' parameter found. IP likely banned.`);
        return { isBanned: true, reason: `Parameter 't=bv' indicates banned IP.` };
      }
      if (params.has('cid') && (params.get('cid') || '').includes('block')) {
        logger.warn(`[HtmlAnalyserFixed checkDataDomeBannedIP] 'cid' parameter contains 'block'. IP may be banned.`);
        return { isBanned: true, reason: `IP may be blocked (cid=${params.get('cid')})` };
      }
      logger.debug('[HtmlAnalyserFixed checkDataDomeBannedIP] No direct indicators of banned IP found in URL.');
      return { isBanned: false, reason: 'No direct indicators of banned IP found in URL.' };
    } catch (error) {
      logger.error(`[HtmlAnalyserFixed checkDataDomeBannedIP] Error checking DataDome banned IP from URL "${captchaUrl}": ${error.message}`);
      if (scraperSettings.debug) {
        logger.error('[DEBUG_MODE] Full error during DataDome banned IP check:', error);
      }
      return { isBanned: false, reason: `Error parsing CAPTCHA URL: ${error.message}` };
    }
  }
}
export { HtmlAnalyserFixed };
