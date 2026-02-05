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
│                       middleware/                            │
│    auth.ts       rate-limit.ts       csrf.ts                │
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

### Middleware

**✅ DO:** Apply middleware in correct order (rate limit → auth → route)
```typescript
app.use('/api/scrape', rateLimitMiddleware({ maxRequests: 10, windowMs: 60000 }));
app.use('/api/scrape', apiAuthMiddleware);
```

**✅ DO:** Use CSRF middleware for dashboard POST/PUT/DELETE

**❌ DON'T:** Skip CSRF validation for form submissions

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
| Constants | `constants.ts` |
| Core engine | `core/engine.ts` |
| Content scoring | `core/scoring.ts` |
| Domain models | `domain/models.ts` |
| Port interfaces | `ports/*.ts` |
| Browser adapter | `adapters/puppeteer-browser.ts` |
| LLM adapter | `adapters/openrouter-llm.ts` |
| CAPTCHA adapter | `adapters/twocaptcha.ts` |
| Sites storage | `adapters/fs-known-sites.ts` |
| API endpoint | `routes/api/scrape.ts` |
| Dashboard | `routes/dashboard/index.tsx` |
| Dashboard login | `routes/dashboard/login.tsx` |
| Sites management | `routes/dashboard/sites.tsx` |
| Stats view | `routes/dashboard/stats.tsx` |
| Auth middleware | `middleware/auth.ts` |
| Rate limiting | `middleware/rate-limit.ts` |
| CSRF protection | `middleware/csrf.ts` |
| Stats service | `services/stats-storage.ts` |
| Log service | `services/log-storage.ts` |

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
