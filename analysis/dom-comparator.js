// src/analysis/dom-comparator.js
import TurndownService from 'turndown';
import { diffChars } from 'diff';
import { logger } from '../utils/logger.js';
import { ExtractionError } from '../utils/error-handler.js';

class DomComparator {
  constructor(similarityThreshold = 0.60) { // Default 60% similarity
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '*',
      codeBlockStyle: 'fenced',
      emDelimiter: '_',
    });
    // Remove script and style tags before conversion as they cause a lot of noise
    this.turndownService.remove(['script', 'style', 'noscript', 'iframe', 'link', 'meta', 'head']);
    this.similarityThreshold = similarityThreshold;
    logger.info(`DomComparator initialized with similarity threshold: ${this.similarityThreshold}`);
  }

  _htmlToMarkdown(htmlString) {
    if (typeof htmlString !== 'string') {
      logger.warn('_htmlToMarkdown: htmlString is not a string.');
      throw new ExtractionError('Invalid HTML string for Markdown conversion', {
        inputType: typeof htmlString
      });
    }
    try {
      return this.turndownService.turndown(htmlString);
    } catch (error) {
      logger.warn(`Error converting HTML to Markdown: ${error.message}`);
      throw new ExtractionError('Error converting HTML to Markdown', {
        originalError: error.message,
        htmlSnippet: htmlString.substring(0, 200)
      });
    }
  }

  _calculateSimilarity(str1, str2) {
    if (!str1 && !str2) return 1.0;
    if (!str1 || !str2) return 0.0;

    const changes = diffChars(str1, str2);
    let differingChars = 0;
    changes.forEach(part => {
      if (part.added || part.removed) {
        differingChars += part.count;
      }
    });

    let totalCharsInLongerString = Math.max(str1.length, str2.length);
    if (totalCharsInLongerString === 0) return 1.0;

    const similarity = 1 - (differingChars / totalCharsInLongerString);
    return Math.max(0, Math.min(1, similarity));
  }

  async compareDoms(htmlString1, htmlString2) {
    if (!htmlString1 && !htmlString2) {
      logger.debug("Both HTML strings are empty/null, considering them similar.");
      return true;
    }
    if (!htmlString1 || !htmlString2) {
      logger.debug("One HTML string is empty/null, considering them different.");
      // This might not be an error, but a valid state indicating difference.
      // Depending on strictness, an error could be thrown or just return false.
      // For now, let's treat it as a clear difference.
      return false;
    }

    const markdown1 = this._htmlToMarkdown(htmlString1);
    const markdown2 = this._htmlToMarkdown(htmlString2);

    const cleanMd1 = markdown1.replace(/\s+/g, ' ').trim();
    const cleanMd2 = markdown2.replace(/\s+/g, ' ').trim();

    if (!cleanMd1 && !cleanMd2) {
        logger.debug("Both HTML strings resulted in empty markdown after cleaning, considering them similar.");
        return true;
    }
    if (!cleanMd1 || !cleanMd2) {
        logger.debug("One HTML string resulted in empty markdown after cleaning, considering them different.");
        return false;
    }

    const similarityScore = this._calculateSimilarity(cleanMd1, cleanMd2);
    logger.info(`DOM similarity score: ${similarityScore.toFixed(4)}`);
    return similarityScore >= this.similarityThreshold;
  }
}

export { DomComparator };
