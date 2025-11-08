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

### 3.1 Method = CURL

1. Perform HTTP fetch via NetworkPort.
2. If network error or non-2xx status:
   - `incrementFailure(domain)`.
   - If `failureCountSinceLastSuccess >= 3` → delete config and go to discovery.
   - Else return failure with `errorType = 'NETWORK'`.
3. Analyze HTML:
   - If CAPTCHA/ban detected → go to discovery path (do not trust curl-only config).
4. Apply stored `xpathMainContent`:
   - If extracted content length >= `MIN_CONTENT_CHARS` (e.g. 500):
     - `markSuccess(domain)`.
     - Return success.
   - Else:
     - `incrementFailure(domain)`.
     - If `failureCountSinceLastSuccess >= 2` → go to discovery.
     - Else return failure `errorType = 'EXTRACTION'`.

### 3.2 Method = PUPPETEER_STEALTH

1. Load page via BrowserPort using stealth UA/proxy.
2. If navigation fails:
   - `incrementFailure(domain)` and return `NETWORK`.
3. If CAPTCHA detected:
   - Switch to discovery path (likely requires captcha-capable method).
4. Evaluate `xpathMainContent`:
   - If content meets `MIN_CONTENT_CHARS`:
     - `markSuccess(domain)` and return success.
   - Else:
     - `incrementFailure(domain)`.
     - If failures >= 2 → discovery.

### 3.3 Method = PUPPETEER_CAPTCHA

1. Load page via BrowserPort.
2. Run CaptchaPort.solveIfPresent.
3. If solve fails:
   - `incrementFailure(domain)` and return `CAPTCHA`.
4. Evaluate `xpathMainContent` post-solve.
   - Same rules as PUPPETEER_STEALTH for success/failure.

## 4. Discovery Path

Triggered when:
- No config exists, or
- Known-Config path indicates broken/insufficient config.

### 4.1 Curl Attempt

1. Fetch via NetworkPort.
2. If hard failure or obvious block/CAPTCHA:
   - Continue to Puppeteer path.
3. Analyze HTML:
   - If good content found with stable XPath:
     - Create SiteConfig with `method = CURL` and store.
     - Return success.
   - Otherwise → Puppeteer path.

### 4.2 Puppeteer Path

1. Load page via BrowserPort.
2. If CAPTCHA detected:
   - Attempt CaptchaPort.solveIfPresent.
   - If successful, reload/refresh state.
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

### 4.3 Persist Strategy

When a candidate succeeds:

- If no CAPTCHA during process:
  - `method = PUPPETEER_STEALTH` if Puppeteer was required.
- If CAPTCHA was required and solved:
  - `method = PUPPETEER_CAPTCHA` and `needsCaptchaSolver = true`.
- If curl alone sufficed:
  - `method = CURL`.

Always store:

- `xpathMainContent`,
- `lastSuccessfulScrapeTimestamp`,
- reset `failureCountSinceLastSuccess`.

## 5. Dom Comparator Usage (Optional but Supported)

When both curl and Puppeteer HTML are available:

- Compute similarity score.
- If similarity >= `DOM_SIMILARITY_THRESHOLD` (e.g. 0.9):
  - Prefer CURL in future configs for efficiency.
- Else:
  - Prefer Puppeteer-based methods.

## 6. Logging and Error Mapping

- All major decisions (method chosen, fallback triggers, scoring outcomes, captcha events)
  MUST be logged at INFO/DEBUG.
- Map internal errors to `ScrapeResult.errorType` consistently.

## 7. Concurrency and Resource Rules

- BrowserPort should be reused across multiple scrapes when possible.
- KnownSitesPort operations must be safe under concurrent reads/writes
  (no corrupt JSON, last-write-wins or locking strategy).
