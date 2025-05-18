// tests/analysis/content-scoring-engine.test.ts
import { ContentScoringEngine, ElementDetails } from '../../src/analysis/content-scoring-engine';
import { scraperSettings } from '../../config/index'; // For default weights

describe('ContentScoringEngine', () => {
  let engine: ContentScoringEngine;
  const defaultWeights = scraperSettings.scoreWeights;
  const minParagraphs = scraperSettings.minParagraphThreshold;

  beforeEach(() => {
    engine = new ContentScoringEngine(defaultWeights, minParagraphs, scraperSettings.descriptiveKeywords);
  });

  it('should return -Infinity if element_found_count is 0', () => {
    const details: ElementDetails = { xpath: '//div', element_found_count: 0, paragraphCount: 5 };
    expect(engine.scoreElement(details)).toBe(-Infinity);
  });

  it('should return -Infinity if paragraph count is below threshold', () => {
    const details: ElementDetails = { xpath: '//div', element_found_count: 1, paragraphCount: minParagraphs - 1 };
    expect(engine.scoreElement(details)).toBe(-Infinity);
  });

  it('should give a positive score for a good semantic element with enough paragraphs', () => {
    const details: ElementDetails = {
      xpath: '//article[@id="main"]',
      element_found_count: 1,
      tagName: 'article',
      id: 'main',
      className: 'content-body',
      textContentLength: 2000,
      paragraphCount: minParagraphs + 2,
      linkCount: 2,
      imageCount: 1,
      videoCount: 0,
      unwantedTagCount: 0,
      innerHTML: '<p>text</p>'.repeat(minParagraphs + 2) + ' some other html', // Simplified
    };
    const score = engine.scoreElement(details);
    expect(score).toBeGreaterThan(0);
  });

  it('should penalize non-unique XPaths', () => {
    const details1: ElementDetails = { element_found_count: 1, paragraphCount: minParagraphs, xpath: '//div[1]', textContentLength: 500, innerHTML: 'a'.repeat(1000) };
    const details2: ElementDetails = { element_found_count: 2, paragraphCount: minParagraphs, xpath: '//div[1]', textContentLength: 500, innerHTML: 'a'.repeat(1000) }; // Same content, but XPath matched 2
    const score1 = engine.scoreElement(details1);
    const score2 = engine.scoreElement(details2);
    expect(score1).toBeGreaterThan(score2);
    // The penalty is (element_found_count - 1) * weight.isSingleElement
    // So score2 should be score1 - weight.isSingleElement (since score1 has the bonus, score2 has penalty from base)
    // This test needs careful thought on how the base score is established before penalties/bonuses.
    // Assuming score1 gets the full isSingleElement bonus, and score2 gets a penalty.
    // If isSingleElement is a positive bonus for count=1, and a penalty for count > 1.
    // Let baseScore be score without considering element_found_count.
    // score1 = baseScore + weights.isSingleElement
    // score2 = baseScore - weights.isSingleElement * (2-1)
    // So score2 = score1 - 2 * weights.isSingleElement.
    // The current implementation: if count > 1, penalty = abs(weight) * (count-1). if count=1, bonus = weight.
    // So score1 = X + W.isSingleElement. score2 = X - abs(W.isSingleElement)*(2-1).
    // If W.isSingleElement is positive, score2 = score1 - W.isSingleElement - abs(W.isSingleElement).
    // If W.isSingleElement is 20, score2 = score1 - 20 - 20 = score1 - 40.
    // The test `expect(score2).toBe(score1 - defaultWeights.isSingleElement);` seems to imply a simpler relationship.
    // Let's re-verify the logic:
    // Score for unique: +defaultWeights.isSingleElement
    // Score for non-unique (count=2): - (Math.abs(defaultWeights.isSingleElement) * (2-1))
    // Difference: defaultWeights.isSingleElement - (-Math.abs(defaultWeights.isSingleElement)) = defaultWeights.isSingleElement + Math.abs(defaultWeights.isSingleElement)
    // If defaultWeights.isSingleElement is positive (e.g. 20), difference is 20 + 20 = 40.
    // The test `expect(score2).toBe(score1 - defaultWeights.isSingleElement);` would only be true if the penalty for non-unique was 0 and unique got a bonus, or if the bonus for unique was 0 and non-unique got a penalty.
    // Given the code: `score -= penalty * (element_found_count -1)` and `score += (this.weights.isSingleElement || 0);`
    // score1 (count=1): base + W.isSingleElement
    // score2 (count=2): base - abs(W.isSingleElement)*(2-1) = base - abs(W.isSingleElement)
    // So, score1 - score2 = W.isSingleElement + abs(W.isSingleElement).
    // If W.isSingleElement is 20, then score1 - score2 = 40. So score2 = score1 - 40.
    // The test `expect(score2).toBe(score1 - defaultWeights.isSingleElement);` is likely incorrect based on the implementation.
    // It should be `expect(score2).toBeCloseTo(score1 - (defaultWeights.isSingleElement + Math.abs(defaultWeights.isSingleElement)));` if isSingleElement is positive.
    // For now, I'll keep the original test structure but note this discrepancy.
    expect(score1 - score2).toBe(defaultWeights.isSingleElement + Math.abs(defaultWeights.isSingleElement));

  });

  it('should reward descriptive IDs or classes', () => {
    const detailsBase: ElementDetails = { xpath: '//div', element_found_count: 1, paragraphCount: minParagraphs, textContentLength: 500, innerHTML: 'a'.repeat(1000) };
    const detailsWithDescId: ElementDetails = { ...detailsBase, id: 'article-content', xpath: '//div[@id="article-content"]' };
    const detailsWithDescClass: ElementDetails = { ...detailsBase, className: 'main-story post-body', xpath: '//div[@class="main-story post-body"]' };

    const scoreBase = engine.scoreElement(detailsBase);
    const scoreId = engine.scoreElement(detailsWithDescId);
    const scoreClass = engine.scoreElement(detailsWithDescClass);

    expect(scoreId).toBeGreaterThan(scoreBase);
    expect(scoreClass).toBeGreaterThan(scoreBase);
    // The exact bonus depends on which keywords match and their specific weights.
    // This test might need adjustment based on the exact keywords in scraperSettings.descriptiveKeywords
    // and the weights for contentSpecificIdBonus/contentSpecificClassBonus.
    // For example, if 'article' and 'content' are keywords for ID:
    // expect(scoreId).toBeCloseTo(scoreBase + defaultWeights.contentSpecificIdBonus); // if "article-content" matches a specific rule
  });

  it('should penalize high link density', () => {
    const detailsLowLinks: ElementDetails = {
      xpath: '//div', element_found_count: 1, paragraphCount: minParagraphs,
      textContentLength: 1000, innerHTML: 'a'.repeat(2000),
      linkCount: 5, // Low link count
    };
    const detailsHighLinks: ElementDetails = {
      ...detailsLowLinks,
      linkCount: 150, // High link count for textContentLength 1000 (density 0.15)
    };
    const scoreLow = engine.scoreElement(detailsLowLinks);
    const scoreHigh = engine.scoreElement(detailsHighLinks);
    expect(scoreHigh).toBeLessThan(scoreLow);
  });

  // Add more tests for:
  // - Text density calculation
  // - Media presence bonus
  // - XPath complexity penalty (depth bonus/shallow penalty)
  // - Edge cases (empty strings, zero counts)
});
