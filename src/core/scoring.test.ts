import { describe, it, expect } from 'vitest';
import { scoreElement, rankXPathCandidates } from './scoring.js';
import type { ElementDetails } from '../domain/models.js';

describe('scoring', () => {
  describe('scoreElement', () => {
    it('should score high-quality content element highly', () => {
      const details: ElementDetails = {
        xpath: '//article',
        textLength: 1000,
        linkDensity: 0.1,
        paragraphCount: 5,
        headingCount: 2,
        hasMedia: true,
        domDepth: 5,
        semanticScore: 1,
        unwantedTagScore: 0
      };
      const score = scoreElement(details);
      expect(score).toBeGreaterThan(0.8);
    });

    it('should score low-quality element poorly', () => {
      const details: ElementDetails = {
        xpath: '//nav',
        textLength: 50,
        linkDensity: 0.8,
        paragraphCount: 0,
        headingCount: 0,
        hasMedia: false,
        domDepth: 2,
        semanticScore: 0,
        unwantedTagScore: 1
      };
      const score = scoreElement(details);
      expect(score).toBeLessThan(0.3);
    });

    it('should add score for sufficient text length', () => {
      const baseDetails: ElementDetails = {
        xpath: '//div',
        textLength: 100,
        linkDensity: 0.5,
        paragraphCount: 0,
        headingCount: 0,
        hasMedia: false,
        domDepth: 5,
        semanticScore: 0,
        unwantedTagScore: 0
      };
      
      const longTextDetails = { ...baseDetails, textLength: 500 };
      
      const scoreShort = scoreElement(baseDetails);
      const scoreLong = scoreElement(longTextDetails);
      
      expect(scoreLong).toBeGreaterThan(scoreShort);
    });

    it('should add score for low link density', () => {
      const highDensity: ElementDetails = {
        xpath: '//div',
        textLength: 500,
        linkDensity: 0.8,
        paragraphCount: 3,
        headingCount: 1,
        hasMedia: false,
        domDepth: 5,
        semanticScore: 0,
        unwantedTagScore: 0
      };
      
      const lowDensity = { ...highDensity, linkDensity: 0.1 };
      
      const scoreHigh = scoreElement(highDensity);
      const scoreLow = scoreElement(lowDensity);
      
      expect(scoreLow).toBeGreaterThan(scoreHigh);
    });

    it('should add score for multiple paragraphs', () => {
      const fewParagraphs: ElementDetails = {
        xpath: '//div',
        textLength: 500,
        linkDensity: 0.2,
        paragraphCount: 1,
        headingCount: 1,
        hasMedia: false,
        domDepth: 5,
        semanticScore: 0,
        unwantedTagScore: 0
      };
      
      const manyParagraphs = { ...fewParagraphs, paragraphCount: 5 };
      
      const scoreFew = scoreElement(fewParagraphs);
      const scoreMany = scoreElement(manyParagraphs);
      
      expect(scoreMany).toBeGreaterThan(scoreFew);
    });

    it('should add score for headings', () => {
      const noHeadings: ElementDetails = {
        xpath: '//div',
        textLength: 500,
        linkDensity: 0.2,
        paragraphCount: 3,
        headingCount: 0,
        hasMedia: false,
        domDepth: 5,
        semanticScore: 0,
        unwantedTagScore: 0
      };
      
      const withHeadings = { ...noHeadings, headingCount: 2 };
      
      const scoreNoHeadings = scoreElement(noHeadings);
      const scoreWithHeadings = scoreElement(withHeadings);
      
      expect(scoreWithHeadings).toBeGreaterThan(scoreNoHeadings);
    });

    it('should add score for semantic elements', () => {
      const noSemantic: ElementDetails = {
        xpath: '//div',
        textLength: 500,
        linkDensity: 0.2,
        paragraphCount: 3,
        headingCount: 1,
        hasMedia: false,
        domDepth: 5,
        semanticScore: 0,
        unwantedTagScore: 0
      };
      
      const withSemantic = { ...noSemantic, semanticScore: 1 };
      
      const scoreNoSemantic = scoreElement(noSemantic);
      const scoreWithSemantic = scoreElement(withSemantic);
      
      expect(scoreWithSemantic).toBeGreaterThan(scoreNoSemantic);
    });

    it('should penalize unwanted tags', () => {
      const clean: ElementDetails = {
        xpath: '//article',
        textLength: 500,
        linkDensity: 0.2,
        paragraphCount: 3,
        headingCount: 1,
        hasMedia: false,
        domDepth: 5,
        semanticScore: 1,
        unwantedTagScore: 0
      };
      
      const unwanted = { ...clean, unwantedTagScore: 1 };
      
      const scoreClean = scoreElement(clean);
      const scoreUnwanted = scoreElement(unwanted);
      
      expect(scoreUnwanted).toBeLessThan(scoreClean);
    });

    it('should add score for optimal DOM depth', () => {
      const shallow: ElementDetails = {
        xpath: '//div',
        textLength: 500,
        linkDensity: 0.2,
        paragraphCount: 3,
        headingCount: 1,
        hasMedia: false,
        domDepth: 2,
        semanticScore: 0,
        unwantedTagScore: 0
      };
      
      const optimal = { ...shallow, domDepth: 5 };
      const deep = { ...shallow, domDepth: 15 };
      
      const scoreShallow = scoreElement(shallow);
      const scoreOptimal = scoreElement(optimal);
      const scoreDeep = scoreElement(deep);
      
      expect(scoreOptimal).toBeGreaterThan(scoreShallow);
      expect(scoreOptimal).toBeGreaterThan(scoreDeep);
    });

    it('should clamp score between 0 and 1', () => {
      const perfect: ElementDetails = {
        xpath: '//article',
        textLength: 5000,
        linkDensity: 0.05,
        paragraphCount: 10,
        headingCount: 5,
        hasMedia: true,
        domDepth: 5,
        semanticScore: 2,
        unwantedTagScore: 0
      };
      
      const terrible: ElementDetails = {
        xpath: '//nav',
        textLength: 10,
        linkDensity: 0.95,
        paragraphCount: 0,
        headingCount: 0,
        hasMedia: false,
        domDepth: 1,
        semanticScore: 0,
        unwantedTagScore: 5
      };
      
      const scorePerfect = scoreElement(perfect);
      const scoreTerrible = scoreElement(terrible);
      
      expect(scorePerfect).toBeLessThanOrEqual(1);
      expect(scoreTerrible).toBeGreaterThanOrEqual(0);
    });
  });

  describe('rankXPathCandidates', () => {
    it('should rank candidates by score in descending order', () => {
      const candidates = [
        {
          xpath: '//div[@id="low"]',
          details: {
            xpath: '//div[@id="low"]',
            textLength: 100,
            linkDensity: 0.8,
            paragraphCount: 0,
            headingCount: 0,
            hasMedia: false,
            domDepth: 2,
            semanticScore: 0,
            unwantedTagScore: 0
          } as ElementDetails
        },
        {
          xpath: '//article',
          details: {
            xpath: '//article',
            textLength: 1000,
            linkDensity: 0.1,
            paragraphCount: 5,
            headingCount: 2,
            hasMedia: true,
            domDepth: 5,
            semanticScore: 1,
            unwantedTagScore: 0
          } as ElementDetails
        },
        {
          xpath: '//div[@id="medium"]',
          details: {
            xpath: '//div[@id="medium"]',
            textLength: 500,
            linkDensity: 0.3,
            paragraphCount: 3,
            headingCount: 1,
            hasMedia: false,
            domDepth: 4,
            semanticScore: 0,
            unwantedTagScore: 0
          } as ElementDetails
        }
      ];

      const ranked = rankXPathCandidates(candidates);

      expect(ranked.length).toBe(3);
      expect(ranked[0].xpath).toBe('//article');
      expect(ranked[2].xpath).toBe('//div[@id="low"]');
      expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
      expect(ranked[1].score).toBeGreaterThan(ranked[2].score);
    });

    it('should handle null details by assigning zero score', () => {
      const candidates = [
        {
          xpath: '//div[@id="valid"]',
          details: {
            xpath: '//div[@id="valid"]',
            textLength: 500,
            linkDensity: 0.2,
            paragraphCount: 3,
            headingCount: 1,
            hasMedia: false,
            domDepth: 5,
            semanticScore: 0,
            unwantedTagScore: 0
          } as ElementDetails
        },
        {
          xpath: '//div[@id="null"]',
          details: null
        }
      ];

      const ranked = rankXPathCandidates(candidates);

      expect(ranked.length).toBe(2);
      expect(ranked[0].xpath).toBe('//div[@id="valid"]');
      expect(ranked[1].xpath).toBe('//div[@id="null"]');
      expect(ranked[1].score).toBe(0);
    });

    it('should return empty array for empty input', () => {
      const ranked = rankXPathCandidates([]);
      expect(ranked).toEqual([]);
    });

    it('should handle single candidate', () => {
      const candidates = [
        {
          xpath: '//article',
          details: {
            xpath: '//article',
            textLength: 500,
            linkDensity: 0.2,
            paragraphCount: 3,
            headingCount: 1,
            hasMedia: false,
            domDepth: 5,
            semanticScore: 0,
            unwantedTagScore: 0
          } as ElementDetails
        }
      ];

      const ranked = rankXPathCandidates(candidates);

      expect(ranked.length).toBe(1);
      expect(ranked[0].xpath).toBe('//article');
      expect(ranked[0].score).toBeGreaterThan(0);
    });
  });
});
