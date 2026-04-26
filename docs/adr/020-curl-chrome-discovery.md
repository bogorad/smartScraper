# ADR-020: Curl and Chrome Discovery Strategy

- Status: Accepted
- Date: 2026-04-26

## Context

SmartScraper previously had a separate lightweight page fetch path. The active runtime strategy is now simpler: every scrape should be explained by one of two methods, `curl` or `chrome`.

Unknown domains need a cheap first attempt before launching Chromium. Known domains need to reuse the method that has already worked. CAPTCHA handling also needs a narrow policy: DataDome remains supported for chrome-only protected sites, while reCAPTCHA, Turnstile, and hCaptcha are detected but not solved in this pass.

## Decision

SmartScraper exposes two scrape methods:

- `curl`: server-side HTTP fetch for pages that can be fetched without browser execution.
- `chrome`: Puppeteer-based browser fetch for pages that need JavaScript, cookies, CAPTCHA handling, or browser-specific behavior.

For a new site, the engine tries `curl` first. If `curl` returns usable article content, the successful strategy is recorded for that domain. If `curl` fails, returns unusable content, or receives an access challenge, the engine falls back to `chrome`.

For a known site, stored strategy fields guide future scrapes:

- `method`: `curl` or `chrome`.
- `captcha`: `none`, `datadome`, `recaptcha`, `turnstile`, `hcaptcha`, or `unsupported`.
- `proxy`: `none`, `default`, or `datadome`.

DataDome is the only CAPTCHA family solved by the 2Captcha adapter in this strategy. reCAPTCHA, Turnstile, and hCaptcha detection returns explicit unsupported CAPTCHA results so API clients see the real blocker instead of a generic extraction failure.

WSJ remains a chrome + DataDome site. DataDome proxy sessions are separate from the default SOCKS proxy path.

## Consequences

The public API, logs, stats, and persisted strategy data should only report `curl` or `chrome` as the scrape method.

The engine must record method fallback evidence so a later failure can be diagnosed from logs and persisted site strategy data.

The runtime has fewer browser-like fetch modes, which reduces bootstrap wiring and test surface area. The trade-off is that sites requiring non-DataDome CAPTCHA solving will fail explicitly until support is added for that CAPTCHA family.
