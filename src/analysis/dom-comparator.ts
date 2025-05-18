// src/analysis/dom-comparator.ts
import TurndownService from 'turndown';
import { diffChars, Change } from 'diff';
import { logger } from '../utils/logger.js';
import { ExtractionError } from '../utils/error-handler.js';

// Define a type for tags that Turndown accepts.
// This is a subset of HTMLElementTagNameMap for simplicity.
// For a more complete solution, you might need to find or create more comprehensive typings for Turndown.
type TurndownRemovableTag = 
  | 'script' | 'style' | 'noscript' | 'iframe' | 'link' | 'meta' | 'head' 
  | 'img' | 'video' | 'audio' | 'source' | 'track' | 'canvas' 
  | 'object' | 'embed' // 'svg' and 'param' are not in HTMLElementTagNameMap by default
  // For 'svg' and 'param', if Turndown handles them, you might need to cast or use a broader type.
  // For now, we'll use a cast to any for the problematic ones.
  ;


class DomComparator {
  private similarityThreshold: number;
  private turndownService: TurndownService;

  constructor(similarityThreshold: number) {
    this.similarityThreshold = similarityThreshold;
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '*',
      codeBlockStyle: 'fenced',
      emDelimiter: '_',
      strongDelimiter: '**',
      linkStyle: 'inlined',
      linkReferenceStyle: 'full',
    });
    // Cast to 'any' for tags not strictly in HTMLElementTagNameMap if Turndown supports them.
    this.turndownService.remove([
        'script', 'style', 'noscript', 'iframe', 'link', 'meta', 'head', 
        'img', 'video', 'audio', 'source', 'track', 'canvas', 
        'object', 'embed', 'param' as any, 'svg' as any 
    ] as TurndownRemovableTag[]);
    logger.info(`DomComparator initialized with similarity threshold: ${this.similarityThreshold}`);
  }

  private _htmlToMarkdown(htmlString: string | null | undefined): string {
    if (typeof htmlString !== 'string' || !htmlString.trim()) {
      logger.warn('[DomComparator _htmlToMarkdown] htmlString is not a string or is empty.');
      return '';
    }
    try {
      const markdown = this.turndownService.turndown(htmlString);
      logger.debug(`[DomComparator _htmlToMarkdown] Converted HTML (len: ${htmlString.length}) to Markdown (len: ${markdown.length}). Snippet: ${markdown.substring(0,100)}...`);
      return markdown;
    } catch (error: any) {
      logger.warn(`[DomComparator _htmlToMarkdown] Error converting HTML to Markdown: ${error.message}`);
      if (logger.isDebugging()) {
        logger.warn('[DEBUG_MODE] Full error during HTML to Markdown conversion:', error);
        logger.debug(`[DEBUG_MODE] HTML snippet causing error (first 500 chars): ${htmlString.substring(0,500)}`);
      }
      throw new ExtractionError('Error converting HTML to Markdown', {
        originalErrorName: error.name,
        originalErrorMessage: error.message,
        htmlSnippet: htmlString.substring(0, 200)
      });
    }
  }

  private _calculateSimilarity(str1: string, str2: string): number {
    if (typeof str1 !== 'string' || typeof str2 !== 'string') {
      logger.warn('[DomComparator _calculateSimilarity] One or both input strings are invalid.');
      return 0;
    }
    if (str1.length === 0 && str2.length === 0) return 1;
    if (str1.length === 0 || str2.length === 0) return 0;

    const changes: Change[] = diffChars(str1, str2);
    let commonChars = 0;
    changes.forEach(part => {
      if (!part.added && !part.removed) {
        commonChars += part.count || 0;
      }
    });

    const totalCharsInLongerString = Math.max(str1.length, str2.length);
    if (totalCharsInLongerString === 0) return 1;

    const similarity = commonChars / totalCharsInLongerString;
    const finalSimilarity = Math.max(0, Math.min(1, similarity));

    logger.debug(`[DomComparator _calculateSimilarity] Str1 len: ${str1.length}, Str2 len: ${str2.length}, Common: ${commonChars}, Similarity: ${finalSimilarity.toFixed(4)}`);
    return finalSimilarity;
  }

  async compareDoms(htmlString1: string | null | undefined, htmlString2: string | null | undefined): Promise<boolean> {
    logger.debug(`[DomComparator compareDoms] Comparing DOMs. HTML1 len: ${htmlString1?.length}, HTML2 len: ${htmlString2?.length}`);
    try {
      const markdown1 = this._htmlToMarkdown(htmlString1);
      const markdown2 = this._htmlToMarkdown(htmlString2);

      const cleanMd1 = markdown1.replace(/\s+/g, ' ').trim();
      const cleanMd2 = markdown2.replace(/\s+/g, ' ').trim();

      logger.debug(`[DomComparator compareDoms] Cleaned Markdown1 len: ${cleanMd1.length}, Cleaned Markdown2 len: ${cleanMd2.length}`);

      const similarityScore = this._calculateSimilarity(cleanMd1, cleanMd2);
      logger.info(`[DomComparator compareDoms] DOM similarity score: ${similarityScore.toFixed(4)}`);
      return similarityScore >= this.similarityThreshold;
    } catch (error: any) {
        logger.error(`[CRITICAL_INTERNAL] Unexpected error in DomComparator.compareDoms: ${error.message}`);
        if (logger.isDebugging()) {
            logger.error('[DEBUG_MODE] Full unexpected error in DomComparator.compareDoms:', error);
        }
        if (error instanceof ExtractionError) throw error;
        throw new Error(`Internal error during DOM comparison: ${error.message}`);
    }
  }
}

export { DomComparator };
