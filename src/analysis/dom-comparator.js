// src/analysis/dom-comparator.js

import TurndownService from 'turndown';
import { diffChars } from 'diff'; // Using diffChars for a basic similarity score
import { logger } from '../utils/logger.js';
import { ExtractionError } from '../utils/error-handler.js';

class DomComparator {
    constructor(similarityThreshold = 0.90) { // Default 90% similarity
        this.turndownService = new TurndownService({
            headingStyle: 'atx',
            hr: '---',
            bulletListMarker: '*',
            codeBlockStyle: 'fenced',
            emDelimiter: '_',
            strongDelimiter: '**',
            linkStyle: 'inlined',
            linkReferenceStyle: 'full'
        });
        // Remove script and style tags before conversion as they cause a lot of noise
        this.turndownService.remove(['script', 'style', 'noscript', 'iframe', 'link', 'meta', 'head']);
        this.similarityThreshold = similarityThreshold;
        logger.info(`DomComparator initialized with similarity threshold: ${this.similarityThreshold}`);
    }

    _htmlToMarkdown(htmlString) {
        if (!htmlString || typeof htmlString !== 'string') {
            throw new ExtractionError('Invalid HTML string for Markdown conversion', {
                htmlProvided: !!htmlString,
                htmlType: typeof htmlString
            });
        }

        try {
            return this.turndownService.turndown(htmlString);
        } catch (error) {
            logger.warn(`Error converting HTML to Markdown: ${error.message}`);
            throw new ExtractionError('Error converting HTML to Markdown', {
                htmlLength: htmlString.length,
                error: error.message
            }, error);
        }
    }

    /**
     * Calculates a basic similarity score between two strings based on character differences.
     * Score = 1 - (number of differing characters / length of longer string)
     * @param {string} str1
     * @param {string} str2
     * @returns {number} Similarity score between 0 and 1.
     */
    _calculateSimilarity(str1, str2) {
        if (!str1 && !str2) return 1.0; // Both empty, considered identical
        if (!str1 || !str2) return 0.0; // One empty, other not, considered completely different

        const changes = diffChars(str1, str2);
        let commonChars = 0;
        let totalCharsInLongerString = Math.max(str1.length, str2.length);

        if (totalCharsInLongerString === 0) return 1.0; // Avoid division by zero if both were effectively empty after processing

        changes.forEach(part => {
            if (!part.added && !part.removed) {
                commonChars += part.count;
            }
        });
        // A more direct way:
        // let diffCount = 0;
        // changes.forEach(part => {
        //     if (part.added || part.removed) {
        //         diffCount += part.count;
        //     }
        // });
        // const similarity = 1 - (diffCount / totalCharsInLongerString);

        const similarity = commonChars / totalCharsInLongerString;
        return Math.max(0, Math.min(1, similarity)); // Ensure score is between 0 and 1
    }

    /**
     * Compares two HTML strings for similarity.
     * @param {string} htmlString1
     * @param {string} htmlString2
     * @returns {Promise<boolean>} True if similarity is above the threshold, false otherwise.
     */
    async compareDoms(htmlString1, htmlString2) {
        if (!htmlString1 && !htmlString2) {
            logger.debug("Both HTML strings are empty/null, considering them similar.");
            return true;
        }
        if (!htmlString1 || !htmlString2) {
            logger.debug("One HTML string is empty/null, considering them different.");
            throw new ExtractionError('Cannot compare DOMs - one HTML string is empty/null', {
                html1Provided: !!htmlString1,
                html2Provided: !!htmlString2
            });
        }

        const markdown1 = this._htmlToMarkdown(htmlString1);
        const markdown2 = this._htmlToMarkdown(htmlString2);

        // Further cleanup: remove excessive whitespace from markdown
        const cleanMd1 = markdown1.replace(/\s+/g, ' ').trim();
        const cleanMd2 = markdown2.replace(/\s+/g, ' ').trim();

        if (cleanMd1.length === 0 && cleanMd2.length === 0) {
            logger.debug("Both HTML strings resulted in empty markdown, considering them similar.");
            return true;
        }
         if (cleanMd1.length === 0 || cleanMd2.length === 0) {
            logger.debug("One HTML string resulted in empty markdown, considering them different.");
            throw new ExtractionError('Cannot compare DOMs - one HTML string resulted in empty markdown', {
                markdown1Length: cleanMd1.length,
                markdown2Length: cleanMd2.length
            });
        }


        const similarityScore = this._calculateSimilarity(cleanMd1, cleanMd2);
        logger.info(`DOM similarity score: ${similarityScore.toFixed(4)}`);

        return similarityScore >= this.similarityThreshold;
    }
}

export { DomComparator };
