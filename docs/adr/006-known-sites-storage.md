# ADR-006: Known Sites Self-Learning Storage

- Status: Accepted
- Date: 2025-12-05

## Context

Different domains require different scraping strategies. Discovered XPaths and successful methods should be persisted to avoid repeated slow discovery on subsequent visits.

## Decision

### SiteConfig Model

```typescript
interface SiteConfig {
  domainPattern: string;
  xpathMainContent: string;
  lastSuccessfulScrapeTimestamp?: string;  // ISO format
  failureCountSinceLastSuccess: number;
  discoveredByLlm?: boolean;
  siteSpecificHeaders?: Record<string, string>;
  siteCleanupClasses?: string[];
  userAgent?: string;  // Optional per-site UA override
}
```

### KnownSitesPort Interface

```typescript
interface KnownSitesPort {
  getConfig(domain: string): Promise<SiteConfig | undefined>;
  saveConfig(config: SiteConfig): Promise<void>;
  incrementFailure(domain: string): Promise<void>;
  markSuccess(domain: string): Promise<void>;
  deleteConfig(domain: string): Promise<void>;
}
```

### Storage Implementation

- Persist to JSON file (path configurable via settings)
- Lookup by normalized base domain
- Concurrency-safe writes (locking or last-write-wins)

### Failure Handling

- `incrementFailure()` called on extraction failures
- After 2+ consecutive failures: trigger rediscovery
- `markSuccess()` resets failure counter

### Persisted on Success

- `xpathMainContent`
- `lastSuccessfulScrapeTimestamp`
- Reset `failureCountSinceLastSuccess` to 0

## Consequences

- Faster subsequent scrapes for known domains
- Adaptive behavior that improves over time
- Requires schema evolution strategy for config changes
- Must handle corrupt/invalid configs gracefully
