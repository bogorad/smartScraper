// test-scraper.js
import { scrapeUrl, defaultLlmConfig } from './src/index.js';
import { logger } from './src/utils/logger.js';
import { HtmlAnalyser } from './src/analysis/html-analyser.js';
import { HtmlAnalyserFixed } from './src/analysis/html-analyser-fixed.js';
import { fetchWithCurl } from './src/network/curl-handler.js';
import fs from 'fs/promises';
import path from 'path';
import { JSDOM } from 'jsdom';
import xpath from 'xpath';

// Set a higher log level to see more details
process.env.LOG_LEVEL = 'DEBUG';

// Log the environment variables and configuration
logger.info(`Environment LLM_MODEL: ${process.env.LLM_MODEL}`);
logger.info(`Configured LLM model: ${defaultLlmConfig.model}`);

async function testXPath() {
  // URL to test
  const url = 'https://www.cnn.com/2025/05/15/politics/what-to-watch-supreme-court-birthright-citizenship';

  logger.info(`Testing specific XPath for URL: ${url}`);

  try {
    // Get the HTML content using cURL
    const curlResponse = await fetchWithCurl(url);
    if (!curlResponse.success) {
      logger.error(`Failed to fetch URL with cURL: ${curlResponse.error}`);
      return;
    }

    const htmlContent = curlResponse.html;
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

    // Create both HTML analyzers for comparison
    const htmlAnalyser = new HtmlAnalyser();
    const htmlAnalyserFixed = new HtmlAnalyserFixed();

    // Test different XPath expressions with focus on the specific one
    const xpaths = [
      "//div[@class='article__content']",
      "//div[contains(@class, 'article__content')]",
      "//div[@class='article__content' and @data-editable='content']",
      "//div[@data-editable='content' and @itemprop='articleBody']",
      "//div[contains(@class, 'article__content') and @data-editable='content']"
    ];

    // Let's also directly search for the string in the HTML
    const articleContentClassCount = (htmlContent.match(/class="article__content"/g) || []).length;
    logger.info(`Found ${articleContentClassCount} occurrences of class="article__content" in the HTML`);

    // Check if there are any div elements with this class
    const divWithClassCount = (htmlContent.match(/<div[^>]*class="article__content"[^>]*>/g) || []).length;
    logger.info(`Found ${divWithClassCount} div elements with class="article__content" in the HTML`);

    // Let's extract a sample of the HTML around one of these divs
    const match = htmlContent.match(/([\s\S]{0,100})<div[^>]*class="article__content"[^>]*>([\s\S]{0,100})/);
    if (match) {
      logger.info(`Context before div: ${match[1]}`);
      logger.info(`Context after div: ${match[2]}`);
    } else {
      logger.info('Could not find context around div with class="article__content"');
    }

    // Let's try a direct JSDOM approach
    try {
      logger.info('Trying direct JSDOM approach...');
      const dom = new JSDOM(htmlContent);
      const document = dom.window.document;

      // Try different ways to find the element
      const byQuerySelector = document.querySelector('div.article__content');
      logger.info(`Found by querySelector: ${byQuerySelector ? 'Yes' : 'No'}`);

      const byGetElementsByClassName = document.getElementsByClassName('article__content');
      logger.info(`Found by getElementsByClassName: ${byGetElementsByClassName.length} elements`);

      // Try XPath directly with xpath library
      const nodes = xpath.select("//div[@class='article__content']", document);
      logger.info(`Found by xpath.select: ${nodes.length} elements`);

      // Try a different approach - get all divs and filter
      const allDivs = document.getElementsByTagName('div');
      logger.info(`Total divs in document: ${allDivs.length}`);

      let matchingDivs = 0;
      for (let i = 0; i < allDivs.length; i++) {
        const div = allDivs[i];
        if (div.className === 'article__content') {
          matchingDivs++;
          logger.info(`Found matching div at index ${i}`);

          // Try to extract content from this div
          const content = div.innerHTML.substring(0, 200) + '...';
          logger.info(`Content preview: ${content}`);

          // Try a different XPath approach
          try {
            const xpathResult = document.evaluate("//div[@class='article__content']", document, null,
                                                 dom.window.XPathResult.ANY_TYPE, null);
            let matchingNode = xpathResult.iterateNext();
            logger.info(`document.evaluate found node: ${matchingNode ? 'Yes' : 'No'}`);
          } catch (xpathError) {
            logger.error(`XPath evaluation error: ${xpathError.message}`);
          }
        }
      }
      logger.info(`Found ${matchingDivs} divs with class="article__content" by manual iteration`);

      if (byGetElementsByClassName.length > 0) {
        const element = byGetElementsByClassName[0];
        logger.info(`Element tag: ${element.tagName}`);
        logger.info(`Element class: ${element.className}`);
        logger.info(`Element attributes: ${element.attributes.length}`);

        // List all attributes
        for (let i = 0; i < element.attributes.length; i++) {
          const attr = element.attributes[i];
          logger.info(`Attribute ${i}: ${attr.name}="${attr.value}"`);
        }

        // Check if there are any spaces or special characters in the class name
        const classNameHex = Array.from(element.className).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
        logger.info(`Class name hex: ${classNameHex}`);
      }
    } catch (error) {
      logger.error(`Error with direct JSDOM approach: ${error.message}`);
    }

    for (const xpath of xpaths) {
      logger.info(`Testing XPath with original HtmlAnalyser: ${xpath}`);
      try {
        const details = htmlAnalyser.queryStaticXPathWithDetails(htmlContent, xpath);
        logger.info(`Original HtmlAnalyser results:`, details);

        if (details && details.element_found_count > 0) {
          logger.info(`Found ${details.element_found_count} elements with XPath: ${xpath}`);
          logger.info(`Element tag: ${details.tagName}, paragraphs: ${details.paragraphCount}`);

          // Try to extract content
          const content = htmlAnalyser.extractByXpath(htmlContent, xpath);
          if (content) {
            const contentPreview = content.substring(0, 200) + '...';
            logger.info(`Content preview: ${contentPreview}`);
          } else {
            logger.info(`No content extracted with XPath: ${xpath}`);
          }
        } else {
          logger.info(`No elements found with XPath: ${xpath}`);
        }
      } catch (error) {
        logger.error(`Error testing XPath with original HtmlAnalyser ${xpath}: ${error.message}`);
      }

      // Now test with the fixed HtmlAnalyser
      logger.info(`Testing XPath with fixed HtmlAnalyser: ${xpath}`);
      try {
        const detailsFixed = htmlAnalyserFixed.queryStaticXPathWithDetails(htmlContent, xpath);
        logger.info(`Fixed HtmlAnalyser results:`, detailsFixed);

        if (detailsFixed && detailsFixed.element_found_count > 0) {
          logger.info(`Found ${detailsFixed.element_found_count} elements with XPath: ${xpath}`);
          logger.info(`Element tag: ${detailsFixed.tagName}, paragraphs: ${detailsFixed.paragraphCount}`);

          // Try to extract content
          const contentFixed = htmlAnalyserFixed.extractByXpath(htmlContent, xpath);
          if (contentFixed) {
            const contentPreview = contentFixed.substring(0, 200) + '...';
            logger.info(`Content preview: ${contentPreview}`);
          } else {
            logger.info(`No content extracted with XPath: ${xpath}`);
          }
        } else {
          logger.info(`No elements found with XPath: ${xpath}`);
        }
      } catch (error) {
        logger.error(`Error testing XPath with fixed HtmlAnalyser ${xpath}: ${error.message}`);
      }
    }
  } catch (error) {
    logger.error(`Unexpected error: ${error.message}`);
    logger.error(error.stack);
  }
}

// Original test function
async function testScraper() {
  // URL to test
  const url = 'https://www.cnn.com/2025/05/15/politics/what-to-watch-supreme-court-birthright-citizenship';

  logger.info(`Starting test scrape for URL: ${url}`);

  try {
    const result = await scrapeUrl(url);

    if (result.success) {
      logger.info('Scraping successful!');
      logger.info(`Method used: ${result.method}`);
      logger.info(`XPath used: ${result.xpath}`);

      // Log a snippet of the content
      const contentPreview = result.data.substring(0, 200) + '...';
      logger.info(`Content preview: ${contentPreview}`);
    } else {
      logger.error(`Scraping failed: ${result.error}`);
      if (result.errorDetails) {
        logger.error('Error details:', result.errorDetails);
      }
    }
  } catch (error) {
    logger.error(`Unexpected error: ${error.message}`);
    logger.error(error.stack);
  }
}

// Run the full scraper test now that we've fixed the HtmlAnalyser
testScraper().then(() => {
  logger.info('Scraper test completed');
}).catch(err => {
  logger.error('Scraper test failed with error:', err);
});
