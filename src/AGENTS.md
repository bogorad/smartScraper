# AGENTS.md - src/

## Package Identity

**SmartScraper Core** - Intelligent web scraping service with LLM-assisted XPath discovery.

- **Framework**: Hono (web server + JSX)
- **Architecture**: Ports & Adapters (Hexagonal)
- **Entry**: `index.ts`

---

## Setup & Run

```bash
# From project root
npm run dev          # Development with hot reload
npm run build        # Compile TypeScript
npm run typecheck    # Type check only
npm test             # Run Vitest tests
npm test -- --watch  # Watch mode
```

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

### Ports & Adapters Pattern

**✅ DO: Define interfaces in `ports/`, implement in `adapters/`**
```typescript
// ports/browser.ts - Interface only
export interface BrowserPort {
  open(): Promise<void>;
  loadPage(url: string, options?: LoadPageOptions): Promise<{ pageId: string }>;
}

// adapters/puppeteer-browser.ts - Implementation
export class PuppeteerBrowserAdapter implements BrowserPort {
  async open(): Promise<void> { ... }
  async loadPage(url: string, options?: LoadPageOptions): Promise<{ pageId: string }> { ... }
}
```

**❌ DON'T: Put implementation logic in ports**

### Domain Models

**✅ DO: Define all domain types in `domain/models.ts`**
- See: `domain/models.ts` for `ScrapeOptions`, `ScrapeResult`, `SiteConfig`

**❌ DON'T: Define domain types scattered across files**

### Route Handlers

**✅ DO: Use Hono routers, export from dedicated files**
```typescript
// routes/api/scrape.ts
import { Hono } from 'hono';
export const scrapeRouter = new Hono();
scrapeRouter.post('/', async (c) => { ... });
```

**✅ DO: Use Zod for validation**
```typescript
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

const schema = z.object({ url: z.string().url() });
scrapeRouter.post('/', zValidator('json', schema), async (c) => { ... });
```

### JSX Components

**✅ DO: Use Hono JSX for UI components**
```typescript
// components/layout.tsx
import type { FC, PropsWithChildren } from 'hono/jsx';

export const Layout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <html>
    <head><title>{title}</title></head>
    <body>{children}</body>
  </html>
);
```

**✅ DO: Keep styles in `components/styles.ts`**

### Utilities

**✅ DO: Pure functions, well-tested**
- See: `utils/html-cleaner.ts`, `utils/dom.ts`, `utils/xpath-parser.ts`

**✅ DO: Export via barrel file `utils/index.ts`**

### Testing

**✅ DO: Colocate tests with source**
```
adapters/
  openrouter-llm.ts
  openrouter-llm.test.ts      # Colocated test
core/
  engine.ts
  engine.test.ts              # Colocated test
```

**✅ DO: Use Vitest globals (`describe`, `it`, `expect`)**

**✅ DO: Mock ports for unit tests**
```typescript
// See: core/engine.test.ts for mocking patterns
const mockBrowserPort: BrowserPort = {
  open: vi.fn(),
  loadPage: vi.fn().mockResolvedValue({ pageId: 'test' }),
  // ...
};
```

### Configuration

**✅ DO: Access config via `config.ts` getters**
```typescript
import { getPort, getDataDir, getOpenRouterApiKey } from './config.js';
```

**❌ DON'T: Read `process.env` directly outside `config.ts`**

### Logging

**✅ DO: Use the logger utility**
```typescript
import { logger } from './utils/logger.js';
logger.info('[MODULE] Message');
logger.debug('[MODULE] Debug details');
logger.error('[MODULE] Error:', error);
```

**❌ DON'T: Use `console.log` directly**

### Imports

**✅ DO: Use `.js` extension for local imports (ESM requirement)**
```typescript
import { scrapeUrl } from './core/engine.js';
```

**❌ DON'T: Omit extension**
```typescript
import { scrapeUrl } from './core/engine';  // Will fail at runtime
```

---

## Touch Points / Key Files

| Purpose | File |
|---------|------|
| Entry point | `index.ts` |
| Configuration | `config.ts` |
| Constants | `constants.ts` |
| Core engine | `core/engine.ts` |
| Domain models | `domain/models.ts` |
| Port interfaces | `ports/index.ts` |
| Browser adapter | `adapters/puppeteer-browser.ts` |
| LLM adapter | `adapters/openrouter-llm.ts` |
| API endpoint | `routes/api/scrape.ts` |
| Dashboard UI | `routes/dashboard/index.tsx` |
| UI Layout | `components/layout.tsx` |
| Styles | `components/styles.ts` |

---

## JIT Index Hints

```bash
# Find all port interfaces
rg -n "export interface \w+Port" ports/

# Find all adapter classes
rg -n "export class \w+Adapter" adapters/

# Find route definitions
rg -n "\.(get|post|put|delete)\(" routes/

# Find JSX components
rg -n "export const \w+.*FC" components/

# Find test files
find . -name "*.test.ts"

# Find Zod schemas
rg -n "z\.(object|string|number|array)" routes/

# Find logger usage
rg -n "logger\.(info|debug|error|warn)" .
```

---

## Common Gotchas

1. **ESM Extensions Required**: Always use `.js` in imports even for `.ts` files
2. **Config Initialization**: Call `initConfig()` before accessing getters
3. **Engine Initialization**: Call `initializeEngine()` before `scrapeUrl()`
4. **Queue Concurrency**: `CoreScraperEngine` uses `PQueue({ concurrency: 5 })`
5. **Queue Size Limit**: Max 100 pending requests (`MAX_QUEUE_SIZE`)
6. **Chromium Path**: Set `EXECUTABLE_PATH` env var or Nix handles it

---

## Pre-PR Checks

```bash
npm run typecheck && npm test && npm run build
```

---

## Related Documentation

- **Architecture Decisions**: `../docs/adr/` (15 ADRs covering design choices)
- **Config Reference**: `../docs/CONFIGURATION.md`
- **Key ADRs**:
  - `003-core-engine.md` - Engine design
  - `008-domain-models-ports.md` - Hexagonal architecture
  - `011-backend-architecture.md` - Overall structure
  - `013-centralized-configuration.md` - Config pattern
