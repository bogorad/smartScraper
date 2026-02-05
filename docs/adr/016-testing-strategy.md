# ADR-016: Testing Strategy

- Status: Accepted
- Date: 2026-02-05

## Context

SmartScraper requires multiple testing levels:

1. **Unit tests** - Fast, isolated tests for individual functions
2. **Integration tests** - Test adapter implementations with mocked external services
3. **End-to-end tests** - Full scrape tests against real websites

The challenge is balancing test coverage with:
- Execution speed (unit tests should be fast)
- Reliability (E2E tests against real sites can be flaky)
- Secret management (API tokens must never be logged or committed)

## Decision

### Test Levels

| Level | Command | Location | Frequency |
|-------|---------|----------|-----------|
| Unit | `npm test` | `src/**/*.test.ts` (colocated) | Every commit |
| Integration | `npm test` | `src/**/*.test.ts` | Every commit |
| E2E (Go) | `just test` | `test-orchestrator/e2e/*.go` | CI/manual |
| E2E (URLs) | `just test-urls` | `testing/urls_for_testing.txt` | Manual |

### Unit & Integration Tests

- **Colocated** with source files (`foo.ts` -> `foo.test.ts`)
- Run via `npm test` using Vitest
- Mock external dependencies (browser, LLM, captcha services)
- Must pass before merge

### End-to-End Tests

#### Go-based E2E (`just test`)

Full test framework with worker pool management:

```bash
just test           # Run with 4 parallel workers
just test-full      # Bypass cache, full run
just test-file api  # Run specific test pattern
just test-clean     # Clean orphan processes
```

#### URL-based E2E (`just test-urls`)

Quick validation against real URLs:

```bash
just test-urls      # Test all URLs in testing/urls_for_testing.txt
```

- Reads URLs from `testing/urls_for_testing.txt`
- Requires server running (`just dev`)
- Reports PASS/FAIL per URL with summary

### Secret Handling

All justfile recipes use the standard pattern:

```bash
eval "$(sops decrypt secrets.yaml --output-type=json | jq -r 'to_entries | .[] | "export " + (.key | ascii_upcase) + "=" + (.value | @sh)')"
```

This exports secrets as uppercase env vars (e.g., `$SMART_SCRAPER`).

**CRITICAL**: Secrets are exported into the shell environment for that recipe only - never logged, never committed.

### Test URL Management

Test URLs are stored in `testing/urls_for_testing.txt`:
- One URL per line
- Lines starting with `#` are comments
- Empty lines are ignored
- URLs should cover diverse sites (paywalled, anti-bot, standard)

## Consequences

### Positive

- Clear separation of test levels
- Fast feedback from unit tests
- Consistent secret handling via justfile
- All test commands discoverable via `just --list`

### Negative

- E2E tests can be flaky (network, site changes)
- E2E requires server to be running
- Multiple test frameworks (Vitest, Go)

## Related

- ADR-003: Core Engine (sequential execution affects E2E timing)
- ADR-014: Auth Security Strategy (token handling)
