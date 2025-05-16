// test-find-xpath.js - A simplified version that mimics find-xpath.js approach
import { logger } from './src/utils/logger.js';
import { HtmlAnalyserFixed } from './src/analysis/html-analyser-fixed.js';
import { fetchWithCurl } from './src/network/curl-handler.js';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import { JSDOM } from 'jsdom';

// Load environment variables
dotenv.config();

// Set a higher log level to see more details
process.env.LOG_LEVEL = 'DEBUG';

// Configuration
const LLM_API_BASE_URL = 'https://openrouter.ai/api/v1';
const LLM_CHAT_COMPLETIONS_ENDPOINT = `${LLM_API_BASE_URL}/chat/completions`;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL;

// Minimum number of paragraphs required for a candidate to be considered valid
const MIN_PARAGRAPH_THRESHOLD = 5;

// Scoring weights (copied from find-xpath.js)
const SCORE_WEIGHTS = {
  isSingleElement: 80,
  paragraphCount: 1,
  unwantedPenaltyRatio: -75,
  isSemanticTag: 75,
  hasDescriptiveIdOrClass: 30,
  textDensity: 50,
  linkDensityPenalty: -30,
  mediaPresence: 25,
  xpathComplexityPenalty: -5,
};

// Common tags to count within potential containers for statistical scoring
const TAGS_TO_COUNT = ['p', 'nav', 'aside', 'footer', 'header', 'ul', 'ol', 'img', 'a', 'video', 'audio', 'picture'];
const UNWANTED_TAGS = ['nav', 'aside', 'footer', 'header'];

/**
 * Extracts the DOM structure from HTML content, preserving tags and attributes but minimizing text content.
 * Adds annotations about original text size for each element.
 * @param {string} htmlContent - The full HTML content
 * @param {number} maxTextLength - Maximum length of text content to keep per node (default: 10)
 * @param {number} minTextSizeToAnnotate - Minimum text size to add an annotation (default: 100)
 * @returns {string} - The simplified DOM structure with annotations
 */
const extractDomStructure = (htmlContent, maxTextLength = 10, minTextSizeToAnnotate = 100) => {
  try {
    logger.info(`Extracting DOM structure from HTML (${htmlContent.length} bytes)...`);
    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;

    // Function to process a node and its children recursively
    const processNode = (node, depth = 0) => {
      // Skip comment nodes
      if (node.nodeType === dom.window.Node.COMMENT_NODE) {
        return '';
      }

      // Handle text nodes - truncate long text
      if (node.nodeType === dom.window.Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text.length === 0) return '';
        if (text.length <= maxTextLength) return text;
        return text.substring(0, maxTextLength) + '...';
      }

      // Handle element nodes
      if (node.nodeType === dom.window.Node.ELEMENT_NODE) {
        // Skip script and style tags entirely
        if (node.tagName.toLowerCase() === 'script' || node.tagName.toLowerCase() === 'style') {
          return '';
        }

        // Start tag with attributes
        let result = `<${node.tagName.toLowerCase()}`;

        // Add important attributes (id, class, etc.)
        const importantAttrs = ['id', 'class', 'role', 'aria-label', 'itemprop', 'data-testid', 'data-component'];
        for (const attr of importantAttrs) {
          if (node.hasAttribute(attr)) {
            result += ` ${attr}="${node.getAttribute(attr)}"`;
          }
        }

        // Calculate the total text content size for this element
        const originalTextLength = node.textContent.trim().length;

        // Add a data attribute with the original text length
        if (originalTextLength >= minTextSizeToAnnotate) {
          result += ` data-original-text-length="${originalTextLength}"`;
        }

        result += '>';

        // Add annotation comment for elements with significant text
        if (originalTextLength >= minTextSizeToAnnotate) {
          // Count paragraphs
          const paragraphCount = node.querySelectorAll('p').length;
          const linkCount = node.querySelectorAll('a').length;
          const imageCount = node.querySelectorAll('img').length;

          result += `<!-- Element contains ${originalTextLength} chars of text`;
          if (paragraphCount > 0) result += `, ${paragraphCount} paragraphs`;
          if (linkCount > 0) result += `, ${linkCount} links`;
          if (imageCount > 0) result += `, ${imageCount} images`;
          result += ` -->`;
        }

        // Process children
        for (const child of node.childNodes) {
          result += processNode(child, depth + 1);
        }

        // Close tag
        result += `</${node.tagName.toLowerCase()}>`;
        return result;
      }

      return '';
    };

    // Process the entire document
    const bodyElement = document.body;
    const domStructure = processNode(bodyElement);

    logger.info(`DOM structure extracted (${domStructure.length} bytes, ${Math.round(domStructure.length / htmlContent.length * 100)}% of original size)`);
    return domStructure;
  } catch (error) {
    logger.error(`Error extracting DOM structure: ${error.message}`);
    // Return a truncated version of the original HTML as fallback
    return htmlContent.substring(0, 100000) + '... (truncated)';
  }
};

/**
 * Scores a potential article container element based on its properties and content.
 * @param {object} elementDetails - Details obtained from queryXPathWithDetails.
 * @param {number} totalElementsFoundByXPath - The total number of elements the XPath matched.
 * @param {string} xpath - The XPath string itself (for generic penalty).
 * @returns {number} - The calculated score. Returns 0 if it fails basic criteria.
 */
const scoreElement = (elementDetails, totalElementsFoundByXPath, xpath) => {
  if (!elementDetails) {
    logger.warn(`Scoring: Missing element details for ${xpath}. Cannot score.`);
    return 0; // Cannot score properly
  }

  let score = 0;
  const { tagName, id, className, textContentLength, innerHTMLSnippet, totalDescendantElements } = elementDetails;

  const pCount = elementDetails.paragraphCount || 0;

  // Must meet minimum paragraph threshold
  if (pCount < MIN_PARAGRAPH_THRESHOLD) {
    logger.info(`Scoring: ${xpath} failed min paragraph threshold (${pCount} < ${MIN_PARAGRAPH_THRESHOLD}). Score: 0`);
    return 0;
  }

  // Add score based on paragraph count
  score += pCount * SCORE_WEIGHTS.paragraphCount;
  logger.info(`Scoring: ${xpath} - Paragraphs (${pCount}): +${pCount * SCORE_WEIGHTS.paragraphCount}`);

  // Bonus for semantic tags
  if (tagName === 'ARTICLE' || tagName === 'MAIN') {
    score += SCORE_WEIGHTS.isSemanticTag;
    logger.info(`Scoring: ${xpath} - Semantic tag (${tagName}): +${SCORE_WEIGHTS.isSemanticTag}`);
  }

  // Bonus for descriptive ID or class names
  const descriptiveRegex = /article|content|body|story|main|post/i;
  if ((id && descriptiveRegex.test(id)) || (className && descriptiveRegex.test(className))) {
    score += SCORE_WEIGHTS.hasDescriptiveIdOrClass;
    logger.info(`Scoring: ${xpath} - Descriptive ID/Class: +${SCORE_WEIGHTS.hasDescriptiveIdOrClass}`);
  }

  // NEW: Bonus for content-related IDs
  const contentIdRegex = /article-content|content|article-body|main-content|story-content|post-content/i;
  if (id && contentIdRegex.test(id)) {
    const contentIdBonus = 60;
    score += contentIdBonus;
    logger.info(`Scoring: ${xpath} - Content-specific ID bonus: +${contentIdBonus}`);
  }

  // Apply bonus/penalty based on the number of elements found by the XPath
  const isSingleElement = totalElementsFoundByXPath === 1;
  if (isSingleElement) {
    score += SCORE_WEIGHTS.isSingleElement;
    logger.info(`Scoring: ${xpath} - Single element bonus: +${SCORE_WEIGHTS.isSingleElement}`);
  } else {
    logger.info(`Validation: XPath "${xpath}" found ${totalElementsFoundByXPath} elements (not single).`);
  }

  // NEW: Bonus for specific content-related classes
  const contentClassRegex = /article__content|article-content|entry-content|post-body|story-body|content-body|article-body|article__body|article-dropcap|paywall-content/i;
  if (className && contentClassRegex.test(className)) {
    const contentClassBonus = 50;
    score += contentClassBonus;
    logger.info(`Scoring: ${xpath} - Content-specific class bonus: +${contentClassBonus}`);
  }

  // NEW: Penalty for being too high in the DOM hierarchy (prefer more specific elements)
  const hierarchyDepth = (xpath.match(/\//g) || []).length;
  if (hierarchyDepth <= 2) { // Very shallow XPath like //main or //article
    const shallowPenalty = -20;
    score += shallowPenalty;
    logger.info(`Scoring: ${xpath} - Shallow hierarchy penalty: ${shallowPenalty}`);
  }

  // NEW: Bonus for having "content" in the class name (very specific indicator)
  if (className && className.includes('content')) {
    const contentNameBonus = 30;
    score += contentNameBonus;
    logger.info(`Scoring: ${xpath} - 'content' in class name bonus: +${contentNameBonus}`);
  }

  // NEW: Bonus for elements with name="articleBody" (very specific indicator for NYT)
  if (xpath.includes('@name=\'articleBody\'') || xpath.includes('@name="articleBody"')) {
    const articleBodyBonus = 70;
    score += articleBodyBonus;
    logger.info(`Scoring: ${xpath} - 'name="articleBody"' bonus: +${articleBodyBonus}`);
  }

  logger.info(`Scoring: ${xpath} - Final Score: ${score.toFixed(2)}`);
  return score;
};

/**
 * Calls the LLM API to get candidate XPaths.
 * @param {string} htmlContent - The full HTML of the page.
 * @param {string[]} anchorSnippets - Text snippets from the article body.
 * @returns {Promise<string[]>} - Array of candidate XPaths from the LLM.
 */
const getLlmCandidateXPaths = async (htmlContent, anchorSnippets) => {
  logger.info('Requesting candidate XPaths from OpenRouter...');

  // Craft the prompt for the LLM - modified to explain the simplified DOM structure with annotations
  // and include common patterns from site_storage.json
  let prompt = `Analyze the following HTML source code from a webpage.
    NOTE: This is a simplified DOM structure where most text content has been truncated to save space, but all tags and important attributes (id, class, etc.) are preserved.

    IMPORTANT: Elements with significant text content have been annotated with:
    1. A 'data-original-text-length' attribute showing the original character count
    2. HTML comments like <!-- Element contains X chars of text, Y paragraphs, Z links, N images -->

    Use these annotations to help identify the main content area. Elements with large text content and multiple paragraphs are likely part of the main article.

    Identify the HTML element (and provide its XPath) that appears to contain the main body content, such as the primary narrative, text paragraphs, images, and embedded media, but excluding surrounding elements like navigation, sidebars, headers, footers, comment sections, and related stories.

    Look for elements with these common patterns found across news and article websites:

    1. Common element types:
       - <article> elements
       - <main> elements
       - <div> elements with descriptive classes/IDs
       - <section> elements with content-related attributes

    2. Common class names (look for elements with these classes):
       - "article__content"
       - "article-content"
       - "article-body"
       - "entry-content"
       - "body-content"
       - "post-body"
       - "story-body"
       - "content-body"
       - "main-content"
       - "article__text"
       - "article__body"
       - "story-text"
       - "article-text"

    3. Common attribute patterns:
       - article elements with name="articleBody"
       - div elements with itemprop="articleBody"

    4. Common ID patterns:
       - "article-content"
       - "article-body"
       - "content"
       - "main-content"
       - "article"
       - "story-content"
       - "post-content"

    Prioritize finding a minimal container that wraps the core content accurately. Elements with the most paragraphs and significant text content (as indicated by the annotations) are likely to be the main content.

    Focus on the structure, attributes, and the text size annotations rather than the truncated text content itself.`;

  if (anchorSnippets && anchorSnippets.length > 0) {
    prompt += `\nConsider that the main content likely contains text similar to these snippets: ${JSON.stringify(anchorSnippets)}.`;
  } else {
    prompt += `\nCould not extract specific text snippets, rely on structural and semantic analysis.`;
  }

  prompt += `\n\nProvide a list of the most likely candidate XPaths, ordered by confidence.`;
  prompt += `\n**IMPORTANT:** Respond ONLY with a JSON array of strings, where each string is a candidate XPath. Do not include any other text, explanation, or formatting outside the JSON array. Example: ["//div[@class='article-body']", "//main/article"].`;

  try {
    const response = await axios.post(LLM_CHAT_COMPLETIONS_ENDPOINT, {
      model: LLM_MODEL,
      messages: [
        { role: "system", content: "You are a helpful assistant that analyzes HTML and provides XPaths in a specific JSON format. You MUST adhere to the requested JSON output format and include no other text." },
        { role: "user", content: prompt + "\n\nHTML:\n" + htmlContent }
      ],
      temperature: process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : 0, // Set temperature to 0 for deterministic output
    }, {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://github.com/bogorad/smartScraper',
        'X-Title': 'SmartScraper',
        'Content-Type': 'application/json'
      }
    });

    // Parse the response
    if (!response.data || !response.data.choices || response.data.choices.length === 0) {
      logger.warn('LLM response missing choices or content.');
      logger.warn('Response data:', response.data);
      return [];
    }

    const llmResponseContent = response.data.choices[0].message.content;
    logger.info('Received response content.');
    logger.info(`Raw response content (first 200 chars): ${llmResponseContent.substring(0, 200)}...`);

    // Save the full LLM response to a file for debugging
    try {
      const dumpDir = './debug_dumps';
      await fs.mkdir(dumpDir, { recursive: true });
      const filename = path.join(dumpDir, 'llm_response.json');
      await fs.writeFile(filename, JSON.stringify(response.data, null, 2));
      logger.info(`Saved full LLM response to ${filename}`);

      // Also save the raw content
      const contentFilename = path.join(dumpDir, 'llm_content.txt');
      await fs.writeFile(contentFilename, llmResponseContent);
      logger.info(`Saved raw LLM content to ${contentFilename}`);
    } catch (error) {
      logger.error(`Failed to save LLM response: ${error.message}`);
    }

    let contentToParse = llmResponseContent;

    // Try different regex patterns to extract JSON
    const patterns = [
      // Standard JSON code block
      /```json\s*\n([\s\S]*?)\n```/,
      // JSON without code block markers
      /\[\s*"[^"]*"(?:\s*,\s*"[^"]*")*\s*\]/,
      // Any code block
      /```(?:json)?\s*\n([\s\S]*?)\n```/
    ];

    let matched = false;
    for (const regex of patterns) {
      const match = contentToParse.match(regex);
      if (match) {
        matched = true;
        logger.info(`Matched regex pattern: ${regex}`);
        contentToParse = match[1] || match[0];
        break;
      }
    }

    if (!matched) {
      logger.info('No JSON pattern matched. Attempting direct parse of the raw content.');
    }

    try {
      // Attempt to parse the content
      const candidateXPaths = JSON.parse(contentToParse);

      if (Array.isArray(candidateXPaths) && candidateXPaths.every(item => typeof item === 'string')) {
        logger.info(`Parsed ${candidateXPaths.length} candidate XPaths.`);
        return candidateXPaths;
      } else {
        logger.error('Parsed content is not a valid JSON array of strings.');
        logger.error(`Content type: ${typeof contentToParse}, value: ${contentToParse.substring(0, 200)}...`);

        // Fallback: try to extract XPaths using regex
        const xpathRegex = /\/\/[a-zA-Z0-9\[\]@='".:,()\s-]+/g;
        const extracted = llmResponseContent.match(xpathRegex);
        if (extracted && extracted.length > 0) {
          logger.info(`Fallback: Extracted ${extracted.length} XPaths using regex.`);
          return extracted;
        }

        return [];
      }
    } catch (parseError) {
      logger.error(`Failed to parse JSON from LLM response: ${parseError.message}`);
      logger.error(`Content that failed parsing (first 200 chars): ${contentToParse.substring(0, 200)}...`);

      // Fallback: try to extract XPaths using regex
      const xpathRegex = /\/\/[a-zA-Z0-9\[\]@='".:,()\s-]+/g;
      const extracted = llmResponseContent.match(xpathRegex);
      if (extracted && extracted.length > 0) {
        logger.info(`Fallback: Extracted ${extracted.length} XPaths using regex.`);
        return extracted;
      }

      return [];
    }
  } catch (error) {
    logger.error(`Error calling OpenRouter API: ${error.message}`);
    if (error.response) {
      logger.error('Response Status:', error.response.status);
      logger.error('Response Data:', error.response.data);
    }
    return [];
  }
};

async function testFindXPath() {
  // URL to test
  const url = 'https://www.nytimes.com/2025/05/15/health/gene-editing-personalized-rare-disorders.html';

  logger.info(`Starting XPath discovery for URL: ${url}`);

  try {
    // Try to get the HTML content using cURL first
    let htmlContent;
    const curlResponse = await fetchWithCurl(url);

    if (curlResponse.success) {
      htmlContent = curlResponse.html;
      logger.info(`Successfully fetched HTML content with cURL (${htmlContent.length} bytes)`);
    } else {
      logger.warn(`Failed to fetch URL with cURL: ${curlResponse.error}`);
      logger.info(`Trying with Puppeteer instead...`);

      // Use Puppeteer with stealth mode to bypass anti-scraping measures
      const puppeteer = require('puppeteer-extra');
      const StealthPlugin = require('puppeteer-extra-plugin-stealth');
      puppeteer.use(StealthPlugin());

      // Proxy configuration
      const proxyUrl = 'http://otnlqxce-rotate:pgg7cco5d94z@p.webshare.io:80';

      const browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          `--proxy-server=${proxyUrl}`
        ]
      });

      try {
        const page = await browser.newPage();

        // Set proxy authentication
        await page.authenticate({
          username: 'otnlqxce-rotate',
          password: 'pgg7cco5d94z'
        });

        // Set a more realistic user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        // Set extra HTTP headers
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Referer': 'https://www.google.com/'
        });

        // Enable request interception for debugging
        await page.setRequestInterception(true);

        page.on('request', request => {
          logger.info(`Puppeteer request: ${request.method()} ${request.url()}`);
          request.continue();
        });

        page.on('response', response => {
          logger.info(`Puppeteer response: ${response.status()} ${response.url()}`);
        });

        page.on('error', err => {
          logger.error(`Puppeteer error: ${err}`);
        });

        logger.info(`Navigating to ${url} with Puppeteer...`);
        await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: 60000 // Increase timeout to 60 seconds
        });

        // Wait for the content to load
        logger.info('Waiting for content to load...');
        await page.waitForTimeout(5000); // Increase wait time to 5 seconds

        // Get the HTML content
        logger.info('Getting page content...');
        htmlContent = await page.content();
        logger.info(`Successfully fetched HTML content with Puppeteer (${htmlContent.length} bytes)`);
      } finally {
        await browser.close();
      }
    }
    logger.info(`Successfully fetched HTML content (${htmlContent.length} bytes)`);

    // Save the HTML content to a file for inspection
    try {
      const dumpDir = './debug_dumps';
      await fs.mkdir(dumpDir, { recursive: true });
      const filename = path.join(dumpDir, 'cnn_article.html');
      await fs.writeFile(filename, htmlContent);
      logger.info(`Saved HTML content to ${filename}`);
    } catch (error) {
      logger.error(`Failed to save HTML content: ${error.message}`);
    }

    // Create an HTML analyzer
    const htmlAnalyser = new HtmlAnalyserFixed();

    // Extract snippets from the HTML
    const snippets = htmlAnalyser.extractArticleSnippets(htmlContent, 5, 50);
    logger.info(`Extracted ${snippets.length} snippets from the HTML`);

    // Extract the DOM structure with annotations about original text sizes
    const domStructure = extractDomStructure(
      htmlContent,
      15,       // Keep up to 15 chars of text per node
      100       // Annotate elements with 100+ chars of text
    );

    // Save the DOM structure to a file for inspection
    try {
      const dumpDir = './debug_dumps';
      const filename = path.join(dumpDir, 'cnn_dom_structure.html');
      await fs.writeFile(filename, domStructure);
      logger.info(`Saved DOM structure to ${filename}`);
    } catch (error) {
      logger.error(`Failed to save DOM structure: ${error.message}`);
    }

    // Get candidate XPaths from the LLM using the extracted DOM structure
    logger.info(`Using DOM structure (${domStructure.length} bytes) instead of full HTML (${htmlContent.length} bytes)`);
    logger.info(`Size reduction: ${Math.round((1 - domStructure.length / htmlContent.length) * 100)}%`);
    const candidateXPaths = await getLlmCandidateXPaths(domStructure, snippets);
    logger.info(`Got ${candidateXPaths.length} candidate XPaths from the LLM`);

    // Test each candidate XPath
    let bestXPath = null;
    let bestScore = 0;

    // Add the expected XPath to the candidates
    candidateXPaths.push("//article[@name='articleBody']");

    // Add other potential XPaths for NYT
    candidateXPaths.push("//article[@id='story']");
    candidateXPaths.push("//section[@name='articleBody']");
    candidateXPaths.push("//div[@class='article-content']");

    for (const xpath of candidateXPaths) {
      logger.info(`Testing XPath: ${xpath}`);
      try {
        const details = htmlAnalyser.queryStaticXPathWithDetails(htmlContent, xpath);

        if (details && details.element_found_count > 0) {
          logger.info(`Found ${details.element_found_count} elements with XPath: ${xpath}`);
          logger.info(`Element tag: ${details.tagName}, paragraphs: ${details.paragraphCount}`);

          // Score the element
          const score = scoreElement(details, details.element_found_count, xpath);

          if (score > bestScore) {
            bestScore = score;
            bestXPath = xpath;
            logger.info(`New best XPath: ${xpath} with score ${score}`);
          }

          // Try to extract content
          try {
            const content = htmlAnalyser.extractByXpath(htmlContent, xpath);
            if (content) {
              const contentPreview = content.substring(0, 200) + '...';
              logger.info(`Content preview: ${contentPreview}`);

              // Check if this element has an ID
              const idMatch = content.match(/id="([^"]+)"/);
              if (idMatch) {
                logger.info(`Element has ID: ${idMatch[1]}`);
              }

              // Check if this element has a class
              const classMatch = content.match(/class="([^"]+)"/);
              if (classMatch) {
                logger.info(`Element has class: ${classMatch[1]}`);
              }
            } else {
              logger.info(`No content extracted with XPath: ${xpath}`);
            }
          } catch (extractError) {
            logger.error(`Error extracting content with XPath ${xpath}: ${extractError.message}`);
          }
        } else {
          logger.info(`No elements found with XPath: ${xpath}`);
        }
      } catch (error) {
        logger.error(`Error testing XPath ${xpath}: ${error.message}`);
      }
    }

    if (bestXPath) {
      logger.info(`Best XPath found: ${bestXPath} with score ${bestScore}`);
    } else {
      logger.info(`No suitable XPath found.`);
    }
  } catch (error) {
    logger.error(`Unexpected error: ${error.message}`);
    logger.error(error.stack);
  }
}

// Run the test
testFindXPath().then(() => {
  logger.info('Test completed');
}).catch(err => {
  logger.error('Test failed with error:', err);
});
