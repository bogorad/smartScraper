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
just test-urls-failed  # Rerun only URLs that failed in the previous URL test run
```

- Reads structured URL records from `testing/urls_for_testing.txt`
- Requires a clean dev server on port `5555`
- Reports PASS/FAIL per URL with summary
- Reports the scrape method for passing URLs; only `curl` and `chrome` are valid
  method values
- Writes failed URL records to `testing/failed_urls.txt` with classification,
  URL, and failure reason
- `just test-urls-failed` reads `testing/failed_urls.txt` and updates it with
  any URLs that still fail
- Required smoke URL failures fail the command. Diagnostic URL failures are
  recorded as classified artifacts without failing the required smoke gate.

Before running URL-based E2E, kill every process currently listening on
`:5555`, restart `just dev`, and verify `http://localhost:5555/health`.
When an agent runs this protocol, `just dev` must run in tmux so the server logs
remain observable during the test run.

URL E2E runs must verify that every response, runtime log, and test artifact
reports only the supported methods: `curl` or `chrome`.
When a URL fails after `curl` and `chrome` attempts, the failure artifact must
preserve the explicit error. CAPTCHA failures should name the detected
unsupported family (`recaptcha`, `turnstile`, or `hcaptcha`) instead of falling
through to a generic XPath failure.

### Secret Handling

Justfile recipes that need secrets run through the standard wrapper:

```bash
scripts/with-secrets.sh -- <command> [args...]
```

This exports secrets as uppercase env vars (e.g., `$SMART_SCRAPER`) before
executing the command. The command scripts read environment variables only; they
do not decrypt `secrets.yaml` themselves.

**CRITICAL**: Secrets are exported into the shell environment for that recipe only - never logged, never committed.

### Test URL Management

Test URLs are stored in `testing/urls_for_testing.txt`:
- One structured record per line:
  - `required|https://example.com/article`
  - `diagnostic|external-paywall|https://example.com/protected`
- Lines starting with `#` are comments
- Empty lines are ignored
- Required URLs should cover stable smoke coverage.
- Diagnostic URLs should cover paywalled, anti-bot, proxy-dependent, or other
  expected external failure classes without making the smoke gate ambiguous.

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
