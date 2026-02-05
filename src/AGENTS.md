# AGENTS.md - src/

## Package Identity

**SmartScraper Core** - Intelligent web scraping service with LLM-assisted XPath discovery.

- **Framework**: Hono (web server + JSX)
- **Architecture**: Ports & Adapters (Hexagonal)
- **Entry**: `index.ts`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         routes/                              │
│    api/scrape.ts          dashboard/*.tsx                   │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                         core/                                │
│    engine.ts (CoreScraperEngine)    scoring.ts              │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                         ports/                               │
│    BrowserPort    LlmPort    CaptchaPort    KnownSitesPort  │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                        adapters/                             │
│    PuppeteerBrowserAdapter    OpenRouterLlmAdapter          │
│    TwoCaptchaAdapter          FsKnownSitesAdapter           │
└─────────────────────────────────────────────────────────────┘
```

---

## Patterns & Conventions

### Ports & Adapters

**✅ DO:** Define interfaces in `ports/`, implement in `adapters/`

**❌ DON'T:** Put implementation logic in ports

### Domain Models

**✅ DO:** Define all domain types in `domain/models.ts`

**❌ DON'T:** Scatter type definitions across files

### Route Handlers

**✅ DO:** Use Hono routers with Zod validation
```typescript
import { zValidator } from '@hono/zod-validator';
const schema = z.object({ url: z.string().url() });
scrapeRouter.post('/', zValidator('json', schema), async (c) => { ... });
```

### JSX Components

**✅ DO:** Use Hono JSX, keep styles in `components/styles.ts`

### Configuration

**✅ DO:** Access config via `config.ts` getters

**❌ DON'T:** Read `process.env` directly outside `config.ts`

### Logging

**✅ DO:** Use `logger` utility

**❌ DON'T:** Use `console.log` directly

### Imports

**✅ DO:** Use `.js` extension for local imports (ESM requirement)
```typescript
import { scrapeUrl } from './core/engine.js';  // Correct
```

**❌ DON'T:** Omit extension (will fail at runtime)

### Testing

**✅ DO:** Colocate tests with source (`foo.ts` → `foo.test.ts`)

**✅ DO:** Mock ports for unit tests (see `core/engine.test.ts`)

---

## Key Files

| Purpose | File |
|---------|------|
| Entry point | `index.ts` |
| Configuration | `config.ts` |
| Core engine | `core/engine.ts` |
| Domain models | `domain/models.ts` |
| Port interfaces | `ports/index.ts` |
| API endpoint | `routes/api/scrape.ts` |
| Dashboard | `routes/dashboard/index.tsx` |

---

## Common Gotchas

1. **ESM Extensions**: Always use `.js` in imports for `.ts` files
2. **Config Init**: Call `initConfig()` before accessing getters
3. **Engine Init**: Call `initializeEngine()` before `scrapeUrl()`
4. **Queue**: Configurable via `CONCURRENCY` env var (default: 1, max: 20)
5. **Queue Limit**: Max 100 pending requests

---

## Related ADRs

- `003-core-engine.md` - Engine design
- `008-domain-models-ports.md` - Hexagonal architecture
- `013-centralized-configuration.md` - Config pattern
