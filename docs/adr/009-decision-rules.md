# ADR-009: Decision Rules and Scraping Flow

- Status: Accepted
- Date: 2025-12-05

## Context

The engine must make consistent decisions about which path to take: use known config, trigger discovery, handle failures, and manage resources efficiently.

## Decision

### Flow Overview

```
┌─────────────┐
│  Validate   │──invalid──▶ Return CONFIGURATION error
│    URL      │
└──────┬──────┘
       │valid
       ▼
┌─────────────┐
│ Load Known  │──found──▶ Known-Config Path
│   Config    │
└──────┬──────┘
       │not found
       ▼
   Discovery Path
```

### 1. Initial Validation

- Missing or invalid URL: `{ success: false, errorType: 'CONFIGURATION' }`

### 2. Known-Config Path

When `SiteConfig` exists for domain:

1. Load page via BrowserPort
2. If navigation fails: `incrementFailure()`, return `NETWORK` error
3. If CAPTCHA detected: fail (CAPTCHA path not yet implemented)
4. Evaluate stored `xpathMainContent`:
   - Content >= `MIN_CONTENT_CHARS`: `markSuccess()`, return success
   - Content insufficient: `incrementFailure()`
   - If failures >= 2: trigger Discovery Path

### 3. Discovery Path

Triggered when:
- No config exists for domain
- Known config failed 2+ times

Steps:
1. Load page via BrowserPort
2. If CAPTCHA detected: fail (for now)
3. Build simplified DOM + snippets
4. Call `LlmPort.suggestXPaths()`
5. For each candidate:
   - Evaluate via BrowserPort → `ElementDetails`
   - Score with `ContentScoringEngine`
6. Select best candidate:
   - `score >= MIN_SCORE_THRESHOLD` (0.7)
   - `content.length >= MIN_CONTENT_CHARS`
7. If no candidate passes: return `EXTRACTION` error

### 4. Persist on Success

Save to KnownSitesPort:
- `xpathMainContent`
- `lastSuccessfulScrapeTimestamp`
- Reset `failureCountSinceLastSuccess` to 0

### 5. Logging Requirements

Log at INFO/DEBUG:
- Method chosen
- Fallback triggers
- Scoring outcomes
- CAPTCHA detection events

### 6. Concurrency Rules

- BrowserPort may be reused across scrapes
- KnownSitesPort operations must be concurrency-safe

## Consequences

- Predictable, documented decision logic
- Clear failure thresholds for triggering rediscovery
- Must map internal errors to `errorType` consistently
- All decision points logged for debugging
