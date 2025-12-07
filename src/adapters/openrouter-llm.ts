import axios from 'axios';
import type { LlmPort, LlmSuggestInput } from '../ports/llm.js';
import type { LlmXPathSuggestion } from '../domain/models.js';
import { parseXPathResponse } from '../utils/xpath-parser.js';
import { DEFAULTS } from '../constants.js';
import { getOpenrouterApiKey, getLlmModel, getLlmTemperature, getLlmHttpReferer, getLlmXTitle } from '../config.js';

const SYSTEM_PROMPT = `You are an expert web scraper. Your task is to analyze HTML structure and identify the XPath selector for the main article content.

Rules:
1. Return ONLY a JSON array of XPath strings
2. Suggest 3-5 candidate XPaths, ordered by confidence
3. Target the element containing the article text, not navigation or sidebars
4. Prefer semantic elements: <article>, <main>, elements with class/id containing "article", "content", "post", "entry"
5. Avoid: <header>, <footer>, <nav>, <aside>, elements with class containing "sidebar", "menu", "nav", "comment", "ad"
6. XPaths must be valid and reasonably specific (not just "//div")

Output format:
["//article[@class='post-content']", "//div[@id='article-body']", "//main//div[@class='entry']"]`;

export class OpenRouterLlmAdapter implements LlmPort {
  private apiKey: string;
  private model: string;
  private temperature: number;

  constructor() {
    this.apiKey = getOpenrouterApiKey();
    this.model = getLlmModel();
    this.temperature = getLlmTemperature();
  }

  async suggestXPaths(input: LlmSuggestInput): Promise<LlmXPathSuggestion[]> {
    if (!this.apiKey) {
      console.warn('[LLM] OPENROUTER_API_KEY not set');
      return [];
    }

    const userContent = this.buildUserPrompt(input);

    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: this.model,
          temperature: this.temperature,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent }
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': getLlmHttpReferer(),
            'X-Title': getLlmXTitle()
          },
          timeout: 30000
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) return [];

      const xpaths = parseXPathResponse(content);
      return xpaths.map(xpath => ({ xpath }));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const retryAfter = error.response?.headers?.['retry-after'];
        if (retryAfter) {
          console.warn(`[LLM] Rate limited, retry after ${retryAfter}s`);
        }
        console.error('[LLM] API error:', error.response?.status, error.response?.data);
      } else {
        console.error('[LLM] Error:', error);
      }
      return [];
    }
  }

  private buildUserPrompt(input: LlmSuggestInput): string {
    const snippetsText = input.snippets.length > 0
      ? `Sample text from the article:\n${input.snippets.map(s => `"${s}"`).join('\n\n')}`
      : '';

    let prompt = `Analyze this HTML and suggest XPath selectors for the main article content.

Page URL: ${input.url}`;

    if (snippetsText) {
      prompt += `\n\n${snippetsText}`;
    }

    prompt += `\n\nSimplified HTML structure:\n${input.simplifiedDom}`;

    if (input.previousFailureReason) {
      prompt += `\n\nNote: Previous attempt failed because: ${input.previousFailureReason}`;
    }

    return prompt;
  }
}
