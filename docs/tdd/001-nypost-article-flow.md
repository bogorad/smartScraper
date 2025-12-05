# TDD-001: NYPost.com Article Flow

- Date: 2025-12-05

## Context

This document traces a complete request flow for scraping a NYPost.com article, demonstrating how the architecture handles both first-visit (discovery) and subsequent (known-config) scenarios.

## Scenario

```typescript
await scrapeUrl('https://nypost.com/2025/12/05/some-article-slug/', {
  outputType: OUTPUT_TYPES.CONTENT_ONLY
});
```

---

## Flow Trace: First Visit (Discovery Path)

### Step 1: API Entry Point

```
scrapeUrl() called
├── targetUrl: "https://nypost.com/2025/12/05/some-article-slug/"
└── options: { outputType: "content_only" }
```

**Test:** `scrapeUrl accepts valid URL and options`

### Step 2: URL Validation

```
CoreScraperEngine.scrape()
├── Validate URL format ✓
├── Parse and normalize domain → "nypost.com"
└── Create ScrapeContext
```

**Tests:**
- `rejects invalid URLs with CONFIGURATION error`
- `normalizes domain correctly (strips www, path, etc.)`

### Step 3: Config Lookup

```
KnownSitesPort.getConfig("nypost.com")
└── Returns: undefined (first visit)
```

**Test:** `returns undefined for unknown domain`

### Step 4: Browser Session Setup

```
BrowserPort.open()
├── Create temp profile: /tmp/puppeteer-profile-uuid-xxx
├── Load plugins from ./plugins/
│   ├── ad-blocker.js
│   └── paywall-bypass.js
├── Launch Puppeteer with args:
│   ├── --user-data-dir=/tmp/puppeteer-profile-uuid-xxx
│   ├── --no-sandbox
│   └── --proxy-server=... (if configured)
└── Modify UA: Linux → Windows NT 10.0
```

**Tests:**
- `creates unique profile directory per session`
- `loads all plugins from configured directory`
- `modifies UA to Windows while preserving browser version`

### Step 5: Page Load

```
BrowserPort.loadPage("https://nypost.com/2025/12/05/some-article-slug/")
├── Navigate to URL
├── Wait for network idle
├── Return pageId: "page-001"
└── Plugins activate:
    ├── Ad blocker removes tracking scripts
    └── Paywall bypass removes overlay (if present)
```

**Tests:**
- `navigates to URL successfully`
- `returns NETWORK error on navigation failure`
- `plugins intercept and modify page content`

### Step 6: CAPTCHA Detection

```
BrowserPort.detectCaptcha("page-001")
├── Scan for DataDome iframes (captcha-delivery.com)
├── Scan for generic CAPTCHA elements
└── Returns: "none"
```

**Tests:**
- `detects DataDome by iframe src pattern`
- `detects generic CAPTCHAs (reCAPTCHA, hCaptcha)`
- `returns "none" when no CAPTCHA present`

### Step 7: DOM Preparation for LLM

```
Build simplified DOM
├── Strip <script>, <style>, <noscript>
├── Remove hidden elements
├── Compress whitespace
└── Extract article snippets (first 500 chars of likely content areas)

Snippets example:
[
  "Breaking news: Mayor announces new policy...",
  "The decision comes after months of...",
  "Critics argue that the move will..."
]
```

**Tests:**
- `strips non-content elements from DOM`
- `extracts meaningful text snippets`
- `handles malformed HTML gracefully`

### Step 8: LLM XPath Discovery

```
LlmPort.suggestXPaths({
  simplifiedDom: "<html>...",
  snippets: ["Breaking news...", ...]
})

POST https://openrouter.ai/api/v1/chat/completions
├── model: "meta-llama/llama-4-maverick:free"
├── temperature: 0
└── messages: [system prompt, user prompt with DOM]

Response: [
  { xpath: "//article[@class='article-content']", explanation: "Main article container" },
  { xpath: "//div[@class='entry-content']", explanation: "Content wrapper" },
  { xpath: "//div[@id='article-body']", explanation: "Article body div" }
]
```

**Tests:**
- `sends correct request format to OpenRouter`
- `parses XPath array from response`
- `handles markdown code blocks in response`
- `returns empty array on LLM error (graceful degradation)`

### Step 9: Candidate Scoring

```
For each candidate XPath:

Candidate 1: //article[@class='article-content']
├── BrowserPort.evaluateXPath("page-001", xpath)
│   └── Returns ElementDetails:
│       ├── textLength: 4250
│       ├── linkDensity: 0.08
│       ├── paragraphCount: 12
│       ├── headingCount: 3
│       ├── hasMedia: true
│       ├── domDepth: 5
│       ├── semanticScore: 0.85
│       └── unwantedTagScore: 0.02
└── ContentScoringEngine.score(details)
    └── Score: 0.87 ✓

Candidate 2: //div[@class='entry-content']
└── Score: 0.72 ✓

Candidate 3: //div[@id='article-body']
└── Score: 0.45 ✗ (below threshold)

Winner: //article[@class='article-content'] (0.87)
```

**Tests:**
- `evaluates XPath and returns ElementDetails`
- `scores high for article-like content (low link density, many paragraphs)`
- `scores low for nav/boilerplate (high link density, few paragraphs)`
- `selects highest scoring candidate above threshold`

### Step 10: Content Extraction

```
BrowserPort.loadPage({
  url: "https://nypost.com/2025/12/05/some-article-slug/",
  xpath: "//article[@class='article-content']"
})

Returns: "<article class='article-content'>Breaking news: Mayor announces..."
Content length: 4250 chars ✓ (>= MIN_CONTENT_CHARS)
```

**Test:** `extracts content using winning XPath`

### Step 11: Persist Config

```
KnownSitesPort.saveConfig({
  domainPattern: "nypost.com",
  xpathMainContent: "//article[@class='article-content']",
  lastSuccessfulScrapeTimestamp: "2025-12-05T10:30:00Z",
  failureCountSinceLastSuccess: 0,
  discoveredByLlm: true
})
```

**Tests:**
- `saves config with correct domain pattern`
- `stores discovered XPath`
- `resets failure count on success`

### Step 12: Cleanup & Return

```
BrowserPort.close()
├── browser.close()
└── fs.rm("/tmp/puppeteer-profile-uuid-xxx", { recursive: true })

Return ScrapeResult:
{
  success: true,
  method: "puppeteer_stealth",
  xpath: "//article[@class='article-content']",
  data: "Breaking news: Mayor announces new policy..."
}
```

**Tests:**
- `cleans up profile directory on success`
- `cleans up profile directory on error (finally block)`
- `returns correct ScrapeResult shape`

---

## Flow Trace: Subsequent Visit (Known-Config Path)

### Steps 1-2: Same as above

### Step 3: Config Found

```
KnownSitesPort.getConfig("nypost.com")
└── Returns: {
      domainPattern: "nypost.com",
      xpathMainContent: "//article[@class='article-content']",
      failureCountSinceLastSuccess: 0
    }
```

**Test:** `returns stored config for known domain`

### Steps 4-6: Same (browser setup, page load, CAPTCHA check)

### Step 7: Direct Extraction (Skip LLM)

```
BrowserPort.loadPage({
  url: "https://nypost.com/2025/12/05/another-article/",
  xpath: "//article[@class='article-content']"  // From stored config
})

Content length: 3800 chars ✓
```

**Tests:**
- `uses stored XPath without calling LLM`
- `skips discovery when valid config exists`

### Step 8: Mark Success

```
KnownSitesPort.markSuccess("nypost.com")
├── Update lastSuccessfulScrapeTimestamp
└── Reset failureCountSinceLastSuccess = 0
```

### Step 9: Return

```
{
  success: true,
  method: "puppeteer_stealth",
  xpath: "//article[@class='article-content']",
  data: "Another article content..."
}
```

---

## Flow Trace: Config Failure → Rediscovery

### Scenario: Site Redesign

NYPost changes their HTML structure. Stored XPath no longer matches.

### Step 7: Extraction Fails

```
BrowserPort.loadPage({
  url: "https://nypost.com/2025/12/05/redesigned-article/",
  xpath: "//article[@class='article-content']"  // No longer exists
})

Content length: 0 chars ✗
```

### Step 8: Increment Failure

```
KnownSitesPort.incrementFailure("nypost.com")
└── failureCountSinceLastSuccess: 1
```

### Second Attempt (same or different article)

```
Content length: 0 chars ✗
KnownSitesPort.incrementFailure("nypost.com")
└── failureCountSinceLastSuccess: 2  // Threshold reached
```

### Step 9: Trigger Rediscovery

```
failureCountSinceLastSuccess >= 2
└── Enter Discovery Path (Steps 7-11 from first visit)
    └── LLM suggests new XPath: "//div[@class='article-wrapper']"
```

**Tests:**
- `increments failure count on extraction failure`
- `triggers rediscovery after 2 consecutive failures`
- `updates stored config with new XPath on success`

---

## Test Summary

### Unit Tests

| Component | Test Count | Focus |
|-----------|------------|-------|
| URL Validation | 5 | Format, normalization, edge cases |
| ContentScoringEngine | 10 | Scoring logic, thresholds, edge cases |
| LLM Response Parser | 6 | JSON extraction, markdown blocks, errors |

### Integration Tests (Engine with Mocks)

| Scenario | Mocked Ports |
|----------|--------------|
| First visit discovery | All ports |
| Known config success | All ports |
| Known config failure → rediscovery | All ports |
| CAPTCHA detected | BrowserPort, CaptchaPort |
| Network failure | BrowserPort |
| LLM failure | LlmPort |

### E2E Tests (Optional)

| Scenario | Real Services |
|----------|---------------|
| Local fixture server | BrowserPort only |
| Stable public URL | All (rate-limited) |

## Consequences

- Complete traceability from API call to response
- Each step maps to testable unit or integration test
- Failure paths documented with recovery mechanisms
- Performance characteristics visible (LLM call only on discovery)
