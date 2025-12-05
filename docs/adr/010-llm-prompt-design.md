# ADR-010: LLM Prompt Design for XPath Discovery

- Status: Accepted
- Date: 2025-12-05

## Context

The LLM must analyze a simplified DOM and suggest XPath selectors that target the main article content. The prompt must be precise enough to get useful results while being token-efficient.

## Prompt Structure

### System Message

```
Assume the role of an expert web scraper. Your task is to analyze HTML structure and identify the XPath selector for the main article content.

Rules:
1. Return ONLY a JSON array of XPath strings
2. Suggest 3-5 candidate XPaths, ordered by confidence
3. Target the element containing the article text, not navigation or sidebars
4. Prefer semantic elements: <article>, <main>, elements with class/id containing "article", "content", "post", "entry"
5. Avoid: <header>, <footer>, <nav>, <aside>, elements with class containing "sidebar", "menu", "nav", "comment", "ad"
6. XPaths must be valid and reasonably specific (not just "//div")

Output format:
["//article[@class='post-content']", "//div[@id='article-body']", "//main//div[@class='entry']"]
```

### User Message Template

```
Analyze this HTML and suggest XPath selectors for the main article content.

Page URL: {{url}}

Sample text from the article:
{{snippets}}

Simplified HTML structure:
{{simplifiedDom}}
```

### Variables

| Variable        | Source                                   | Max Length      |
| --------------- | ---------------------------------------- | --------------- |
| `url`           | Original target URL                      | -               |
| `snippets`      | First 3 text snippets from content areas | 500 chars total |
| `simplifiedDom` | Cleaned HTML with structure preserved    | 8000 chars      |

---

## DOM Simplification Rules

### Remove Entirely

- `<script>`, `<style>`, `<noscript>`, `<svg>`, `<iframe>`
- HTML comments
- Hidden elements (`display:none`, `hidden` attribute)
- Elements with classes: `ad`, `advertisement`, `social-share`, `related-posts`

### Collapse/Truncate

- Text nodes: keep first 50 chars + "..."
- Repeated siblings: keep first 2, replace rest with `<!-- +N more -->`
- Deep nesting (>10 levels): truncate with `...`

### Preserve

- Tag names and hierarchy
- `id` and `class` attributes
- `role`, `aria-label` attributes (semantic hints)
- Basic structure of `<article>`, `<main>`, `<section>`, `<div>`

### Example Transformation

**Before (excerpt):**

```html
<div class="article-wrapper">
  <article class="post-content" id="main-article">
    <h1>Breaking News: Mayor Announces Policy</h1>
    <p class="byline">By John Smith | December 5, 2025</p>
    <div class="article-body">
      <p>
        The mayor announced today that the city will
        implement a new policy affecting all residents. The
        decision comes after months of deliberation and
        public input sessions held throughout...
      </p>
      <p>
        Critics argue that the move will have unintended
        consequences...
      </p>
      <!-- 15 more paragraphs -->
    </div>
  </article>
  <aside class="sidebar">
    <div class="related-posts">...</div>
  </aside>
</div>
```

**After simplification:**

```html
<div class="article-wrapper">
  <article class="post-content" id="main-article">
    <h1>Breaking News: Mayor Announces Policy</h1>
    <p class="byline">By John Smith | December 5, 2025</p>
    <div class="article-body">
      <p>
        The mayor announced today that the city will impl...
      </p>
      <p>
        Critics argue that the move will have unintended...
      </p>
      <!-- +15 more -->
    </div>
  </article>
  <aside class="sidebar"><!-- removed --></aside>
</div>
```

---

## Snippet Extraction

### Purpose

Snippets give the LLM context about what the actual article content looks like, helping it distinguish content from boilerplate.

### Extraction Rules

1. Find candidate text containers (paragraphs with >100 chars)
2. Skip if parent has class containing: nav, menu, sidebar, footer, comment
3. Take first 3 unique snippets
4. Truncate each to ~150 chars at word boundary
5. Join with newlines

### Example Snippets

```
"The mayor announced today that the city will implement a new policy affecting all residents. The decision comes after months of deliberation..."

"Critics argue that the move will have unintended consequences for small businesses in the downtown area, particularly those already struggling..."

"City council members expressed mixed reactions. Councilwoman Jane Doe stated that while she supports the intent, the implementation timeline..."
```

---

## Complete Request Example

```json
{
  "model": "meta-llama/llama-4-maverick:free",
  "temperature": 0,
  "messages": [
    {
      "role": "system",
      "content": "You are an expert web scraper. Your task is to analyze HTML structure and identify the XPath selector for the main article content.\n\nRules:\n1. Return ONLY a JSON array of XPath strings\n2. Suggest 3-5 candidate XPaths, ordered by confidence\n3. Target the element containing the article text, not navigation or sidebars\n4. Prefer semantic elements: <article>, <main>, elements with class/id containing \"article\", \"content\", \"post\", \"entry\"\n5. Avoid: <header>, <footer>, <nav>, <aside>, elements with class containing \"sidebar\", \"menu\", \"nav\", \"comment\", \"ad\"\n6. XPaths must be valid and reasonably specific (not just \"//div\")\n\nOutput format:\n[\"//article[@class='post-content']\", \"//div[@id='article-body']\", \"//main//div[@class='entry']\"]"
    },
    {
      "role": "user",
      "content": "Analyze this HTML and suggest XPath selectors for the main article content.\n\nPage URL: https://nypost.com/2025/12/05/mayor-announces-policy/\n\nSample text from the article:\n\"The mayor announced today that the city will implement a new policy affecting all residents. The decision comes after months of deliberation...\"\n\n\"Critics argue that the move will have unintended consequences for small businesses in the downtown area...\"\n\nSimplified HTML structure:\n<div class=\"article-wrapper\">\n  <article class=\"post-content\" id=\"main-article\">\n    <h1>Breaking News: Mayor Announces Policy</h1>\n    <p class=\"byline\">By John Smith | December 5, 2025</p>\n    <div class=\"article-body\">\n      <p>The mayor announced today that the city will impl...</p>\n      <p>Critics argue that the move will have unintended...</p>\n      <!-- +15 more -->\n    </div>\n  </article>\n  <aside class=\"sidebar\"><!-- removed --></aside>\n</div>"
    }
  ]
}
```

---

## Expected Response Formats

### Ideal Response

```json
[
  "//article[@class='post-content']",
  "//div[@class='article-body']",
  "//article[@id='main-article']"
]
```

### Response with Markdown Block

````markdown
Based on the HTML structure, here are the XPath selectors:

```json
[
  "//article[@class='post-content']",
  "//div[@class='article-body']"
]
```
````

```

### Response with Explanations (must be parsed)
```

The main content appears to be in:

1. //article[@class='post-content'] - the semantic article element
2. //div[@class='article-body'] - the inner content div

["//article[@class='post-content']", "//div[@class='article-body']"]

````

---

## Response Parsing

### Parser Implementation

```typescript
function parseXPathResponse(content: string): string[] {
  // Try direct JSON parse
  try {
    const parsed = JSON.parse(content.trim());
    if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) {
      return parsed;
    }
  } catch {}

  // Try extracting from markdown code block
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  // Fallback: regex extraction of XPath patterns
  const xpathPattern = /\/\/[a-zA-Z][a-zA-Z0-9]*(?:\[[^\]]+\])?(?:\/[a-zA-Z][a-zA-Z0-9]*(?:\[[^\]]+\])?)*/g;
  const matches = content.match(xpathPattern);
  return matches ? [...new Set(matches)] : [];
}
````

### Test Cases

| Input                                      | Expected Output             |
| ------------------------------------------ | --------------------------- |
| `["//article"]`                            | `["//article"]`             |
| ` ```json\n["//div"]\n``` `                | `["//div"]`                 |
| `Here is the xpath: //article[@class='x']` | `["//article[@class='x']"]` |
| `invalid response`                         | `[]`                        |
| `["//a", "//a", "//b"]`                    | `["//a", "//b"]` (deduped)  |

---

## Error Handling

### LLM Unavailable

- Return empty array
- Log error with context
- Engine falls back to heuristic-based extraction

### Invalid Response

- Log raw response for debugging
- Attempt regex fallback
- If still empty, return `EXTRACTION` error

### Rate Limiting

- Respect `Retry-After` header
- Exponential backoff: 1s, 2s, 4s, max 3 retries
- Return `LLM` error type after exhausting retries

---

## Token Budget

| Component                   | Estimated Tokens |
| --------------------------- | ---------------- |
| System message              | ~250             |
| URL                         | ~20              |
| Snippets (500 chars)        | ~150             |
| Simplified DOM (8000 chars) | ~2500            |
| **Total Input**             | **~2900**        |
| Expected Output             | ~100             |

Target: Stay under 4000 tokens per request for cost efficiency.

---

## Consequences

### Benefits
- Structured prompt yields consistent, parseable responses
- DOM simplification keeps token usage predictable (~2900 tokens)
- Multiple parsing strategies handle varied LLM output formats
- Snippets provide semantic context without full content

### Trade-offs
- DOM simplification may remove useful structural hints
- Token budget limits context for complex pages
- Regex fallback may extract false positives

### Implementation Requirements
- DOM simplifier must handle malformed HTML gracefully
- Response parser must try all strategies before failing
- Rate limiting must respect `Retry-After` headers
