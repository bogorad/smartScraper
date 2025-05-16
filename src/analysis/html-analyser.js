// src/analysis/html-analyser.js

import { JSDOM } from 'jsdom';
import xpath from 'xpath';
import logger from '../utils/logger.js';

class HtmlAnalyser {
    constructor() {
        // Pre-compile regex for CAPTCHA markers for efficiency if used frequently
        this.captchaKeywordsRegex = [
            /g-recaptcha/i, /recaptcha/i, /hcaptcha/i,
            /turnstile/i, /cf-turnstile/i, /cloudflare.*challenge/i,
            /are you human/i, /verify you are human/i, /security check/i,
            /enter the code/i, /captcha/i, /human verification/i
        ];
        this.captchaIframeSrcRegex = [
            /google\.com\/recaptcha/i,
            /hcaptcha\.com/i,
            /challenges\.cloudflare\.com/i
        ];
        logger.info('HtmlAnalyser initialized.');
    }

    /**
     * Extracts short text snippets from the HTML for LLM context.
     * @param {string} htmlString - The HTML content as a string.
     * @param {number} maxSnippets - Maximum number of snippets to extract.
     * @param {number} snippetMaxLength - Maximum length of each snippet.
     * @returns {string[]} An array of text snippets.
     */
    extractArticleSnippets(htmlString, maxSnippets = 10, snippetMaxLength = 150) {
        if (!htmlString || typeof htmlString !== 'string') {
            logger.warn('extractArticleSnippets: htmlString is invalid.');
            return [];
        }
        const snippets = [];
        try {
            const dom = new JSDOM(htmlString);
            const document = dom.window.document;

            // Prioritize common content tags
            const selectors = ['p', 'h2', 'h3', 'li', 'blockquote', 'td'];
            let snippetsFound = 0;

            for (const selector of selectors) {
                if (snippetsFound >= maxSnippets) break;
                const elements = document.querySelectorAll(selector);
                for (const element of elements) {
                    if (snippetsFound >= maxSnippets) break;
                    const text = (element.textContent || '').trim();
                    if (text.length > 20) { // Only consider reasonably long snippets
                        snippets.push(text.substring(0, snippetMaxLength) + (text.length > snippetMaxLength ? '...' : ''));
                        snippetsFound++;
                    }
                }
            }
            logger.debug(`Extracted ${snippets.length} snippets.`);
            return snippets;
        } catch (error) {
            logger.error(`Error extracting snippets: ${error.message}`);
            return [];
        }
    }

    /**
     * Detects common CAPTCHA markers in the HTML content.
     * @param {string} htmlString - The HTML content as a string.
     * @returns {boolean} True if CAPTCHA markers are found, false otherwise.
     */
    detectCaptchaMarkers(htmlString) {
        if (!htmlString || typeof htmlString !== 'string') {
            logger.warn('detectCaptchaMarkers: htmlString is invalid.');
            return false;
        }

        const lowerHtml = htmlString.toLowerCase(); // For case-insensitive keyword search

        for (const regex of this.captchaKeywordsRegex) {
            if (regex.test(lowerHtml)) {
                logger.info(`CAPTCHA marker found (keyword): ${regex.source}`);
                return true;
            }
        }

        try {
            const dom = new JSDOM(htmlString);
            const document = dom.window.document;
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
                const src = iframe.getAttribute('src');
                if (src) {
                    for (const regex of this.captchaIframeSrcRegex) {
                        if (regex.test(src)) {
                            logger.info(`CAPTCHA marker found (iframe src): ${src}`);
                            return true;
                        }
                    }
                }
            }
        } catch (error) {
            logger.warn(`Error parsing HTML for CAPTCHA iframe detection: ${error.message}`);
            // Fallback to regex on raw HTML if JSDOM fails on malformed HTML
        }


        // Check for common CAPTCHA-related class names or IDs
        const commonCaptchaSelectors = [
            '[class*="captcha"]', '[id*="captcha"]',
            '[class*="recaptcha"]', '[id*="recaptcha"]',
            '[class*="h-captcha"]', '[id*="h-captcha"]',
            '[class*="cf-turnstile"]', '[id*="cf-turnstile"]'
        ];
        try {
            const dom = new JSDOM(htmlString); // Re-parse if needed, or pass dom around
            const document = dom.window.document;
            for (const selector of commonCaptchaSelectors) {
                if (document.querySelector(selector)) {
                    logger.info(`CAPTCHA marker found (selector): ${selector}`);
                    return true;
                }
            }
        } catch (error) {
            logger.warn(`Error parsing HTML for CAPTCHA selector detection: ${error.message}`);
        }


        return false;
    }

    /**
     * Extracts innerHTML of the first element matching an XPath from static HTML.
     * @param {string} htmlString - The HTML content as a string.
     * @param {string} xpathExpression - The XPath expression.
     * @returns {string|null} The innerHTML of the matched element or null.
     */
    extractByXpath(htmlString, xpathExpression) {
        if (!htmlString || !xpathExpression) return null;
        try {
            const dom = new JSDOM(htmlString);
            const document = dom.window.document;
            // xpath.select uses the document itself as the context node
            const nodes = xpath.select(xpathExpression, document);

            if (nodes && nodes.length > 0) {
                const firstNode = nodes[0];
                // Check if it's an Element node, which has innerHTML
                if (firstNode.nodeType === dom.window.Node.ELEMENT_NODE) {
                    return firstNode.innerHTML;
                }
            }
            return null;
        } catch (error) {
            logger.error(`Error extracting by XPath "${xpathExpression}" from static HTML: ${error.message}`);
            return null;
        }
    }

    /**
     * Queries static HTML using XPath and gathers details about the first matched element.
     * Similar to PuppeteerController.queryXPathWithDetails but for static HTML.
     * @param {string} htmlString - The HTML content.
     * @param {string} xpathExpression - The XPath to evaluate.
     * @returns {object|null} An object with details or null if no match/error.
     */
    queryStaticXPathWithDetails(htmlString, xpathExpression) {
        if (!htmlString || !xpathExpression) return null;

        const result = {
            xpath: xpathExpression,
            element_found_count: 0,
            tagName: null,
            id: null,
            className: null,
            textContentLength: 0,
            innerHTMLSnippet: null,
            paragraphCount: 0,
            linkCount: 0,
            imageCount: 0,
            totalDescendantElements: 0,
        };

        try {
            const dom = new JSDOM(htmlString);
            const document = dom.window.document;
            const selectedNodes = xpath.select(xpathExpression, document);

            result.element_found_count = selectedNodes.length;

            if (selectedNodes.length > 0) {
                const firstElement = selectedNodes[0];

                // Ensure it's an Element node
                if (firstElement.nodeType !== dom.window.Node.ELEMENT_NODE) {
                    logger.warn(`XPath "${xpathExpression}" matched a non-element node.`);
                    return result; // Return with count, but no element details
                }

                result.tagName = firstElement.tagName ? firstElement.tagName.toLowerCase() : null;
                result.id = firstElement.getAttribute('id') || null;
                result.className = firstElement.getAttribute('class') || null;

                const textContent = firstElement.textContent || '';
                result.textContentLength = textContent.trim().length;

                const innerHTML = firstElement.innerHTML || '';
                result.innerHTMLSnippet = innerHTML.substring(0, 200) + (innerHTML.length > 200 ? '...' : '');

                // Count descendants within this specific element
                result.paragraphCount = xpath.select("count(.//p)", firstElement);
                result.linkCount = xpath.select("count(.//a)", firstElement);
                result.imageCount = xpath.select("count(.//img)", firstElement);
                result.totalDescendantElements = xpath.select("count(.//*)", firstElement);
            }
        } catch (error) {
            logger.warn(`Error querying static XPath "${xpathExpression}": ${error.message}`);
            // Return result with element_found_count potentially 0 or as is
        }
        return result;
    }
}

// Export an instance or the class itself depending on preference
// Exporting class for flexibility if different configurations are ever needed.
// However, for this module, an instance is often fine.
export { HtmlAnalyser };
// Or:
// const htmlAnalyserInstance = new HtmlAnalyser();
// export default htmlAnalyserInstance;
