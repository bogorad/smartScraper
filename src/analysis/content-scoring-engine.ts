// src/analysis/content-scoring-engine.ts
import { logger } from '../utils/logger.js';
import { scraperSettings, ScoreWeights } from '../../config/index.js';

export interface ElementDetails {
  xpath: string;
  element_found_count?: number;
  tagName?: string | null; // Allow null
  id?: string | null; // Allow null
  className?: string | null; // Allow null
  textContentLength?: number;
  paragraphCount?: number;
  linkCount?: number;
  imageCount?: number;
  videoCount?: number;
  audioCount?: number; // Added
  pictureCount?: number; // Added
  unwantedTagCount?: number;
  totalDescendantElements?: number; // Added
  innerHTML?: string;
  innerHTMLSample?: string; // Added for consistency with HtmlAnalyserFixed
}

class ContentScoringEngine {
  private weights: ScoreWeights;
  private minParagraphThreshold: number;
  private descriptiveKeywords: string[];
  private tagsToCount: Set<string>;
  private unwantedTags: Set<string>;

  constructor(scoreWeights?: ScoreWeights, minParagraphThreshold?: number, descriptiveKeywords?: string[]) {
    this.weights = scoreWeights || scraperSettings.scoreWeights || {
      isSingleElement: 20,
      paragraphCount: 2,
      textDensity: 30,
      linkDensityPenaltyFactor: -40,
      isSemanticTag: 15,
      hasDescriptiveIdOrClass: 25,
      xpathDepthBonus: 1,
      mediaPresenceBonus: 5,
      unwantedTagPenalty: -10,
      contentSpecificIdBonus: 50,
      contentSpecificClassBonus: 40,
      classNameIncludesContentBonus: 20,
      attributeNameBonus: 15,
      shallowHierarchyPenalty: -30,
      minDepthForShallowPenalty: 3,
    };
    this.minParagraphThreshold = minParagraphThreshold ?? scraperSettings.minParagraphThreshold ?? 3;
    this.descriptiveKeywords = (descriptiveKeywords && descriptiveKeywords.length > 0)
        ? descriptiveKeywords.map(k => k.toLowerCase())
        : (scraperSettings.descriptiveKeywords || [
            'article', 'content', 'main', 'story', 'post', 'body', 'text', 'entry', 'blog', 'news', 'paywall'
          ]).map(k => k.toLowerCase());

    this.tagsToCount = new Set(['p', 'h1', 'h2', 'h3', 'img', 'video', 'ul', 'ol', 'blockquote', 'figure', 'figcaption', 'a']);
    this.unwantedTags = new Set(['nav', 'footer', 'aside', 'header', 'form', 'script', 'style', 'figcaption', 'figure', 'details', 'summary', 'menu', 'dialog']);
    
    logger.info('ContentScoringEngine initialized with enhanced scoring logic.');
    if (scraperSettings.debug) {
        logger.debug('[DEBUG_MODE] ContentScoringEngine constructor params:', {
            scoreWeightsKeys: Object.keys(scoreWeights || {}).length > 0 ? Object.keys(scoreWeights as object) : 'Used defaults from scraperSettings',
            minParagraphThreshold: this.minParagraphThreshold,
            descriptiveKeywordsLength: this.descriptiveKeywords.length
        });
        logger.debug('[DEBUG_MODE] ContentScoringEngine effective weights:', this.weights);
    }
  }

  scoreElement(elementDetails: ElementDetails): number {
    if (scraperSettings.debug) {
        logger.debug('[DEBUG_MODE] ContentScoringEngine.scoreElement called with details (innerHTML truncated):', JSON.stringify(elementDetails, (key, value) => (key === 'innerHTML' && typeof value === 'string' && value.length > 200) ? value.substring(0,200) + '...' : value, 2));
    }

    if (!elementDetails || !elementDetails.xpath) {
      logger.error('Cannot score element - missing element details or XPath.');
      throw new Error('Programming Error: scoreElement called with invalid elementDetails.');
    }

    const {
      xpath,
      element_found_count = 0,
      tagName,
      id,
      className,
      textContentLength = 0,
      paragraphCount = 0,
      linkCount = 0,
      imageCount = 0,
      videoCount = 0,
      unwantedTagCount = 0,
    } = elementDetails;

    if (element_found_count === 0) {
      logger.warn(`Cannot score XPath ${elementDetails.xpath}: element_found_count is 0 or undefined.`);
      return -Infinity; 
    }
    
    if (paragraphCount < this.minParagraphThreshold) {
        return -Infinity;
    }

    let score = 0;

    if (element_found_count > 1) {
      const penalty = Math.abs(this.weights.isSingleElement || 0); 
      score -= penalty * (element_found_count -1) ; 
    } else {
      score += (this.weights.isSingleElement || 0);
    }

    score += paragraphCount * (this.weights.paragraphCount || 0);

    if (textContentLength > 0) {
        score += (textContentLength / 1000) * (this.weights.textDensity || 0); 
    }

    const linkDensity = textContentLength > 0 ? linkCount / textContentLength : (linkCount > 0 ? 1 : 0);
    if (linkDensity > 0.1 && linkCount > 5) { 
      score += linkDensity * (this.weights.linkDensityPenaltyFactor || 0) * (linkCount / 10); 
    }

    const semanticTags = ['article', 'main', 'section']; 
    if (tagName && semanticTags.includes(tagName.toLowerCase())) {
      score += (this.weights.isSemanticTag || 0);
    }

    const idLower = (id || '').toLowerCase();
    const classLower = (className || '').toLowerCase();
    
    if (this.descriptiveKeywords.some(keyword => idLower.includes(keyword))) {
        score += (this.weights.contentSpecificIdBonus || 0);
    }
    if (this.descriptiveKeywords.some(keyword => classLower.split(' ').some(cls => cls.includes(keyword)))) {
        score += (this.weights.contentSpecificClassBonus || 0);
    }
     if (classLower.includes('content')) { 
        score += (this.weights.classNameIncludesContentBonus || 0);
    }
    
    const depth = (xpath.match(/\//g) || []).length;
    if (depth < (this.weights.minDepthForShallowPenalty || 3)) { 
        score += (this.weights.shallowHierarchyPenalty || 0);
    } else {
        score += depth * (this.weights.xpathDepthBonus || 0); 
    }

    if (imageCount > 0 || videoCount > 0) {
      score += (this.weights.mediaPresenceBonus || 0) * Math.min(imageCount + videoCount, 5); 
    }

    if (unwantedTagCount > 0) {
      score += unwantedTagCount * (this.weights.unwantedTagPenalty || 0);
    }
    
    if (scraperSettings.debug) {
        logger.info(`Final score for XPath ${xpath}: ${score.toFixed(2)} (P: ${paragraphCount}, Links: ${linkCount}, TextLen: ${textContentLength}, Found: ${element_found_count}, Tag: ${tagName})`);
    }
    return score === -Infinity ? -Infinity : Math.max(0, score); 
  }
}

export { ContentScoringEngine };
