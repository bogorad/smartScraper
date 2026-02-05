# ADR 017: Timeout Constants Are Sacred

## Status

**ACCEPTED** - 2026-02-05

## Context

Browser automation timeouts exist for critical reasons that are not immediately obvious. They account for:

1. **Extension initialization** - Browser extensions (bypass-paywalls, adblockers) need time to load and initialize
2. **Async content injection** - Extensions like bypass-paywalls fetch content from archive.is and inject it into the DOM asynchronously
3. **JavaScript execution** - Sites with heavy JS need time to render content
4. **Network latency** - External resources, CDNs, and third-party scripts
5. **Anti-bot evasion** - Human-like timing patterns help avoid detection

## The Incident

Original timeout after page load: **3 seconds**

Someone "optimized" it: 3s → 2s → **1 second**

Result: **thetimes.com stopped working** because the bypass-paywalls extension fetches article content from archive.is asynchronously. With only 1 second wait, the scraper evaluated XPath before content was injected.

## Decision

**DO NOT REDUCE TIMEOUTS WITHOUT:**

1. **Explicit justification** documented in commit message
2. **Testing against ALL sites** in `testing/urls_for_testing.txt`
3. **Understanding WHY** the timeout exists (read this ADR first)
4. **User approval** - timeouts are configuration, not "optimization opportunities"

## Timeout Reference

| Location | Value | Purpose |
|----------|-------|---------|
| Post-navigation wait (no extensions) | 3000ms | Allow JS rendering, human-like delay |
| Post-navigation wait (with extensions) | Poll up to 15000ms | Wait for extension content injection |
| Extension init wait | 2000ms | Allow extensions to initialize |
| Page load timeout | 120000ms | Handle slow sites, large pages |

## Consequences

- Timeouts are treated as **carefully tuned constants**, not arbitrary values
- Any timeout reduction requires regression testing
- This ADR must be referenced in any PR that modifies timeout values

## See Also

- `src/adapters/puppeteer-browser.ts` - Browser automation implementation
- `src/config.ts` - Centralized configuration (DEFAULTS.TIMEOUT_MS)
