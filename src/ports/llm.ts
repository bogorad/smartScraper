import type { LlmXPathSuggestion } from '../domain/models.js';

export interface LlmSuggestInput {
  simplifiedDom: string;
  snippets: string[];
  url: string;
  previousFailureReason?: string;
}

export interface LlmPort {
  suggestXPaths(input: LlmSuggestInput): Promise<LlmXPathSuggestion[]>;
}
