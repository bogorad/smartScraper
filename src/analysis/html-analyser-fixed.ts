// src/analysis/html-analyser-fixed.ts
import { JSDOM, VirtualConsole } from 'jsdom';
import { logger } from '../utils/logger.js';
import { ExtractionError } from '../utils/error-handler.js';
import { scraperSettings } from '../../config/index.js';
import { ElementDetails } from './content-scoring-engine.js';

const CAPTCHA_TEXT_MARKERS: RegExp[] = [
  /captcha/i, /verify you are human/i, /are you a robot/i, /recaptcha/i, /hcaptcha/i,
  /turnstile/i, /human verification/i, /security check/i, /challenge/i, /cloudflare/i,
  /access denied/i, /checking your browser/i, /datadome/i, /captcha-delivery\.com/i,
  /geo\.captcha-delivery\.com/i,
];

const CAPTCHA_SELECTOR_MARKERS: string[] = [
  '.g-recaptcha', '.h-captcha', 'iframe[src*="hcaptcha.com"]', 'iframe[src*="recaptcha.net"]',
  'iframe[src*="google.com/recaptcha"]', '.cf-turnstile', 'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="captcha.datadome.co"]', 'iframe[src*="captcha-delivery.com"]',
  'iframe[src*="geo.captcha-delivery.com"]', 'div#datadome-captcha-container',
  '[id*="captcha"]', '[class*="captcha"]', '[id*="verify"]', '[class*="verify"]',
];

interface BannedIPCheckResult {
    isBanned: boolean;
    reason: string;
}

class HtmlAnalyserFixed {
  constructor() {
    logger.debug('[HtmlAnalyserFixed constructor] Initialized.');
  }

  extractArticleSnippets(htmlString: string | null | undefined, maxSnippets: number = 10, snippetMaxLength: number = 150): string[] {
    logger.debug(`[HtmlAnalyserFixed extractArticleSnippets] Extracting up to ${maxSnippets} snippets.`);
    if (!htmlString || typeof htmlString !== 'string') {
      logger.warn('[HtmlAnalyserFixed extractArticleSnippets] htmlString is invalid or empty.');
      return [];
    }
    try {
      const virtualConsole = new VirtualConsole();
      const dom = new JSDOM(htmlString, { virtualConsole });
      const { document } = dom.window;
      const snippets: string[] = [];
      const selectors = ['p', 'article', 'main', 'div[class*="content"]', 'div[class*="article"]', 'section'];

      selectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
          if (text.length > 50) {
            snippets.push(text.substring(0, snippetMaxLength));
          }
        });
      });
      logger.debug(`[HtmlAnalyserFixed extractArticleSnippets] Extracted ${snippets.length} snippets.`);
      return snippets.slice(0, maxSnippets);
    } catch (error: any) {
      logger.error(`[HtmlAnalyserFixed extractArticleSnippets] Error extracting snippets: ${error.message}`);
      if (logger.isDebugging()) {
        logger.error('[DEBUG_MODE] Full error during snippet extraction:', error);
        logger.debug(`[DEBUG_MODE] HTML snippet causing error (first 500 chars): ${htmlString.substring(0,500)}`);
      }
      throw new ExtractionError('Failed to extract snippets from HTML', { originalError: error.message });
    }
  }

  detectCaptchaMarkers(htmlString: string | null | undefined): boolean {
    logger.debug('[HtmlAnalyserFixed detectCaptchaMarkers] Detecting CAPTCHA markers.');
    if (!htmlString || typeof htmlString !== 'string') {
      logger.warn('[HtmlAnalyserFixed detectCaptchaMarkers] htmlString is invalid or empty.');
      return false;
    }
    for (const marker of CAPTCHA_TEXT_MARKERS) {
      if (marker.test(htmlString)) {
        logger.info(`[HtmlAnalyserFixed detectCaptchaMarkers] CAPTCHA text marker found: ${marker}`);
        return true;
      }
    }
    try {
      const virtualConsole = new VirtualConsole();
      const dom = new JSDOM(htmlString, { virtualConsole });
      const { document } = dom.window;
      for (const selector of CAPTCHA_SELECTOR_MARKERS) {
        if (document.querySelector(selector)) {
          logger.info(`[HtmlAnalyserFixed detectCaptchaMarkers] CAPTCHA selector found: ${selector}`);
          return true;
        }
      }
    } catch (error: any) {
      logger.warn(`[HtmlAnalyserFixed detectCaptchaMarkers] Error parsing HTML for CAPTCHA selector detection: ${error.message}. Relying on text markers.`);
      if (logger.isDebugging()) {
        logger.warn('[DEBUG_MODE] Full error during CAPTCHA selector parsing:', error);
      }
    }
    logger.debug('[HtmlAnalyserFixed detectCaptchaMarkers] No common CAPTCHA markers found.');
    return false;
  }

  extractByXpath(htmlString: string | null | undefined, xpathExpression: string): string | null {
    logger.debug(`[HtmlAnalyserFixed extractByXpath] Extracting by XPath: ${xpathExpression}`);
    if (!htmlString || typeof htmlString !== 'string') {
      logger.warn('[HtmlAnalyserFixed extractByXpath] htmlString is invalid or empty.');
      return null;
    }
    try {
      const virtualConsole = new VirtualConsole();
      const dom = new JSDOM(htmlString, { virtualConsole });
      const { document } = dom.window;
      const result = document.evaluate(xpathExpression, document, null, dom.window.XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      const extractedNode = result.singleNodeValue;
      if (extractedNode) {
        const extractedHtml = (extractedNode as Element).innerHTML;
        logger.debug(`[HtmlAnalyserFixed extractByXpath] Successfully extracted content. Length: ${extractedHtml?.length}`);
        return extractedHtml;
      }
      logger.warn(`[HtmlAnalyserFixed extractByXpath] XPath "${xpathExpression}" did not find any node.`);
      return null;
    } catch (error: any) {
      logger.error(`[HtmlAnalyserFixed extractByXpath] Error extracting by XPath "${xpathExpression}" from static HTML: ${error.message}`);
      if (logger.isDebugging()) {
        logger.error('[DEBUG_MODE] Full error during XPath extraction:', error);
      }
      throw new ExtractionError('Error applying XPath to HTML', { xpath: xpathExpression, originalError: error.message });
    }
  }

  queryStaticXPathWithDetails(htmlString: string | null | undefined, xpathExpression: string): ElementDetails {
    logger.debug(`[HtmlAnalyserFixed queryStaticXPathWithDetails] Querying XPath for details: ${xpathExpression}`);
    const result: ElementDetails = {
        xpath: xpathExpression,
        element_found_count: 0,
        tagName: undefined, // Initialize as undefined, will be string or null
        id: undefined, // Initialize as undefined
        className: undefined, // Initialize as undefined
        innerHTMLSample: '',
        textContentLength: 0,
        paragraphCount: 0,
        linkCount: 0,
        imageCount: 0,
        videoCount: 0,
        audioCount: 0,
        pictureCount: 0,
        unwantedTagCount: 0,
        totalDescendantElements: 0,
    };

    if (!htmlString || typeof htmlString !== 'string') {
      logger.warn('[HtmlAnalyserFixed queryStaticXPathWithDetails] htmlString is invalid or empty.');
      return result;
    }

    try {
      const virtualConsole = new VirtualConsole();
      const dom = new JSDOM(htmlString, { virtualConsole });
      const { document } = dom.window;
      const xPathResult = document.evaluate(xpathExpression, document, null, dom.window.XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
      
      const elements: Node[] = [];
      let node = xPathResult.iterateNext();
      while (node) {
        elements.push(node);
        node = xPathResult.iterateNext();
      }
      result.element_found_count = elements.length;

      if (elements.length > 0) {
        const mainElement = elements[0] as Element;
        result.tagName = mainElement.tagName ? mainElement.tagName.toLowerCase() : null;
        result.id = mainElement.id || null;
        result.className = mainElement.className || null;
        result.innerHTMLSample = mainElement.innerHTML.substring(0, 200) + (mainElement.innerHTML.length > 200 ? '...' : '');
        
        result.textContentLength = (mainElement.textContent || '').replace(/\s+/g, ' ').trim().length;
        result.paragraphCount = mainElement.getElementsByTagName('p').length;
        result.linkCount = mainElement.getElementsByTagName('a').length;
        result.imageCount = mainElement.getElementsByTagName('img').length;
        result.videoCount = mainElement.getElementsByTagName('video').length;
        result.audioCount = mainElement.getElementsByTagName('audio').length;
        result.pictureCount = mainElement.getElementsByTagName('picture').length;
        result.totalDescendantElements = mainElement.getElementsByTagName('*').length;

        const unwantedTagsSet = new Set(['nav', 'footer', 'aside', 'header', 'form', 'script', 'style', 'figcaption', 'figure', 'details', 'summary', 'menu', 'dialog']);
        let unwantedCount = 0;
        mainElement.querySelectorAll('*').forEach(descendant => {
            if (unwantedTagsSet.has(descendant.tagName.toLowerCase())) {
                unwantedCount++;
            }
        });
        result.unwantedTagCount = unwantedCount;
        logger.debug(`[HtmlAnalyserFixed queryStaticXPathWithDetails] Details for XPath "${xpathExpression}": found=${result.element_found_count}, tagName=${result.tagName}, pCount=${result.paragraphCount}, textLen=${result.textContentLength}`);
      } else {
        logger.debug(`[HtmlAnalyserFixed queryStaticXPathWithDetails] XPath "${xpathExpression}" found 0 elements.`);
      }
    } catch (error: any) {
      logger.warn(`[HtmlAnalyserFixed queryStaticXPathWithDetails] Error querying static XPath "${xpathExpression}": ${error.message}`);
      const extractionError = new ExtractionError(`Error querying static XPath "${xpathExpression}"`, { originalError: error.message, xpath: xpathExpression });
      if (logger.isDebugging()) {
        logger.error('[DEBUG_MODE]', extractionError.message, extractionError.details);
      }
    }
    return result;
  }

  extractDomStructure(htmlContent: string | null | undefined, maxTextLength: number = scraperSettings.domStructureMaxTextLength, minTextSizeToAnnotate: number = scraperSettings.domStructureMinTextSizeToAnnotate): string {
    logger.debug(`[HtmlAnalyserFixed extractDomStructure] Extracting DOM structure. MaxTextLen: ${maxTextLength}, MinAnnotateSize: ${minTextSizeToAnnotate}`);
    if (!htmlContent || typeof htmlContent !== 'string') {
        logger.warn('[HtmlAnalyserFixed extractDomStructure] htmlContent is invalid or empty.');
        return "";
    }
    try {
        const virtualConsole = new VirtualConsole();
        const dom = new JSDOM(htmlContent, { virtualConsole });
        const { document, NodeFilter, Node } = dom.window;

        ['script', 'style', 'noscript', 'meta', 'link', 'head', 'svg', 'path', 'iframe'].forEach(tagName => {
            Array.from(document.getElementsByTagName(tagName)).forEach(el => el.remove());
        });

        const comments: Comment[] = [];
        const treeWalker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_COMMENT);
        let currentNode;
        while(currentNode = treeWalker.nextNode()) comments.push(currentNode as Comment);
        comments.forEach(comment => comment.parentNode?.removeChild(comment));

        const processNode = (node: Element | DocumentFragment | Document) => {
            if (!node.childNodes) return;
            Array.from(node.childNodes).forEach(child => {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    const element = child as Element;
                    const originalTextLength = (element.textContent || '').trim().length;
                    if (originalTextLength > minTextSizeToAnnotate) {
                        element.setAttribute('data-original-text-length', originalTextLength.toString());
                    }
                    const paragraphCount = element.getElementsByTagName('p').length;
                    if (paragraphCount > 0 && originalTextLength > minTextSizeToAnnotate) {
                        element.setAttribute('data-paragraph-count', paragraphCount.toString());
                    }
                    processNode(element);
                } else if (child.nodeType === Node.TEXT_NODE) {
                    const trimmedText = (child.textContent || '').trim();
                    if (trimmedText.length > maxTextLength) {
                        child.textContent = trimmedText.substring(0, maxTextLength) + '...';
                    } else if (trimmedText.length === 0 && child.parentNode && child.parentNode.childNodes.length === 1) {
                        // child.textContent = '(empty_text_node)';
                    } else {
                        child.textContent = trimmedText;
                    }
                }
            });
        };
        processNode(document.body || document.documentElement);
        const resultHTML = (document.body || document.documentElement).outerHTML;
        logger.debug(`[HtmlAnalyserFixed extractDomStructure] DOM structure extracted. Original length: ${htmlContent.length}, Simplified length: ${resultHTML.length}`);
        return resultHTML;
    } catch (error: any) {
        logger.error(`[HtmlAnalyserFixed extractDomStructure] Error extracting DOM structure: ${error.message}`);
        if (logger.isDebugging()) {
            logger.error('[DEBUG_MODE] Full error during DOM structure extraction:', error);
        }
        return htmlContent.substring(0, 100000) + '... (original HTML truncated due to error)';
    }
  }

  checkDataDomeBannedIP(captchaUrl: string | null | undefined): BannedIPCheckResult {
    logger.debug(`[HtmlAnalyserFixed checkDataDomeBannedIP] Checking URL for banned IP: ${captchaUrl}`);
    if (!captchaUrl || typeof captchaUrl !== 'string') {
        logger.warn('[HtmlAnalyserFixed checkDataDomeBannedIP] Invalid captchaUrl provided.');
        return { isBanned: false, reason: 'Invalid CAPTCHA URL' };
    }
    try {
        const url = new URL(captchaUrl);
        const params = url.searchParams;
        const t = params.get('t');
        if (t === 'bv') {
            logger.warn(`[HtmlAnalyserFixed checkDataDomeBannedIP] 't=bv' parameter found. IP likely banned.`);
            return { isBanned: true, reason: "IP banned (t=bv parameter found)" };
        }
        if (params.has('cid') && (params.get('cid') || '').includes('block')) {
            logger.warn(`[HtmlAnalyserFixed checkDataDomeBannedIP] 'cid' parameter contains 'block'. IP may be banned.`);
            return { isBanned: true, reason: `IP may be blocked (cid=${params.get('cid')})` };
        }
        logger.debug('[HtmlAnalyserFixed checkDataDomeBannedIP] No direct indicators of banned IP found in URL.');
        return { isBanned: false, reason: "No clear banned IP indicators." };
    } catch (error: any) {
        logger.error(`[HtmlAnalyserFixed checkDataDomeBannedIP] Error checking DataDome banned IP from URL "${captchaUrl}": ${error.message}`);
        if (logger.isDebugging()) {
            logger.error('[DEBUG_MODE] Full error during DataDome banned IP check:', error);
        }
        return { isBanned: false, reason: `Error parsing CAPTCHA URL: ${error.message}` };
    }
  }
}

export { HtmlAnalyserFixed };
