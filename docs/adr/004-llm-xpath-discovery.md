# ADR-004: LLM-Assisted XPath Discovery

- Status: Accepted
- Date: 2025-12-05

## Context

Fixed extraction rules don't generalize across diverse website structures. We need automated, adaptive content discovery that can handle arbitrary page layouts.

## Decision

### Discovery Pipeline

1. **DOM Simplification** - Strip scripts, styles, compress whitespace
2. **Snippet Extraction** - Extract representative text snippets for context
3. **LLM Query** - Send simplified DOM + snippets to LLM for XPath suggestions
4. **Scoring** - Rank candidates using ContentScoringEngine
5. **Validation** - Verify extraction meets minimum thresholds
6. **Persistence** - Store successful XPath in KnownSitesPort

### LLM Integration

**Provider:** OpenRouter (OpenAI-compatible chat completions)

**Environment Variables:**
- `OPENROUTER_API_KEY` (required)
- `LLM_MODEL` (default: `meta-llama/llama-4-maverick:free`)
- `LLM_TEMPERATURE` (default: `0`)

**Request:**
```typescript
POST https://openrouter.ai/api/v1/chat/completions
Headers:
  Authorization: Bearer ${OPENROUTER_API_KEY}
  Content-Type: application/json
  HTTP-Referer: ${LLM_HTTP_REFERER || 'https://github.com/bogorad/smartScraper'}
  X-Title: ${LLM_X_TITLE || 'SmartScraper'}

Body:
  model: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  temperature: number
```

**Response Parsing:**
- Extract `choices[0].message.content`
- Parse JSON array of XPaths (may be in markdown code block)
- Fallback to regex-based XPath extraction

### LlmXPathSuggestion

```typescript
interface LlmXPathSuggestion {
  xpath: string;
  explanation?: string;
}
```

### Scoring Thresholds

- `MIN_SCORE_THRESHOLD`: 0.7
- `MIN_CONTENT_CHARS`: Minimum extracted content length

### ElementDetails for Scoring

```typescript
interface ElementDetails {
  xpath: string;
  textLength: number;
  linkDensity: number;
  paragraphCount: number;
  headingCount: number;
  hasMedia: boolean;
  domDepth: number;
  semanticScore: number;
  unwantedTagScore: number;
}
```

## Consequences

- Adaptable extraction that improves over time
- Dependency on LLM availability and response quality
- Requires defensive parsing and safe fallbacks
- Scoring model must be well-tested
