# Public API Specification

This document defines the public, supported API surface for SmartScraper.
It is intended as the contract for a full rebuild.

## Entry Point

Library consumers use the exports from `src/index.ts` (or `dist/src/index.js` after build).

### scrapeUrl

Signature (conceptual):

- `async scrapeUrl(targetUrl, options?): Promise<ScrapeResult>`

Where:

- `targetUrl: string`
  - Required, must be a valid absolute URL.

- `options` (all optional):
  - `outputType?: OutputTypeValue`
    - One of `OUTPUT_TYPES.CONTENT_ONLY`, `OUTPUT_TYPES.FULL_HTML`, `OUTPUT_TYPES.METADATA_ONLY`, etc.
    - Default: `OUTPUT_TYPES.CONTENT_ONLY`.
  - `methodHint?: MethodValue`
    - Optional suggested method (e.g. `METHODS.CURL`, `METHODS.PUPPETEER_STEALTH`, `METHODS.PUPPETEER_CAPTCHA`).
    - Engine MAY ignore this if it conflicts with known config or heuristics.
  - `proxyDetails?: { server: string }`
    - Overrides global proxy for this call.
  - `userAgentString?: string`
    - Overrides default/known-site UA.
  - `timeoutMs?: number`
    - Overall soft timeout hint for the operation.
  - `debugContextId?: string`
    - Optional id to correlate logs/artifacts.

### getDefaultEngine

- `getDefaultEngine(): CoreScraperEngine`
- Returns a preconfigured engine instance using current configs/env.
- Consumers typically call `scrapeUrl` instead; this is for advanced use.

### Constants

- `METHODS`
  - Stable identifiers for strategies:
    - `CURL`, `PUPPETEER_STEALTH`, `PUPPETEER_CAPTCHA` (plus any future ones).

- `OUTPUT_TYPES`
  - Stable identifiers for output modes used by `scrapeUrl`.

These constants form part of the public contract and must remain backward compatible.

## ScrapeResult Contract

`scrapeUrl` MUST resolve (not reject) for expected operational failures; it only rejects on truly unexpected/internal failures.

Shape:

- `success: boolean`
- `method?: MethodValue`
  - Strategy used for final attempt.
- `xpath?: string`
  - Chosen XPath for main content (if applicable).
- `data?: string | object`
  - Extracted content or structured output, depending on `outputType`.
- `rawHtmlSnapshotPath?: string`
  - Optional path to stored HTML snapshot (for debug modes).
- On failure (`success === false`):
  - `errorType: 'NETWORK' | 'CAPTCHA' | 'LLM' | 'CONFIGURATION' | 'EXTRACTION' | 'UNKNOWN'`
  - `error: string`
  - `details?: any`
    - Free-form, but should include enough info for diagnosis (e.g., status codes, last method attempted).

## Error Handling Rules

- `scrapeUrl` SHOULD:
  - Validate URL early and return `{ success: false, errorType: 'CONFIGURATION' }` for invalid URLs.
  - Map domain errors to `errorType` values consistently.
  - Only throw (reject) on programmer/configuration errors that indicate misuse of the library itself.

## Backward Compatibility Requirements

A full rebuild MUST preserve:

- Function names and general signatures for `scrapeUrl`, `getDefaultEngine`, `METHODS`, `OUTPUT_TYPES`.
- General `ScrapeResult` shape and semantics above.
- Behavior that learned per-site configs are honored when present and may be updated by new runs.
