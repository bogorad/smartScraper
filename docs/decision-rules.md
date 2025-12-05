# Decision Rules Specification

This document formalizes the key decision logic for the scraping engine.
It is intended as a precise guide for a full rebuild.

## 1. Initial Validation

- If `targetUrl` is missing or invalid:
  - Return `success = false`, `errorType = 'CONFIGURATION'`.

## 2. Load Known SiteConfig

- Lookup by normalized base domain.
- If found, attempt **known-config path**.
- If not found, go to **discovery path**.

## 3. Known-Config Path

### 3.1 Method = NORMAL

1. Load page via BrowserPort using stealth UA/proxy.
2. If navigation fails:
   - `incrementFailure(domain)` and return `NETWORK`.
3. If CAPTCHA detected:
   - Fail for now
4. Evaluate `xpathMainContent`:
   - If content meets `MIN_CONTENT_CHARS`:
     - `markSuccess(domain)` and return success.
   - Else:
     - `incrementFailure(domain)`.
     - If failures >= 2 → discovery.

### 3.2 Method = PUPPETEER_CAPTCHA

1. Will be implemented later.

## 4. Discovery Path

Triggered when:

- No config exists, or
- Known-Config path indicates broken/insufficient config.

### 4.1 Puppeteer Path

1. Load page via BrowserPort.
2. If CAPTCHA detected:
   - Fail for now
3. Build simplified DOM + snippets for LLM.
4. Call LlmPort.suggestXPaths.
5. For each candidate XPath:
   - Evaluate via BrowserPort / static analyzer → ElementDetails.
   - Score with ContentScoringEngine.
6. Select best candidate:
   - Must satisfy:
     - score >= `MIN_SCORE_THRESHOLD` (e.g. 0.7), and
     - extracted content length >= `MIN_CONTENT_CHARS`.
   - If no candidate passes:
     - Return `success = false`, `errorType = 'EXTRACTION'`.

### 4.2 Persist Strategy

When a candidate succeeds:

- Save
  - `method = NORMAL`

Always store:

- `xpathMainContent`,
- `lastSuccessfulScrapeTimestamp`,
- reset `failureCountSinceLastSuccess`.

## 5. Logging and Error Mapping

- All major decisions (method chosen, fallback triggers, scoring outcomes, captcha events)
  MUST be logged at INFO/DEBUG.
- Map internal errors to `ScrapeResult.errorType` consistently.

## 7. Concurrency and Resource Rules

- BrowserPort should be reused across multiple scrapes when possible.
- KnownSitesPort operations must be safe under concurrent reads/writes
  (no corrupt JSON, last-write-wins or locking strategy).
