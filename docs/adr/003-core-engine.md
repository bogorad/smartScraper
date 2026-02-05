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
4. Processes requests **sequentially** (one at a time)

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

### Sequential Execution Model

Scrapes are processed **one at a time** via an in-memory queue. This ensures:

- Only one browser instance runs at any time
- Predictable resource usage (memory, CPU)
- Complete isolation between scrapes
- No race conditions in browser/extension state

**Mechanism:** In-memory queue (`p-queue`) with concurrency of 1.

**Configuration:**
- Concurrency: `1` (sequential execution)
- Queue size limit: `100` (returns error when exceeded)
- Timeout: Request dependent (default 120s)

```typescript
import PQueue from 'p-queue';

export class CoreScraperEngine {
  private static readonly MAX_QUEUE_SIZE = 100;
  private queue = new PQueue({ concurrency: 1 });

  async scrapeUrl(url: string, options?: ScrapeOptions): Promise<ScrapeResult> {
    // Reject if queue is full
    if (this.queue.size >= CoreScraperEngine.MAX_QUEUE_SIZE) {
      return { success: false, errorType: 'CONFIGURATION', error: 'Server overloaded, please retry later' };
    }
    return this.queue.add(() => this._executeScrape(url, options));
  }
  
  private async _executeScrape(url: string, options?: ScrapeOptions): Promise<ScrapeResult> {
    // 1. Launch fresh browser
    // 2. Navigate and extract
    // 3. Close browser (in finally block)
    // 4. Return result
  }
}
```

### Request Flow

```
Client Request
     │
     ▼
┌─────────────┐
│  API Layer  │  POST /api/scrape
└─────────────┘
     │
     ▼
┌─────────────┐
│    Queue    │  p-queue (concurrency: 1, max: 100)
└─────────────┘
     │
     ▼ (waits for previous scrape to complete)
┌─────────────┐
│   Runner    │  Single worker processes queue
└─────────────┘
     │
     ▼
┌─────────────┐
│  Browser    │  Fresh Puppeteer instance per scrape
└─────────────┘
     │
     ▼
┌─────────────┐
│  Response   │  JSON result returned to client
└─────────────┘
```

## Consequences

### Benefits

- **Simplicity**: Single execution path, easy to reason about
- **Predictable**: One browser at a time, no resource contention
- **Isolated**: Complete state isolation between scrapes
- **Reliable**: No race conditions or parallel execution bugs
- **Testable**: Via mock port implementations

### Trade-offs

- **Throughput**: Sequential execution limits requests/minute
- **Latency**: Requests queue up; client may wait 30+ seconds if queue is busy
- **No parallelism**: Cannot utilize multiple CPU cores for scraping

### Client Considerations

- Clients should implement appropriate timeouts (recommended: 120s)
- Consider async webhook callbacks for high-latency tolerance
- Monitor queue depth via `/api/queue-status` (if implemented)

### Future Considerations

If throughput becomes a bottleneck:
- Deploy multiple SmartScraper instances behind a load balancer
- Each instance runs its own sequential queue
- Horizontal scaling preferred over in-process parallelism
