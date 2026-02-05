# ADR-003: Core Engine Architecture

- Status: Accepted
- Date: 2025-12-05
- Updated: 2026-02-05

## Context

SmartScraper must handle diverse websites: static HTML, JS-heavy SPAs, and anti-bot protected sites. A central orchestrator is needed to coordinate multiple subsystems.

## Decision

### CoreScraperEngine

A single orchestrator class (`src/core/engine.ts`) that:

1. Provides the `scrapeUrl` entrypoint
2. Coordinates subsystems via port interfaces (dependency inversion)
3. Manages the scraping pipeline flow
4. Processes requests with **configurable concurrency** (default: 1)

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
3. **Fetch** - Launch browser, load page via BrowserPort
4. **CAPTCHA Check** - Detect and optionally solve CAPTCHAs
5. **Discovery** - If no XPath known, use LLM to suggest candidates
6. **Scoring** - Rank XPath candidates via ContentScoringEngine
7. **Extraction** - Extract content using best XPath
8. **Cleanup** - Close browser, delete temp profile
9. **Persistence** - Save successful config to KnownSitesPort

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

### Configurable Concurrency Model

Scrapes are processed via an in-memory queue with **configurable concurrency**. The concurrency level is set via the `CONCURRENCY` environment variable (default: 1, max: 20).

**Mechanism:** In-memory queue (`p-queue`) with configurable concurrency.

**Configuration:**
- Concurrency: `CONCURRENCY` env var (default: 1, range: 1-20)
- Queue size limit: `100` (returns error when exceeded)
- Timeout: Request dependent (default 120s)

```typescript
import PQueue from 'p-queue';
import { getConcurrency } from '../config.js';

export class CoreScraperEngine {
  private static readonly MAX_QUEUE_SIZE = 100;
  private queue: PQueue;
  private readonly maxWorkers: number;

  constructor(...) {
    this.maxWorkers = getConcurrency();
    this.queue = new PQueue({ concurrency: this.maxWorkers });
  }

  async scrapeUrl(url: string, options?: ScrapeOptions): Promise<ScrapeResult> {
    if (this.queue.size >= CoreScraperEngine.MAX_QUEUE_SIZE) {
      return { success: false, errorType: 'CONFIGURATION', error: 'Server overloaded, please retry later' };
    }
    return this.queue.add(() => this._executeScrape(url, options));
  }
}
```

### Request Flow

```
Client Requests (multiple)
     │
     ▼
┌─────────────┐
│  API Layer  │  POST /api/scrape
└─────────────┘
     │
     ▼
┌─────────────┐
│    Queue    │  p-queue (concurrency: N, max: 100)
└─────────────┘
     │
     ├──────────────┬──────────────┐
     ▼              ▼              ▼
┌─────────┐   ┌─────────┐   ┌─────────┐
│ Worker 1│   │ Worker 2│   │ Worker N│
│ Browser │   │ Browser │   │ Browser │
└─────────┘   └─────────┘   └─────────┘
     │              │              │
     └──────────────┴──────────────┘
                    │
                    ▼
            ┌─────────────┐
            │  Responses  │  JSON results returned to clients
            └─────────────┘
```

## Consequences

### Benefits

- **Configurable**: Adjust concurrency via environment variable
- **Better throughput**: N concurrent scrapes vs sequential
- **Lower latency**: Clients wait less when queue has pending work
- **Isolated**: Each browser instance has its own profile directory
- **Testable**: Via mock port implementations

### Trade-offs

- **Memory**: Each browser uses ~200-400MB; N browsers = N×400MB
- **CPU contention**: Multiple browsers parsing JS simultaneously
- **Complexity**: Dashboard shows multiple active URLs
- **Resource planning**: Must size server for peak concurrent load

### Resource Guidelines

| Concurrency | Memory Required | Recommended Server RAM |
|-------------|-----------------|------------------------|
| 1 | ~500 MB | 1 GB |
| 2 | ~1 GB | 2 GB |
| 4 | ~2 GB | 4 GB |
| 10 | ~5 GB | 8 GB |
| 20 | ~10 GB | 16+ GB |

### Client Considerations

- Clients should implement appropriate timeouts (recommended: 120s)
- Consider async webhook callbacks for high-latency tolerance
- Monitor queue depth via `/api/queue-status` (if implemented)
