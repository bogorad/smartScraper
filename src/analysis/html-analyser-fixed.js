// src/analysis/html-analyser-fixed.js

import { JSDOM } from 'jsdom';
import xpath from 'xpath';
import { logger } from '../utils/logger.js';
import { ExtractionError } from '../utils/error-handler.js';

class HtmlAnalyserFixed {
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
            /challenges\.cloudflare\.com/i,
            /captcha-delivery\.com/i,
            /geo\.captcha-delivery\.com/i
        ];
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
        if (!htmlString || typeof htmlString !== 'string') {
            logger.warn('extractArticleSnippets: htmlString is invalid.');
            throw new ExtractionError('Invalid HTML string for snippet extraction', {
                htmlLength: htmlString ? htmlString.length : 0
            });
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
            throw new ExtractionError('Failed to extract snippets from HTML', {
                htmlLength: htmlString.length,
                error: error.message
            }, error);
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
            '[class*="cf-turnstile"]', '[id*="cf-turnstile"]',
            '[class*="datadome"]', '[id*="datadome"]'
        ];

        // Check for DataDome script
        if (lowerHtml.includes('datadome') || lowerHtml.includes('captcha-delivery.com')) {
            logger.info('DataDome CAPTCHA marker found in HTML');
            return true;
        }
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
     * Uses document.evaluate instead of xpath.select for better compatibility.
     * @param {string} htmlString - The HTML content as a string.
     * @param {string} xpathExpression - The XPath expression.
     * @returns {string|null} The innerHTML of the matched element or null.
     */
    extractByXpath(htmlString, xpathExpression) {
        if (!htmlString || !xpathExpression) {
            throw new ExtractionError('Missing HTML or XPath for extraction', {
                htmlProvided: !!htmlString,
                xpathProvided: !!xpathExpression
            });
        }

        try {
            const dom = new JSDOM(htmlString);
            const document = dom.window.document;

            // Use document.evaluate instead of xpath.select
            const xpathResult = document.evaluate(
                xpathExpression,
                document,
                null,
                dom.window.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
            );

            if (xpathResult.snapshotLength > 0) {
                const firstNode = xpathResult.snapshotItem(0);
                // Check if it's an Element node, which has innerHTML
                if (firstNode.nodeType === dom.window.Node.ELEMENT_NODE) {
                    return firstNode.innerHTML;
                }
            }

            // If we get here, no content was found with the XPath
            throw new ExtractionError('XPath did not match any element with content', {
                xpath: xpathExpression,
                nodesFound: xpathResult ? xpathResult.snapshotLength : 0
            });
        } catch (error) {
            // If it's already an ExtractionError, just re-throw it
            if (error instanceof ExtractionError) {
                throw error;
            }

            logger.error(`Error extracting by XPath "${xpathExpression}" from static HTML: ${error.message}`);
            throw new ExtractionError('Error applying XPath to HTML', {
                xpath: xpathExpression,
                htmlLength: htmlString.length,
                error: error.message
            }, error);
        }
    }

    /**
     * Queries static HTML using XPath and gathers details about the first matched element.
     * Uses document.evaluate instead of xpath.select for better compatibility.
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

            // Use document.evaluate instead of xpath.select
            const xpathResult = document.evaluate(
                xpathExpression,
                document,
                null,
                dom.window.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
            );

            result.element_found_count = xpathResult.snapshotLength;

            if (xpathResult.snapshotLength > 0) {
                const firstElement = xpathResult.snapshotItem(0);

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

                // Count descendants using document.evaluate for consistency
                const countXPath = (xpath) => {
                    try {
                        const countResult = document.evaluate(
                            xpath,
                            firstElement,
                            null,
                            dom.window.XPathResult.NUMBER_TYPE,
                            null
                        );
                        return countResult.numberValue || 0;
                    } catch (e) {
                        logger.warn(`Error counting with XPath "${xpath}": ${e.message}`);
                        return 0;
                    }
                };

                result.paragraphCount = countXPath("count(.//p)");
                result.linkCount = countXPath("count(.//a)");
                result.imageCount = countXPath("count(.//img)");
                result.totalDescendantElements = countXPath("count(.//*)")
            }
        } catch (error) {
            logger.warn(`Error querying static XPath "${xpathExpression}": ${error.message}`);

            // If it's already an ExtractionError, just re-throw it
            if (error instanceof ExtractionError) {
                throw error;
            }

            // Otherwise, wrap it in an ExtractionError but still return the partial result
            const extractionError = new ExtractionError(`Error querying static XPath "${xpathExpression}"`, {
                xpath: xpathExpression,
                partialResult: result
            }, error);

            // Attach the partial result to the error for callers that catch the error
            extractionError.partialResult = result;
            throw extractionError;
        }
        return result;
    }

    /**
     * Checks if a DataDome CAPTCHA URL indicates a banned IP
     * @param {string} captchaUrl - The URL of the DataDome CAPTCHA iframe
     * @returns {object} Object with isBanned and reason properties
     */
    checkDataDomeBannedIP(captchaUrl) {
        if (!captchaUrl) {
            return { isBanned: false };
        }

        try {
            // Check for t=bv parameter which indicates a banned IP
            if (captchaUrl.includes('t=bv')) {
                logger.warn('DataDome CAPTCHA URL contains t=bv parameter. This indicates the IP is banned.');
                return {
                    isBanned: true,
                    reason: 'IP_BANNED',
                    details: 'The t=bv parameter in the DataDome CAPTCHA URL indicates this IP is banned. Try using a different proxy.'
                };
            }

            // Check for t=fe parameter which is required for normal operation
            if (!captchaUrl.includes('t=fe')) {
                logger.warn('DataDome CAPTCHA URL does not contain t=fe parameter. This might cause issues with solving.');
                return {
                    isBanned: false,
                    warning: true,
                    details: 'The t=fe parameter is missing from the DataDome CAPTCHA URL. This might cause issues with solving.'
                };
            }

            return { isBanned: false };
        } catch (error) {
            logger.error(`Error checking DataDome banned IP: ${error.message}`);
            return {
                isBanned: false,
                error: true,
                details: `Error checking DataDome banned IP: ${error.message}`
            };
        }
    }
}

export { HtmlAnalyserFixed };
