# AGENTS.md - test-orchestrator/

## Purpose

Go-based E2E test orchestrator for SmartScraper. Runs tests against real Hono servers with isolated file storage.

---

## Core Philosophy

- **E2E Integration**: Tests run against real Hono servers
- **HTTP Black Box + File White Box**: Test endpoints, verify file state
- **Isolation**: Each worker gets ephemeral `DATA_DIR`
- **No Mocking**: Real server, real Puppeteer

---

## Running Tests

```bash
just test              # 4 parallel workers
just test-full         # Bypass cache
just test-file <pat>   # Single test pattern
just test-clean        # Clean orphans
```

---

## Helper Functions (`e2e/helpers.go`)

| Function | Purpose |
|----------|---------|
| `GetBaseURL(t)` | Worker's server URL |
| `GetDataDir(t)` | Worker's isolated data dir |
| `GetAPIToken(t)` | Worker's API token |
| `NewTestClient(token)` | HTTP client with auth |
| `ReadSites(t, dir)` | Parse sites.jsonc |
| `WriteSites(t, dir, sites)` | Write sites.jsonc |
| `ReadStats(t, dir)` | Parse stats.json |

---

## File Storage (Per Worker)

```
{DATA_DIR}/
├── sites.jsonc    # SiteConfig[]
├── stats.json     # Counters
└── logs/
    └── YYYY-MM-DD.jsonl
```

---

## Required Test Cases

### `/api/scrape`
- Success with valid URL
- 401 without auth
- 400 for missing/invalid URL
- Stats increment on scrape

### `/health`
- Returns 200 (no auth required)

### `/dashboard/*`
- Auth required (redirect to login)
- HTML renders with data
- CRUD operations persist to files

---

## Common Pitfalls

1. **Async writes**: Add small delay before reading files after POST
2. **Wrong paths**: Use `GetDataDir(t)`, not hardcoded paths
3. **Status checks**: Always check `resp.StatusCode` before parsing body
4. **Test isolation**: Each test seeds its own data, no shared state

---

## Debugging

```bash
# View worker logs
cat test-orchestrator/logs/worker-0.log

# Check ephemeral data
ls /tmp/smartscraper-test-0-*/

# Run single test
just test-file TestApiScrape
```
