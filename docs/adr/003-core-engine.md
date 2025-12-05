# ADR-003: Core Engine Architecture

- Status: Accepted
- Date: 2025-12-05

## Context

SmartScraper must handle diverse websites: static HTML, JS-heavy SPAs, and anti-bot protected sites. A central orchestrator is needed to coordinate multiple subsystems.

## Decision

### CoreScraperEngine

A single orchestrator class (`src/core/engine.ts`) that:

1. Provides the `scrapeUrl` entrypoint
2. Coordinates subsystems via port interfaces (dependency inversion)
3. Manages the scraping pipeline flow

### Subsystem Coordination

```
┌─────────────────────────────────────────────────────────┐
│                   CoreScraperEngine                      │
├─────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ Browser  │  │   LLM    │  │ CAPTCHA  │  │ Known   │ │
│  │   Port   │  │   Port   │  │   Port   │  │ Sites   │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Pipeline Phases

1. **Validation** - URL validation, early exit on invalid input
2. **Config Lookup** - Check KnownSitesPort for existing domain config
3. **Fetch** - Load page via BrowserPort
4. **CAPTCHA Check** - Detect and optionally solve CAPTCHAs
5. **Discovery** - If no XPath known, use LLM to suggest candidates
6. **Scoring** - Rank XPath candidates via ContentScoringEngine
7. **Extraction** - Extract content using best XPath
8. **Persistence** - Save successful config to KnownSitesPort

### Port Dependencies

Engine depends only on port interfaces, not concrete implementations:

```typescript
class CoreScraperEngine {
  constructor(
    private browserPort: BrowserPort,
    private llmPort: LlmPort,
    private captchaPort: CaptchaPort,
    private knownSitesPort: KnownSitesPort
  ) {}
}
```

## Consequences

- Single place to reason about scraping flow
- Testable via mock port implementations
- Changes to engine have wide impact; requires comprehensive testing
- Concrete adapters (Puppeteer, OpenRouter, 2Captcha, FS) implement ports
