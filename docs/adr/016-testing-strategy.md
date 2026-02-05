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

| Level | Location | Runner | Frequency |
|-------|----------|--------|-----------|
| Unit | `src/**/*.test.ts` (colocated) | Vitest | Every commit |
| Integration | `src/**/*.test.ts` | Vitest | Every commit |
| E2E (Go) | `test-orchestrator/e2e/*.go` | Go test | CI/manual |
| E2E (manual) | `testing/run-e2e.sh` | Bash + curl | Manual |

### Unit & Integration Tests

- **Colocated** with source files (`foo.ts` -> `foo.test.ts`)
- Run via `npm test` using Vitest
- Mock external dependencies (browser, LLM, captcha services)
- Must pass before merge

### End-to-End Tests

#### Go-based E2E (`test-orchestrator/`)

Full test framework with:
- Worker pool management
- Health checks
- Parallel test execution
- Detailed reporting

Run via:
```bash
cd test-orchestrator && go test ./e2e/...
```

#### Manual E2E (`testing/run-e2e.sh`)

Lightweight bash script for quick validation:
- Reads URLs from `testing/urls_for_testing.txt`
- Calls the HTTP API with proper auth
- Reports success/failure per URL
- **Never logs or stores tokens** - uses inline `$(sops -d ...)` substitution

Run via:
```bash
./testing/run-e2e.sh
```

### Secret Handling

**CRITICAL: Tokens must be transient only**

```bash
# CORRECT - token never stored in variable or logs
curl -H "Authorization: Bearer $(sops -d secrets.yaml | yq '.smart_scraper')" ...

# WRONG - token stored in variable (can leak via set -x, logs, etc.)
TOKEN=$(sops -d secrets.yaml | yq '.smart_scraper')
curl -H "Authorization: Bearer $TOKEN" ...
```

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
- Realistic E2E validation
- Secure token handling

### Negative

- E2E tests can be flaky (network, site changes)
- Manual E2E requires server to be running
- Multiple test frameworks (Vitest, Go, bash)

## Related

- ADR-003: Core Engine (sequential execution affects E2E timing)
- ADR-014: Auth Security Strategy (token handling)
