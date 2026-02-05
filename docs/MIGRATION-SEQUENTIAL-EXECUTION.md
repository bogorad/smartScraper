# Migration Plan: Sequential Execution Model

## Overview

This document outlines the code changes required to align the implementation with the updated ADR-001 and ADR-003 architecture: **sequential scrape execution with one browser instance at a time**.

## Current State (Incorrect)

- `CoreScraperEngine` uses `PQueue({ concurrency: 5 })` - allows 5 parallel scrapes
- Dashboard shows "X of 5 Workers" implying parallel execution
- `getMaxWorkers()` returns hardcoded `5`

## Target State

- `CoreScraperEngine` uses `PQueue({ concurrency: 1 })` - sequential execution
- Dashboard shows current scrape status (0 or 1 active)
- Remove "workers" terminology; use "runner" or "scrape status"

---

## Code Changes Required

### 1. `src/core/engine.ts`

**Priority: HIGH**

| Line | Current | Change To |
|------|---------|-----------|
| 23 | `new PQueue({ concurrency: 5 })` | `new PQueue({ concurrency: 1 })` |
| 41-43 | `getMaxWorkers(): number { return 5; }` | `getMaxWorkers(): number { return 1; }` |

**Optional cleanup:**
- Rename `getMaxWorkers()` to `getMaxConcurrency()` or remove entirely
- Rename `getActiveWorkers()` to `isRunning()` returning boolean
- Simplify `activeScrapes` Map to single `activeScrapeUrl: string | null`

### 2. Dashboard UI Updates

**Priority: MEDIUM**

Files affected:
- `src/routes/dashboard/index.tsx`
- `src/routes/dashboard/events.ts` (SSE)
- `src/components/` (worker status components)

Changes:
- Replace "X of 5 Workers" with "Idle" / "Scraping: {url}"
- Simplify SSE events - no need for array of active URLs
- Update HTML fragments sent via SSE

### 3. Test Updates

**Priority: MEDIUM**

Files affected:
- `test-orchestrator/e2e/helpers.go` - already updated timeout to 45s
- Any tests that assume parallel execution

### 4. Remove Timing Debug Code

**Priority: LOW**

File: `src/adapters/puppeteer-browser.ts`

Remove the `[TIMING]` instrumentation added during debugging (lines added for this investigation).

---

## Implementation Order

1. **Phase 1: Core Change** (5 min)
   - Change concurrency from 5 to 1 in `engine.ts`
   - Change `getMaxWorkers()` return value to 1
   
2. **Phase 2: Dashboard Updates** (30 min)
   - Update worker status display
   - Simplify SSE events
   
3. **Phase 3: Cleanup** (15 min)
   - Remove debug timing code
   - Run full test suite
   - Bump version

---

## Testing

After changes:
```bash
npm run typecheck && npm run build
just test
```

## Rollback

If issues arise, revert concurrency to 5. The architecture change is isolated to the queue configuration.
