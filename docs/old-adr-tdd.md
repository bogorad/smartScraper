1. ADR files (concise, linked decisions)

Create: docs/adr/0001-core-architecture.md

```markdown
# ADR-0001: Core Scraper Architecture

- Status: Accepted
- Date: 2025-11-08

## Context

The system must robustly extract main content from diverse websites that use:

- Static HTML,
- Heavy client-side rendering,
- Anti-bot measures and CAPTCHAs (incl. DataDome).

We need:

- A simple public API,
- A flexible internal pipeline that can evolve,
- Integration with LLMs, Puppeteer, proxies, and CAPTCHA solvers,
- Persistent, per-site learnings.

## Decision

Use a central orchestrator `CoreScraperEngine` (`src/core/engine.ts`) that:

- Provides a single entrypoint for scraping.
- Coordinates:
  - HTTP fetching (`src/network/curl-handler.ts`),
  - Browser-based scraping (`src/browser/puppeteer-controller.ts`),
  - HTML analysis and scoring (`src/analysis/*`),
  - LLM-based XPath suggestion (`src/services/llm-interface.ts`),
  - CAPTCHA/DataDome solving (`src/services/*`),
  - Per-site configuration storage (`src/storage/known-sites-manager.ts`).
- Is wrapped by `src/index.ts` as the public API.

## Consequences

- Single place to reason about scraping flow.
- Changes in engine behavior have wide impact; must be well-tested.
- Keeps external integration simple (`scrapeUrl`, `METHODS`, `OUTPUT_TYPES`).

---

# ADR-0002: Self-Learning Per-Site Configuration

- Status: Accepted
- Date: 2025-11-08

## Context

Different domains require different strategies (curl vs Puppeteer vs CAPTCHA),
and discovered XPaths should be reused to avoid repeated, slow discovery.

## Decision

Introduce `KnownSitesManager` (`src/storage/known-sites-manager.ts`) to persist:

- `method` (curl/puppeteer_stealth/puppeteer_captcha),
- `xpath_main_content`,
- CAPTCHA-related flags/cookies,
- failure/success counters,
- custom headers, user agent, wait conditions.

Store configs in a JSON file configured via `scraper-settings.ts`.

## Consequences

- Faster subsequent scrapes and adaptive behavior.
- Requires:
  - Schema evolution strategy,
  - Validation/recovery when configs become invalid,
  - Concurrency-safe writes (basic locking is implemented).

---

# ADR-0003: Hybrid HTTP + Browser Fetch Strategy

- Status: Accepted
- Date: 2025-11-08

## Context

Using a headless browser for every request is slow and costly.
Using only HTTP fails on JS-heavy or protected sites.

## Decision

Adopt a hybrid strategy:

1. Prefer HTTP via `fetchWithCurl` (`src/network/curl-handler.ts`).
2. Fallback to Puppeteer (`src/browser/puppeteer-controller.ts`) when:
   - HTML is incomplete/blocked,
   - CAPTCHA/anti-bot is detected,
   - or heuristics demand dynamic rendering.
3. Use `DomComparator` to compare curl vs browser HTML when needed.

## Consequences

- Better performance for “easy” sites.
- Additional flow complexity and branching.
- Requires clear metrics/logging for when/why we switch.

---

# ADR-0004: LLM-Assisted XPath Discovery with Scoring

- Status: Accepted
- Date: 2025-11-08

## Context

Fixed rules for content extraction don’t generalize well.
We want automated, explainable discovery.

## Decision

Combine:

- `HtmlAnalyserFixed` for structure/snippets,
- `LLMInterface` for candidate XPath proposals,
- `ContentScoringEngine` for ranking candidates based on DOM signals,
- optional live validation via Puppeteer.

Persist the chosen XPath and method via `KnownSitesManager`.

## Consequences

- Extensible and adaptable extraction.
- Introduces dependency on LLM reliability.
- Requires:
  - Defensive parsing of LLM responses,
  - Strong tests for the scoring model,
  - Safe fallbacks on bad suggestions.

---

# ADR-0005: Explicit CAPTCHA and DataDome Integration

- Status: Accepted
- Date: 2025-11-08

## Context

Many targets use CAPTCHAs/anti-bot (inc. DataDome).
We must solve or gracefully detect/skip them.

## Decision

Use dedicated services:

- `CaptchaSolver` for generic CAPTCHAs,
- `DataDomeSolver` for DataDome flows,
- integrate with Puppeteer, proxies, and `KnownSitesManager`
  (e.g., storing cookies, flags, chosen methods).

## Consequences

- Encapsulated complexity and easier replacement.
- Tight coupling to third-party services (2Captcha, etc.).
- Needs robust error handling, timeouts, and observability.

---

# ADR-0006: Centralized Cross-Cutting Utilities

- Status: Accepted
- Date: 2025-11-08

## Context

Without shared utilities, logging and error semantics diverge.

## Decision

Standardize on:

- `logger.ts` for leveled logging,
- `error-handler.ts` for typed domain errors,
- `url-helpers.ts` for URL normalization and validation.

## Consequences

- Consistent error/log behavior.
- Utilities are foundational; changes must be backwards compatible.
```

2. TDD plan file

Create: docs/testing-strategy.md

```markdown
# Testing Strategy and TDD Plan

This document defines how to apply TDD and structured testing
to the current architecture.

## Goals

- Guard core behaviors (scraping flows, learning, fallbacks).
- Make refactors to engine/services safe.
- Minimize reliance on flaky external systems in tests.

## Test Layers

### 1. Unit Tests

Scope: pure or isolated modules.

Priority targets:

- `src/analysis/content-scoring-engine.ts`
  - Given `ElementDetails`, produce expected scores.
  - Cover:
    - High-density article blocks.
    - Navigation/boilerplate (should score low).
    - Edge cases: empty nodes, excessive links, ads.

- `src/analysis/html-analyser-fixed.ts`
  - Fixture HTML:
    - `extractByXpath` returns expected text.
    - `extractArticleSnippets` returns meaningful snippets.
    - CAPTCHA / DataDome markers are detected correctly.
    - `queryStaticXPathWithDetails` fills all metrics.

- `src/analysis/dom-comparator.ts`
  - Verify similarity/dissimilarity with controlled HTML pairs.

- `src/utils/url-helpers.ts`
  - Already covered; extend for more TLDs and malformed URLs.

- `src/utils/error-handler.ts`
  - Ensure each error type carries correct metadata and is distinguishable.

- `src/storage/known-sites-manager.ts`
  - Already tested; add:
    - Behavior on missing/corrupt file (if not covered),
    - Concurrency/locking behavior in fast write loops,
    - Removal/update semantics.

- `src/network/curl-handler.ts`
  - With mocked axios:
    - Success with/without proxies.
    - Timeouts, network errors mapped to `NetworkError`.
    - TLS relax behavior.

### 2. Service Adapter Tests

Use mocks/fakes to keep them deterministic.

- `src/services/llm-interface.ts`
  - Mock HTTP client:
    - Valid response → parse multiple XPaths.
    - Invalid/empty response → graceful error.
    - Timeouts → wrapped error.
    - Ensure prompt structure is as expected.

- `src/services/captcha-solver.ts`
- `src/services/datadome-solver.ts`
  - Mock 2Captcha/DataDome APIs and Puppeteer Page:
    - Detect presence/absence of CAPTCHAs.
    - Successful solve → correct page interaction and cookie application.
    - Failure/timeouts → proper error types and no silent hangs.

### 3. Integration Tests (Engine with Fakes)

Focus: `src/core/engine.ts` behavior.
Approach: inject fakes for network, browser, LLM, and storage.

Key scenarios (write tests first):

1. Uses existing valid site config
   - Given a stored config with method = `curl` and valid XPath.
   - Engine:
     - Calls fake curl once.
     - Does not call LLM or Puppeteer.
     - Returns expected content.

2. Falls back to Puppeteer on dynamic site
   - curl returns incomplete HTML.
   - Puppeteer fake returns full HTML.
   - Engine:
     - Switches to Puppeteer,
     - Extracts with known XPath or proceeds to discovery.

3. Full discovery flow with LLM + scoring
   - No stored config.
   - curl HTML + snippets → LLM fake returns candidate XPaths.
   - Scoring selects best candidate above threshold.
   - Engine:
     - Persists config via KnownSitesManager fake,
     - Returns content defined by chosen XPath.

4. Handling broken stored config
   - Stored XPath no longer matches.
   - Engine:
     - Detects failure,
     - Triggers discovery,
     - Updates config.

5. CAPTCHA / DataDome handling
   - HTML/page fakes indicate CAPTCHA or DataDome.
   - CaptchaSolver/DataDomeSolver fakes:
     - Succeed or fail deterministically.
   - Engine:
     - Sets/uses `needs_captcha_solver` and related flags correctly.
     - Surfaces appropriate errors on failure.

### 4. End-to-End (Optional, Targeted)

Sparse, but valuable:

- Use the public API (`src/index.ts`) against:
  - Local fixture server or static HTML files,
  - A small set of stable public URLs (if acceptable).

Asserts:

- Correct extraction shape (non-empty, contains expected markers).
- Creation/update of `known_sites_storage.json` entries.

### 5. TDD Workflow Guidelines

For new features or changes:

1. Start with a failing test at the appropriate layer:
   - Unit test for pure logic.
   - Integration test for engine flow/regression.
2. Implement minimal code to pass the test.
3. Refactor with tests green.
4. For engine-level behavior, prefer integration tests that:
   - Mock external effects (HTTP, LLM, CAPTCHA),
   - Verify decision logic and persistence, not network details.

For bug fixes:

1. Reproduce via a failing test (prefer integration if it’s flow-related).
2. Fix in the smallest responsible component.
3. Keep the new test as regression coverage.

## Coverage Priorities

1. Decision logic in `CoreScraperEngine` (high).
2. KnownSitesManager correctness and safety (high).
3. LLM + scoring + analyzer interoperability (high).
4. CAPTCHA/DataDome flows (medium-high).
5. Network and Puppeteer adapters (medium; focus via mocks).
```
