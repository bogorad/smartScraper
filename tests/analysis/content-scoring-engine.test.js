// tests/analysis/content-scoring-engine.test.js
import { ContentScoringEngine } from '../../src/analysis/content-scoring-engine';
import { scraperSettings } from '../../config/index.js'; // For default weights

describe('ContentScoringEngine', () => {
    let engine;
    const defaultWeights = scraperSettings.scoreWeights;
    const minParagraphs = scraperSettings.minParagraphThreshold;

    beforeEach(() => {
        engine = new ContentScoringEngine(defaultWeights, minParagraphs);
    });

    it('should return -Infinity if element_found_count is 0', () => {
        const details = { element_found_count: 0, xpath: '//none' };
        expect(engine.scoreElement(details)).toBe(-Infinity);
    });

    it('should return -Infinity if paragraph count is below threshold', () => {
        const details = {
            element_found_count: 1,
            xpath: '//article',
            paragraphCount: minParagraphs - 1,
        };
        expect(engine.scoreElement(details)).toBe(-Infinity);
    });

    it('should give a positive score for a good semantic element with enough paragraphs', () => {
        const details = {
            element_found_count: 1,
            xpath: '//article',
            tagName: 'article',
            paragraphCount: minParagraphs + 2,
            textContentLength: 1000,
            innerHTML: '<p>text</p>'.repeat(minParagraphs + 2) + ' some other html', // Simplified
            linkCount: 2,
            totalDescendantElements: 10,
        };
        const score = engine.scoreElement(details);
        expect(score).toBeGreaterThan(0);
        // Expected score calculation:
        // isSingleElement: 20
        // paragraphCount: (minParagraphs + 2) * 2
        // isSemanticTag: 15
        // textDensity: (1000 / details.innerHTML.length) * 30 (approx)
        // linkDensityPenalty: (2/10 - 0.1)*10 * -40 (if linkDensity > 0.1)
        // ... other factors
    });

    it('should penalize non-unique XPaths', () => {
        const details1 = { element_found_count: 1, paragraphCount: minParagraphs, xpath: '//div' };
        const details2 = { element_found_count: 2, paragraphCount: minParagraphs, xpath: '//div' }; // Same content, but XPath matched 2
        const score1 = engine.scoreElement(details1);
        const score2 = engine.scoreElement(details2);
        expect(score1).toBeGreaterThan(score2); // Score for unique should be higher
        expect(score2).toBe(score1 - defaultWeights.isSingleElement);
    });


    it('should reward descriptive IDs or classes', () => {
        const detailsBase = { element_found_count: 1, paragraphCount: minParagraphs, xpath: '//div', textContentLength: 500, innerHTML: 'a'.repeat(1000) };
        const detailsWithDescId = { ...detailsBase, id: 'main-content' };
        const detailsWithDescClass = { ...detailsBase, className: 'article-body news' };

        const scoreBase = engine.scoreElement(detailsBase);
        const scoreId = engine.scoreElement(detailsWithDescId);
        const scoreClass = engine.scoreElement(detailsWithDescClass);

        expect(scoreId).toBeGreaterThan(scoreBase);
        expect(scoreClass).toBeGreaterThan(scoreBase);
        expect(scoreId).toBe(scoreBase + defaultWeights.hasDescriptiveIdOrClass);
    });

    it('should penalize high link density', () => {
        const detailsLowLinks = {
            element_found_count: 1, paragraphCount: minParagraphs, xpath: '//div',
            textContentLength: 1000, innerHTML: 'a'.repeat(2000),
            linkCount: 2, totalDescendantElements: 50
        };
        const detailsHighLinks = {
            ...detailsLowLinks,
            linkCount: 20, // High link count for the same content
        };
        const scoreLow = engine.scoreElement(detailsLowLinks);
        const scoreHigh = engine.scoreElement(detailsHighLinks);
        expect(scoreHigh).toBeLessThan(scoreLow);
    });

    // Add more tests for:
    // - Text density calculation
    // - Media presence bonus
    // - XPath complexity penalty
    // - Edge cases (empty strings, zero counts)
});
