// src/analysis/content-scoring-engine.js
import { logger } from '../utils/logger.js';
import { ExtractionError } from '../utils/error-handler.js';

class ContentScoringEngine {
  constructor(
    scoreWeights,
    minParagraphThreshold,
    descriptiveKeywords = ['article', 'content', 'main', 'body', 'story', 'post', 'entry', 'text', 'copy', 'primary', 'container'],
    contentIdKeywordsRegex = /article-content|content|article-body|main-content|story-content|post-content/i,
    contentClassKeywordsRegex = /article__content|article-content|entry-content|post-body|story-body|content-body|article-body|article__body|article-dropcap|paywall-content/i
  ) {
    this.weights = scoreWeights || { /* Default weights if none provided */
      isSingleElement: 20, paragraphCount: 2, unwantedPenaltyRatio: -75,
      isSemanticTag: 15, hasDescriptiveIdOrClass: 10, textDensity: 30,
      linkDensityPenalty: -40, mediaPresence: 5, xpathComplexityPenalty: -0.5,
      contentSpecificIdBonus: 60, contentSpecificClassBonus: 50,
      classNameIncludesContentBonus: 30, attributeNameArticleBodyBonus: 70,
      shallowHierarchyPenalty: -20,
    };
    this.minParagraphThreshold = minParagraphThreshold || 3;
    // Tags considered important for content scoring (can be expanded or made configurable)
    this.tagsToCount = new Set(['p', 'h1', 'h2', 'h3', 'img', 'video', 'ul', 'ol', 'blockquote', 'figure', 'figcaption', 'a']); // Added 'a' for link density
    // Tags often indicating non-main content, used for penalty calculation
    this.unwantedTags = new Set(['nav', 'footer', 'aside', 'header', 'form', 'script', 'style', 'figcaption', 'figure', 'details', 'summary', 'menu', 'dialog']);
    this.descriptiveKeywords = descriptiveKeywords.map(k => k.toLowerCase());
    this.contentIdKeywordsRegex = contentIdKeywordsRegex;
    this.contentClassKeywordsRegex = contentClassKeywordsRegex;

    logger.info('ContentScoringEngine initialized with enhanced scoring logic.');
  }

  /**
   * Scores a potential main content element based on various heuristics.
   * @param {object} elementDetails - Object containing details of the element.
   *        Expected fields: xpath, element_found_count, tagName, id, className,
   *                         textContentLength, innerHTML (full HTML of the element),
   *                         paragraphCount, linkCount, imageCount, videoCount (optional),
   *                         audioCount (optional), pictureCount (optional),
   *                         totalDescendantElements, unwantedTagCount (optional).
   * @returns {number} The calculated score for the element.
   */
  scoreElement(elementDetails) {
    if (!elementDetails || !elementDetails.xpath) {
      logger.error('Cannot score element - missing element details or XPath.');
      throw new ExtractionError('Cannot score element - missing element details or XPath', {
        elementDetailsProvided: !!elementDetails,
        xpathProvided: !!elementDetails?.xpath
      });
    }

    // 0. Basic viability: Must have found at least one element
    if (elementDetails.element_found_count === undefined || elementDetails.element_found_count < 1) {
      logger.warn(`Cannot score XPath ${elementDetails.xpath}: element_found_count is 0 or undefined.`);
      // This case should ideally be filtered out before scoring, but as a safeguard:
      return -Infinity;
    }

    let score = 0;
    const {
      xpath, element_found_count, tagName: rawTagName, id: rawId, className: rawClassName,
      textContentLength, innerHTML, paragraphCount, linkCount,
      imageCount = 0, videoCount = 0, audioCount = 0, pictureCount = 0, // Default media counts to 0
      totalDescendantElements
    } = elementDetails;

    const pCount = paragraphCount || 0;

    // 1. Uniqueness of XPath
    if (element_found_count > 1) {
      const penalty = (this.weights.isSingleElement || 0) * (element_found_count - 1);
      score -= penalty;
      logger.debug(`Score for ${xpath}: Non-unique XPath penalty (-${penalty.toFixed(1)}) for finding ${element_found_count} elements.`);
    } else {
      score += (this.weights.isSingleElement || 0);
      logger.debug(`Score for ${xpath}: Unique XPath bonus (+${(this.weights.isSingleElement || 0).toFixed(1)}).`);
    }

    // 2. Paragraph Count (Critical)
    if (pCount < this.minParagraphThreshold) {
      logger.debug(`Element by XPath ${xpath} failed min paragraph threshold (${pCount} < ${this.minParagraphThreshold})`);
      return -Infinity; // Fails if below minimum paragraph threshold
    }
    score += pCount * (this.weights.paragraphCount || 0);
    logger.debug(`Score for ${xpath}: Paragraph count bonus (+${(pCount * (this.weights.paragraphCount || 0)).toFixed(1)}).`);

    const tagName = (rawTagName || '').toLowerCase();
    const id = (rawId || '').toLowerCase();
    const classNamesString = (rawClassName || '').toLowerCase();

    // 3. Semantic Tag Bonus
    if (tagName === 'article' || tagName === 'main') {
      score += (this.weights.isSemanticTag || 0);
      logger.debug(`Score for ${xpath}: Semantic tag bonus (+${(this.weights.isSemanticTag || 0).toFixed(1)}).`);
    } else if (tagName === 'section' || tagName === 'div') {
        // Check for descriptive keywords in general purpose containers
        if (this.descriptiveKeywords.some(keyword => id.includes(keyword) || classNamesString.includes(keyword))) {
            score += (this.weights.hasDescriptiveIdOrClass || 0);
            logger.debug(`Score for ${xpath}: Descriptive ID/Class bonus (+${(this.weights.hasDescriptiveIdOrClass || 0).toFixed(1)}).`);
        } else if (tagName === 'div') { // Penalize generic divs slightly if not descriptive
            score -= 5; // Small penalty
            logger.debug(`Score for ${xpath}: Generic DIV penalty (-5).`);
        }
    }


    // 4. Highly Specific Content Keyword Bonuses
    if (id && this.contentIdKeywordsRegex && this.contentIdKeywordsRegex.test(id)) {
      score += (this.weights.contentSpecificIdBonus || 0);
      logger.debug(`Score for ${xpath}: Content-specific ID bonus (+${(this.weights.contentSpecificIdBonus || 0).toFixed(1)}).`);
    }
    if (classNamesString && this.contentClassKeywordsRegex && this.contentClassKeywordsRegex.test(classNamesString)) {
      score += (this.weights.contentSpecificClassBonus || 0);
      logger.debug(`Score for ${xpath}: Content-specific class bonus (+${(this.weights.contentSpecificClassBonus || 0).toFixed(1)}).`);
    }
    if (classNamesString && classNamesString.includes('content')) { // Simpler check
      score += (this.weights.classNameIncludesContentBonus || 0);
      logger.debug(`Score for ${xpath}: Class name includes 'content' bonus (+${(this.weights.classNameIncludesContentBonus || 0).toFixed(1)}).`);
    }
    if (xpath.includes('@name=\'articleBody\'') || xpath.includes('@name="articleBody"')) {
      score += (this.weights.attributeNameArticleBodyBonus || 0);
      logger.debug(`Score for ${xpath}: Attribute name="articleBody" bonus (+${(this.weights.attributeNameArticleBodyBonus || 0).toFixed(1)}).`);
    }

    // 5. Text Density
    const innerHTMLLength = (innerHTML || '').length;
    if (innerHTMLLength > 50 && textContentLength > 0) { // Avoid division by zero and meaningless density for tiny elements
      const density = textContentLength / innerHTMLLength;
      // Apply a non-linear bonus for density, e.g., sqrt, to reward higher densities more significantly but not excessively
      const densityBonus = Math.pow(Math.max(0, density), 0.5) * (this.weights.textDensity || 0);
      score += densityBonus;
      logger.debug(`Score for ${xpath}: Text density (${density.toFixed(3)}) bonus (+${densityBonus.toFixed(1)}).`);
      if (density < 0.1 && textContentLength > 100) { // Penalize very low density if there's some text
          score -= 15;
          logger.debug(`Score for ${xpath}: Low text density penalty (-15).`);
      }
    } else if (textContentLength > 100) { // Some text but no innerHTML (e.g. text node directly under XPath)
        score += 10; // Small bonus
        logger.debug(`Score for ${xpath}: Text content present without innerHTML bonus (+10).`);
    }


    // 6. Link Density Penalty
    const effectiveTotalDescendants = Math.max(1, totalDescendantElements || 1); // Avoid division by zero
    if (linkCount > 1 && effectiveTotalDescendants > 5) { // Only apply if there are several links and some descendants
      const density = linkCount / effectiveTotalDescendants;
      // Penalize more aggressively if link density is high
      const penaltyFactor = Math.min(1, density * 10); // Scale penalty factor, cap at 1
      const penalty = penaltyFactor * (this.weights.linkDensityPenalty || 0);
      score += penalty;
      logger.debug(`Score for ${xpath}: Link density (${density.toFixed(3)}) penalty (${penalty.toFixed(1)}).`);
      if (density > 0.5 && linkCount > 5) { // Very high link density
          score -= 50; // Additional heavy penalty
          logger.debug(`Score for ${xpath}: Very high link density additional penalty (-50).`);
      }
    }

    // 7. Media Presence Bonus
    const mediaCount = (imageCount || 0) + (videoCount || 0) + (audioCount || 0) + (pictureCount || 0);
    if (mediaCount > 0 && pCount > 0) { // Only give media bonus if there are also paragraphs
      const mediaBonus = Math.min((this.weights.mediaPresence || 0), mediaCount * 5); // Cap bonus from media
      score += mediaBonus;
      logger.debug(`Score for ${xpath}: Media presence (${mediaCount}) bonus (+${mediaBonus.toFixed(1)}).`);
    }

    // 8. XPath Complexity and Shallow Hierarchy Penalty
    const xpathSegments = xpath.split('/');
    const depth = xpathSegments.length -1; // Number of segments roughly indicates depth
    const predicateCount = (xpath.match(/\[.*?\]/g) || []).length;
    const complexity = depth + predicateCount * 2; // Predicates add more complexity

    if (depth <= 2 && predicateCount < 2) { // e.g., //main, //article, //div[@id='content']
      score += (this.weights.shallowHierarchyPenalty || 0);
      logger.debug(`Score for ${xpath}: Shallow hierarchy penalty (${(this.weights.shallowHierarchyPenalty || 0).toFixed(1)}).`);
    }
    const complexityPenaltyValue = Math.min(20, complexity * Math.abs(this.weights.xpathComplexityPenalty || 0)); // Cap penalty
    score -= complexityPenaltyValue;
    logger.debug(`Score for ${xpath}: XPath complexity (${complexity}) penalty (-${complexityPenaltyValue.toFixed(1)}).`);


    // 9. Unwanted Tag Penalty (using unwantedTagCount if provided by elementDetails)
    const unwantedTagCount = elementDetails.unwantedTagCount || 0;
    if (unwantedTagCount > 0 && effectiveTotalDescendants > 5) {
        const ratio = unwantedTagCount / effectiveTotalDescendants;
        const penaltyFactor = Math.min(1, ratio * 5); // Scale penalty factor
        const penalty = penaltyFactor * (this.weights.unwantedPenaltyRatio || 0);
        score += penalty;
        logger.debug(`Score for ${xpath}: Unwanted tag ratio (${ratio.toFixed(3)}) penalty (${penalty.toFixed(1)}).`);
    } else if (unwantedTagCount > 1) { // If few descendants but still unwanted tags
        score += (this.weights.unwantedPenaltyRatio || 0) * 0.2; // Smaller fixed penalty
        logger.debug(`Score for ${xpath}: Unwanted tags (${unwantedTagCount}) fixed penalty (${((this.weights.unwantedPenaltyRatio || 0) * 0.2).toFixed(1)}).`);
    }


    logger.info(`Final score for XPath ${xpath}: ${score.toFixed(2)} (P: ${pCount}, Links: ${linkCount}, TextLen: ${textContentLength}, Found: ${element_found_count})`);
    return Math.max(0, score); // Ensure score is not negative unless it's -Infinity from paragraph threshold
  }
}

export { ContentScoringEngine };
