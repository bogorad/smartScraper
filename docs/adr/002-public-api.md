# ADR-002: Public API Contract

- Status: Accepted
- Date: 2025-12-05

## Context

SmartScraper needs a stable, documented public API that consumers can rely on across rebuilds. The API must be simple for common use cases while supporting advanced configuration.

## Decision

### Entry Point

Export from `src/index.ts`:

```typescript
export { scrapeUrl } from './core/engine';
export { getDefaultEngine } from './core/engine';
export { METHODS, OUTPUT_TYPES } from './constants';
```

### scrapeUrl Function

```typescript
async function scrapeUrl(
  targetUrl: string,
  options?: ScrapeOptions
): Promise<ScrapeResult>
```

**Parameters:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `outputType` | `OutputTypeValue` | `CONTENT_ONLY` | Output format |
| `methodHint` | `MethodValue` | - | Suggested method (may be ignored) |
| `proxyDetails` | `{ server: string }` | - | Override global proxy |
| `userAgentString` | `string` | - | Override default UA |
| `timeoutMs` | `number` | - | Soft timeout hint |
| `debugContextId` | `string` | - | Correlate logs/artifacts |

### Constants

```typescript
const METHODS = {
  CURL: 'curl',
  PUPPETEER_STEALTH: 'puppeteer_stealth',
  PUPPETEER_CAPTCHA: 'puppeteer_captcha'
} as const;

const OUTPUT_TYPES = {
  CONTENT_ONLY: 'content_only',
  FULL_HTML: 'full_html',
  METADATA_ONLY: 'metadata_only'
} as const;
```

### ScrapeResult Contract

```typescript
interface ScrapeResult {
  success: boolean;
  method?: MethodValue;
  xpath?: string;
  data?: string | object;
  rawHtmlSnapshotPath?: string;
  // On failure:
  errorType?: 'NETWORK' | 'CAPTCHA' | 'LLM' | 'CONFIGURATION' | 'EXTRACTION' | 'UNKNOWN';
  error?: string;
  details?: any;
}
```

### Error Handling

- `scrapeUrl` resolves (not rejects) for operational failures
- Only rejects on programmer/configuration misuse
- Invalid URLs return `{ success: false, errorType: 'CONFIGURATION' }`

## Consequences

- Stable contract for library consumers
- Function signatures and constants must remain backward compatible
- Internal implementation can change freely as long as contract holds
