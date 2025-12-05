# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for SmartScraper. ADRs document significant architectural decisions, their context, and consequences.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [001](001-puppeteer.md) | Puppeteer Browser Configuration | Accepted |
| [002](002-public-api.md) | Public API Contract | Accepted |
| [003](003-core-engine.md) | Core Engine Architecture | Accepted |
| [004](004-llm-xpath-discovery.md) | LLM-Assisted XPath Discovery | Accepted |
| [005](005-captcha-integration.md) | CAPTCHA and DataDome Integration | Accepted |
| [006](006-known-sites-storage.md) | Known Sites Self-Learning Storage | Accepted |
| [007](007-network-proxy.md) | Network and Proxy Configuration | Accepted |
| [008](008-domain-models-ports.md) | Domain Models and Port Interfaces | Accepted |
| [009](009-decision-rules.md) | Decision Rules and Scraping Flow | Accepted |
| [010](010-llm-prompt-design.md) | LLM Prompt Design for XPath Discovery | Accepted |
| [011](011-backend-architecture.md) | Backend Architecture (Hono + HTMX) | Accepted |
| [012](012-nix-deployment.md) | Nix Deployment Architecture | Accepted |

## Overview

### Browser Layer
- **[ADR-001](001-puppeteer.md)** - Puppeteer session management, plugin architecture, UA configuration, content extraction

### Public Interface
- **[ADR-002](002-public-api.md)** - `scrapeUrl` function, constants (`METHODS`, `OUTPUT_TYPES`), `ScrapeResult` contract

### Core Architecture
- **[ADR-003](003-core-engine.md)** - `CoreScraperEngine` orchestration, pipeline phases, port dependencies
- **[ADR-008](008-domain-models-ports.md)** - Port interfaces (`BrowserPort`, `LlmPort`, `CaptchaPort`, `KnownSitesPort`), domain models
- **[ADR-009](009-decision-rules.md)** - Decision flow, known-config path vs discovery path, failure thresholds

### External Services
- **[ADR-004](004-llm-xpath-discovery.md)** - OpenRouter LLM integration, XPath suggestion, content scoring
- **[ADR-005](005-captcha-integration.md)** - 2Captcha integration for generic CAPTCHAs and DataDome
- **[ADR-007](007-network-proxy.md)** - HTTP proxy configuration, User-Agent handling
- **[ADR-010](010-llm-prompt-design.md)** - Prompt structure, DOM simplification, response parsing, token budget

### Persistence
- **[ADR-006](006-known-sites-storage.md)** - `SiteConfig` model, `KnownSitesPort`, failure tracking

### Backend
- **[ADR-011](011-backend-architecture.md)** - Hono + HTMX, API endpoints, dashboard, storage (sites.jsonc, stats.json, logs/*.jsonl)

### Deployment
- **[ADR-012](012-nix-deployment.md)** - Nix flake, devShell, NixOS module, sops-nix secrets

## ADR Format

Each ADR follows this structure:

```markdown
# ADR-NNN: Title

- Status: Proposed | Accepted | Deprecated | Superseded
- Date: YYYY-MM-DD

## Context
Why this decision is needed.

## Decision
What we decided and how it works.

## Consequences
Trade-offs and implications.
```

## Adding New ADRs

1. Create `NNN-short-title.md` with next sequential number
2. Follow the format above
3. Update this README index
