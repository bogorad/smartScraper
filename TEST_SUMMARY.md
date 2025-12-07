# Test Summary

## Test Coverage

This project has comprehensive test coverage using Vitest:

### Test Files (12 total)
- **Utilities** (6 test files)
  - `src/utils/date.test.ts` - Date formatting and utility functions
  - `src/utils/url.test.ts` - URL parsing and validation
  - `src/utils/dom.test.ts` - DOM manipulation and snippet extraction
  - `src/utils/mutex.test.ts` - Mutex locking mechanism
  - `src/utils/html-cleaner.test.ts` - HTML sanitization and markdown conversion
  - `src/utils/xpath-parser.test.ts` - XPath response parsing

- **Core Engine** (2 test files)
  - `src/core/scoring.test.ts` - Element scoring algorithms
  - `src/core/engine.test.ts` - Main scraper engine orchestration (with mocked ports)

- **Adapters** (2 test files)
  - `src/adapters/openrouter-llm.test.ts` - LLM integration (mocked axios)
  - `src/adapters/twocaptcha.test.ts` - CAPTCHA solving (mocked axios)

- **Routes & Middleware** (2 test files)
  - `src/routes/api/scrape.test.ts` - Scrape API endpoint tests
  - `src/middleware/auth.test.ts` - Authentication middleware tests

### Total Tests: 176

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage

# Run type checking
npm run typecheck
```

## CI/CD

Tests and type checking are automatically run in GitHub Actions on every push and pull request.

See `.github/workflows/ci.yml` for the CI configuration.

## Test Structure

All tests follow a consistent pattern:
- Unit tests for pure functions
- Mocked dependencies for adapters (axios, fs, etc.)
- Mocked ports for core engine tests
- Integration tests for Hono routes

## Key Testing Practices

1. **Isolation**: Each test is independent and doesn't rely on external services
2. **Mocking**: External dependencies are mocked using Vitest's `vi.mock()`
3. **Coverage**: Comprehensive coverage of happy paths, error cases, and edge cases
4. **Type Safety**: All tests pass TypeScript's strict type checking
