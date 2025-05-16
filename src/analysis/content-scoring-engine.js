// src/analysis/content-scoring-engine.js
import { logger } from '../utils/logger.js';
import { ExtractionError } from '../utils/error-handler.js';

class ContentScoringEngine {
    constructor(
        scoreWeights,
        minParagraphThreshold,
        tagsToCount = ['p', 'h1', 'h2', 'h3', 'img', 'video', 'ul', 'ol', 'blockquote'], // Simplified default
        unwantedTags = ['nav', 'footer', 'aside', 'header', 'form', 'script', 'style'], // Simplified default
        descriptiveKeywords = ['article', 'content', 'main', 'body', 'story', 'post', 'entry'] // Simplified default
    ) {
        this.weights = scoreWeights || { /* Default weights if none provided */
            isSingleElement: 20, paragraphCount: 2, unwantedPenaltyRatio: -50,
            isSemanticTag: 15, hasDescriptiveIdOrClass: 10, textDensity: 30,
            linkDensityPenalty: -40, mediaPresence: 5, xpathComplexityPenalty: -0.5
        };
        this.minParagraphThreshold = minParagraphThreshold || 3;
        this.tagsToCount = new Set(tagsToCount); // For quick lookups
        this.unwantedTags = new Set(unwantedTags);
        this.descriptiveKeywords = descriptiveKeywords.map(k => k.toLowerCase());
        logger.info('ContentScoringEngine initialized.');
    }

    /**
     * Scores a potential main content element based on various heuristics.
     * @param {object} elementDetails - Object containing details of the element.
     *        Expected fields: xpath, element_found_count, tagName, id, className,
     *                         textContentLength, innerHTMLSnippet (or full innerHTML),
     *                         paragraphCount, linkCount, imageCount, videoCount (optional),
     *                         totalDescendantElements.
     * @returns {number} The calculated score for the element.
     */
    scoreElement(elementDetails) {
        if (!elementDetails) {
            throw new ExtractionError('Cannot score element - missing element details', {
                elementDetails: null
            });
        }

        let score = 0;

        // 0. Basic viability: Must have found at least one element
        if (elementDetails.element_found_count === 0) {
            throw new ExtractionError('Cannot score element - no elements found with the given XPath', {
                xpath: elementDetails.xpath,
                elementFoundCount: 0
            });
        }

        // 1. Uniqueness of XPath (if element_found_count is available from a broader query)
        //    For now, we assume elementDetails is for a *single* candidate element.
        //    If element_found_count > 1, it means the XPath is not specific enough.
        if (elementDetails.element_found_count === 1) {
            score += this.weights.isSingleElement || 0;
        } else if (elementDetails.element_found_count > 1) {
            score -= (this.weights.isSingleElement || 0) * (elementDetails.element_found_count -1) ; // Penalize non-unique XPaths
        }


        // 2. Paragraph Count (Critical)
        const pCount = elementDetails.paragraphCount || 0;
        if (pCount < this.minParagraphThreshold) {
            logger.debug(`Element by XPath ${elementDetails.xpath} failed min paragraph threshold (${pCount} < ${this.minParagraphThreshold})`);
            return -Infinity; // Fails if below minimum paragraph threshold
        }
        score += pCount * (this.weights.paragraphCount || 0);

        // 3. Semantic Tag Bonus
        const tagName = (elementDetails.tagName || '').toLowerCase();
        if (tagName === 'article' || tagName === 'main') {
            score += this.weights.isSemanticTag || 0;
        }

        // 4. Descriptive ID or Class
        const id = (elementDetails.id || '').toLowerCase();
        const classNames = (elementDetails.className || '').toLowerCase().split(/\s+/);
        let hasDescriptive = false;
        for (const keyword of this.descriptiveKeywords) {
            if (id.includes(keyword)) {
                hasDescriptive = true;
                break;
            }
            for (const cls of classNames) {
                if (cls.includes(keyword)) {
                    hasDescriptive = true;
                    break;
                }
            }
            if (hasDescriptive) break;
        }
        if (hasDescriptive) {
            score += this.weights.hasDescriptiveIdOrClass || 0;
        }

        // 5. Text Density (Ratio of text length to innerHTML length)
        //    Requires full innerHTML, not just snippet. Assuming elementDetails.innerHTML is available.
        const innerHTMLLength = (elementDetails.innerHTML || elementDetails.innerHTMLSnippet || '').length; // Use full innerHTML if available
        const textContentLength = elementDetails.textContentLength || 0;
        if (innerHTMLLength > 0) {
            const textDensity = textContentLength / innerHTMLLength;
            score += textDensity * (this.weights.textDensity || 0);
        }

        // 6. Link Density Penalty (Ratio of link count to total descendant elements or text length)
        const linkCount = elementDetails.linkCount || 0;
        const totalDescendants = elementDetails.totalDescendantElements || 1; // Avoid division by zero
        if (totalDescendants > 0 && textContentLength > 100) { // Only apply if there's substantial content
            const linkDensity = linkCount / totalDescendants; // Or linkCount / (textContentLength / 100) for links per 100 chars
            // Penalize more if link density is high (e.g., > 0.1 or 0.2)
            if (linkDensity > 0.1) {
                 score += (linkDensity - 0.1) * 10 * (this.weights.linkDensityPenalty || 0); // Scale penalty
            }
        } else if (linkCount > 5 && textContentLength < 200) { // Many links in short content
            score += (this.weights.linkDensityPenalty || 0) * 2; // Heavier penalty
        }


        // 7. Media Presence (Bonus for images/videos)
        const mediaCount = (elementDetails.imageCount || 0) + (elementDetails.videoCount || 0);
        if (mediaCount > 0) {
            score += Math.min(mediaCount, 5) * (this.weights.mediaPresence || 0); // Cap bonus from media
        }

        // 8. XPath Complexity Penalty (Penalize overly long/complex XPaths)
        const xpathLength = (elementDetails.xpath || '').length;
        if (xpathLength > 50) { // Arbitrary threshold for "complex"
            score += (xpathLength / 10) * (this.weights.xpathComplexityPenalty || 0);
        }

        // 9. Unwanted Tag Penalty (Requires parsing innerHTML or more detailed descendant info)
        // This is harder without full DOM access to the element's children.
        // If elementDetails provided counts of unwanted tags within, we could use it.
        // For now, this is a placeholder or would require elementDetails to be richer.
        // Example: if (elementDetails.unwantedTagRatio > 0.3) score += elementDetails.unwantedTagRatio * (this.weights.unwantedPenaltyRatio || 0);

        logger.debug(`Score for XPath ${elementDetails.xpath}: ${score.toFixed(2)} (p: ${pCount}, links: ${linkCount}, textLen: ${textContentLength})`);
        return score;
    }
}

export { ContentScoringEngine };
