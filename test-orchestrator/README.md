# Test Orchestrator

A high-performance, parallel test execution system for the SmartScraper application, built in Go.

## Overview

The Test Orchestrator provides isolated, parallel test execution for end-to-end (e2e) tests by:
- **Spinning up multiple Hono dev servers** (1-8 workers) on different ports
- **Creating ephemeral data directories** for each worker (isolated `DATA_DIR`)
- **Running tests in parallel** across workers with intelligent queuing
- **Managing full lifecycle** from setup to teardown with automatic cleanup

### Why This Exists

Traditional test runners face several challenges:
- **File pollution**: Tests modify shared `sites.jsonc`, `stats.json`, causing flaky tests
- **Sequential execution**: Tests run one-by-one, taking too long for the full suite
- **Port conflicts**: Multiple test processes can't share the same dev server
- **Browser resource contention**: Puppeteer instances conflict when running in parallel
- **Manual cleanup**: Developers need to manually reset file-based state

This orchestrator solves all these problems by providing **true isolation** and **massive parallelization**.

---

## Architecture

### Key Differences from Reference Implementation

| Aspect | Artwalls (Reference) | SmartScraper (This) |
|--------|---------------------|---------------------|
| Database | PostgreSQL (Neon branching) | File-based (JSONC, JSON, JSONL) |
| Dev Server | Wrangler (Cloudflare) | Hono (Node.js) |
| Test Runner | Go tests | Go tests calling Vitest |
| Isolation | Ephemeral DB branches | Ephemeral temp directories |
| Browser | N/A | Puppeteer (per-worker instances) |

### High-Level Flow

```
+---------------------------------------------------------------------+
|                     Test Orchestrator                                |
|                                                                      |
|  1. Load secrets (sops -d secrets.yaml)                              |
|  2. Discover test functions (grep "func Test" in e2e/*.go)           |
|  3. Create ephemeral DATA_DIR for each worker                        |
|  4. Start Hono server instances (one per worker, ports 9000-9007)    |
|  5. Wait for /health endpoints to respond                            |
|  6. Queue all tests                                                  |
|  7. Execute tests in parallel                                        |
|  8. Cleanup temp directories and kill processes                      |
|  9. Report results                                                   |
+---------------------------------------------------------------------+
```

### Component Architecture

```
test-orchestrator/
+-- main.go                    # CLI entry point
+-- orchestrator.go            # Main orchestration logic
+-- workerpool.go              # Worker pool management
+-- worker.go                  # Individual worker lifecycle
+-- health.go                  # HTTP health check poller
+-- tmux.go                    # Tmux session management
+-- isolation.go               # Ephemeral DATA_DIR management
+-- secrets.go                 # SOPS secret decryption
+-- cache.go                   # Test result caching
+-- errors.go                  # Sentinel errors
+-- e2e/                       # Test suite
    +-- helpers.go             # Shared test utilities
    +-- api_test.go            # API endpoint tests
    +-- dashboard_test.go      # Dashboard tests
    +-- scrape_test.go         # Scraping integration tests
    +-- ...
```

---

## Worker Isolation Strategy

### File-Based Isolation (Replaces Neon Branching)

Each worker gets an isolated environment via ephemeral directories:

```go
// isolation.go
type IsolatedEnv struct {
    ID           int
    DataDir      string  // /tmp/smartscraper-test-{workerID}-{timestamp}/
    SitesFile    string  // {DataDir}/sites.jsonc
    StatsFile    string  // {DataDir}/stats.json
    LogsDir      string  // {DataDir}/logs/
    Port         int     // 9000 + workerID
}

func CreateIsolatedEnv(workerID int) (*IsolatedEnv, error) {
    baseDir := fmt.Sprintf("/tmp/smartscraper-test-%d-%d", workerID, time.Now().Unix())
    
    // Create directory structure
    os.MkdirAll(filepath.Join(baseDir, "logs"), 0755)
    
    // Seed with empty/default files
    os.WriteFile(filepath.Join(baseDir, "sites.jsonc"), []byte("[]"), 0644)
    os.WriteFile(filepath.Join(baseDir, "stats.json"), []byte("{}"), 0644)
    
    return &IsolatedEnv{
        ID:        workerID,
        DataDir:   baseDir,
        SitesFile: filepath.Join(baseDir, "sites.jsonc"),
        StatsFile: filepath.Join(baseDir, "stats.json"),
        LogsDir:   filepath.Join(baseDir, "logs"),
        Port:      9000 + workerID,
    }, nil
}

func (e *IsolatedEnv) Cleanup() error {
    return os.RemoveAll(e.DataDir)
}
```

### Environment Variables Per Worker

Each Hono server instance receives isolated configuration:

```bash
# Worker 0
PORT=9000
DATA_DIR=/tmp/smartscraper-test-0-1738765432/
API_TOKEN=test-token-0
EXECUTABLE_PATH=/nix/store/.../chromium  # Shared Chromium binary

# Worker 1
PORT=9001
DATA_DIR=/tmp/smartscraper-test-1-1738765433/
API_TOKEN=test-token-1
EXECUTABLE_PATH=/nix/store/.../chromium
```

---

## Worker Pool Lifecycle

```
+---------------------------------------------------------------------+
|                    WORKER POOL STARTUP                               |
+---------------------------------------------------------------------+

[1] Start Tmux Sessions (Parallel)
    +----------+  +----------+  +----------+  +----------+
    | Worker 0 |  | Worker 1 |  | Worker 2 |  | Worker 3 |
    | tmux new |  | tmux new |  | tmux new |  | tmux new |
    +----------+  +----------+  +----------+  +----------+
         |              |              |              |
         +--------------------------------------------+
                           |
                           v
[2] Create Ephemeral Data Directories (Parallel)
    +-----------------------------------------------------+
    | mkdir /tmp/smartscraper-test-0-{ts}/                |
    | mkdir /tmp/smartscraper-test-0-{ts}/logs/           |
    | write sites.jsonc, stats.json                       |
    +-----------------------------------------------------+
    (repeat for all workers)
                           |
                           v
[3] Start Hono Instances (Parallel via tmux)
    +------------------------------------------------------+
    | tmux send-keys "DATA_DIR=... PORT=9000 npm run dev"  |
    | tmux send-keys "DATA_DIR=... PORT=9001 npm run dev"  |
    | ...                                                  |
    +------------------------------------------------------+
                           |
                           v
[4] Health Check Loop (Poll every 200ms)
    +---------------------------------------------+
    | for each worker:                            |
    |   GET http://127.0.0.1:{port}/health        |
    |   if status == 200: mark healthy            |
    |                                             |
    | if all healthy: proceed to tests            |
    | if timeout (60s): abort                     |
    +---------------------------------------------+
                           |
                           v
[5] Workers Ready - Add to Available Pool
    +--------------------------------------------+
    | availableWorkers <- [w0, w1, w2, w3]       |
    +--------------------------------------------+
```

---

## Test Execution Flow

```
+---------------------------------------------------------------------+
|                    TEST EXECUTION                                    |
+---------------------------------------------------------------------+

[1] Test Queue (Buffered Channel)
    +---------------------------------------------+
    | queue <- TestApiScrape                      |
    | queue <- TestDashboardSites                 |
    | queue <- TestKnownSitesStorage              |
    | ...                                         |
    | close(queue)  // Signal no more work        |
    +---------------------------------------------+
                           |
                           v
[2] Goroutine Workers (N concurrent)
    +--------------+  +--------------+  +--------------+
    | Goroutine 0  |  | Goroutine 1  |  | Goroutine 2  |
    |              |  |              |  |              |
    | for test :=  |  | for test :=  |  | for test :=  |
    |  range queue |  |  range queue |  |  range queue |
    +--------------+  +--------------+  +--------------+
         |                 |                 |
         v                 v                 v
    Acquire Worker    Acquire Worker    Acquire Worker
    from pool         from pool         from pool
         |                 |                 |
         v                 v                 v
    +-------------+  +-------------+  +-------------+
    | Worker 0    |  | Worker 1    |  | Worker 2    |
    | Port: 9000  |  | Port: 9001  |  | Port: 9002  |
    | DataDir: /  |  | DataDir: /  |  | DataDir: /  |
    | tmp/test-0  |  | tmp/test-1  |  | tmp/test-2  |
    +-------------+  +-------------+  +-------------+
         |                 |                 |
         v                 v                 v
    Run Test          Run Test          Run Test
    +---------------------------------------------+
    | go test ./e2e -run ^TestName$               |
    |   -v                                        |
    | env:                                        |
    |   TEST_BASE_URL=http://127.0.0.1:{port}     |
    |   DATA_DIR=/tmp/smartscraper-test-{id}/     |
    |   API_TOKEN=...                             |
    +---------------------------------------------+
         |                 |                 |
         v                 v                 v
    Release Worker    Release Worker    Release Worker
    back to pool      back to pool      back to pool
```

---

## Quick Start

```bash
# Run all tests with 4 parallel workers
just test

# Run specific test by name
just test-file TestApiScrape

# Run with verbose debugging
go run . --workers 4 -v

# Run full suite (bypass cache)
just test-full

# Clean up orphan processes and cache
just test-clean
```

---

## Configuration

### Command-Line Flags

```bash
go run . [flags]
```

| Flag | Shorthand | Default | Description |
|------|-----------|---------|-------------|
| `--workers` | `-w` | 1 | Number of parallel workers (1-8) |
| `--file` | `-f` | "" | Filter tests by name pattern |
| `--full` | | false | Force full run (bypass cache) |
| `--timeout` | | 60s | Health check timeout |
| `--verbose` | `-v` | false | Verbose debug output |

### Environment Variables

Set by orchestrator automatically for each worker:

| Variable | Description | Example |
|----------|-------------|---------|
| `TEST_BASE_URL` | Worker URL | `http://127.0.0.1:9000` |
| `DATA_DIR` | Ephemeral data directory | `/tmp/smartscraper-test-0-1738765432/` |
| `API_TOKEN` | Test API token | `test-token-{workerID}` |
| `OPENROUTER_API_KEY` | LLM API key (from secrets) | `sk-or-...` |
| `TWOCAPTCHA_API_KEY` | Captcha API key (from secrets) | `...` |

---

## Smart Test Caching

The orchestrator implements intelligent test result caching to skip unchanged passing tests.

### How It Works

1. **File Hash Tracking**: Each test file's MD5 hash is stored in `.test-cache.json`
2. **Result Recording**: After each test, the result (pass/fail) is recorded with the file hash
3. **Cache Lookup**: On subsequent runs, tests are skipped if:
   - The test file hash matches the cached hash (file unchanged)
   - The previous run passed
4. **Helpers Tracking**: Changes to `helpers.go` invalidate ALL cached results

### Cache Invalidation

Tests will re-run when:
- **File changed**: Test file content differs from cached hash
- **Previously failed**: Last run did not pass
- **Not in cache**: New test or cache cleared
- **Helpers changed**: `helpers.go` was modified (invalidates all tests)
- **Force full**: `--full` flag bypasses cache entirely

### Cache File Location

```
.test-cache.json  (project root)
```

**Example cache file:**
```json
{
  "entries": {
    "test-orchestrator/e2e/api_test.go": {
      "hash": "a1b2c3d4e5f6...",
      "lastRun": 1706000000000,
      "passed": true
    }
  },
  "helpersHash": "f6e5d4c3b2a1..."
}
```

---

## Test Structure

### Go Test Files Calling Vitest (Hybrid Approach)

Tests are written in Go but can invoke Vitest for TypeScript test suites:

```go
package e2e

import (
    "os/exec"
    "testing"
)

func TestApiScrape(t *testing.T) {
    baseURL := GetBaseURL(t)
    apiToken := GetAPIToken(t)
    client := NewTestClient(apiToken)
    
    // HTTP-based test
    resp, err := client.Post(baseURL+"/api/scrape", map[string]interface{}{
        "url": "https://example.com",
    })
    if err != nil {
        t.Fatalf("Request failed: %v", err)
    }
    
    if resp.StatusCode != 200 {
        t.Errorf("Expected 200, got %d", resp.StatusCode)
    }
    
    // Verify response structure
    var result ScrapeResult
    if err := json.Unmarshal(resp.Body, &result); err != nil {
        t.Fatalf("Failed to parse response: %v", err)
    }
    
    if !result.Success {
        t.Errorf("Expected success=true, got %v", result.Success)
    }
}

// Or invoke existing Vitest tests
func TestVitestSuite(t *testing.T) {
    baseURL := GetBaseURL(t)
    dataDir := GetDataDir(t)
    
    cmd := exec.Command("npx", "vitest", "run", "--reporter=verbose")
    cmd.Env = append(os.Environ(),
        "TEST_BASE_URL="+baseURL,
        "DATA_DIR="+dataDir,
    )
    
    output, err := cmd.CombinedOutput()
    if err != nil {
        t.Fatalf("Vitest failed: %v\n%s", err, output)
    }
}
```

### Helper Functions (e2e/helpers.go)

```go
package e2e

import (
    "net/http"
    "net/http/cookiejar"
    "os"
    "testing"
)

// GetBaseURL returns TEST_BASE_URL or fails the test
func GetBaseURL(t *testing.T) string {
    url := os.Getenv("TEST_BASE_URL")
    if url == "" {
        t.Fatal("TEST_BASE_URL environment variable not set")
    }
    return url
}

// GetDataDir returns DATA_DIR or fails the test
func GetDataDir(t *testing.T) string {
    dir := os.Getenv("DATA_DIR")
    if dir == "" {
        t.Fatal("DATA_DIR environment variable not set")
    }
    return dir
}

// GetAPIToken returns API_TOKEN or fails the test
func GetAPIToken(t *testing.T) string {
    token := os.Getenv("API_TOKEN")
    if token == "" {
        t.Fatal("API_TOKEN environment variable not set")
    }
    return token
}

// NewTestClient creates an HTTP client with auth header
func NewTestClient(apiToken string) *TestClient {
    jar, _ := cookiejar.New(nil)
    return &TestClient{
        http: &http.Client{Jar: jar},
        token: apiToken,
    }
}

type TestClient struct {
    http  *http.Client
    token string
}

func (c *TestClient) Get(url string) (*http.Response, error) {
    req, _ := http.NewRequest("GET", url, nil)
    req.Header.Set("Authorization", "Bearer "+c.token)
    return c.http.Do(req)
}

func (c *TestClient) Post(url string, body interface{}) (*http.Response, error) {
    // ... implementation
}
```

---

## Cleanup Strategy

```
+---------------------------------------------------------------------+
|                    CLEANUP PHASE                                     |
+---------------------------------------------------------------------+

[1] Kill Tmux Sessions (Parallel)
    +--------------------------------------------+
    | tmux kill-session -t test-worker-0         |
    | tmux kill-session -t test-worker-1         |
    | ...                                        |
    +--------------------------------------------+
                      |
                      v
[2] Delete Ephemeral Data Directories (Parallel)
    +--------------------------------------------+
    | rm -rf /tmp/smartscraper-test-0-*          |
    | rm -rf /tmp/smartscraper-test-1-*          |
    | ...                                        |
    +--------------------------------------------+
                      |
                      v
[3] Force Kill Any Remaining Processes
    +--------------------------------------------+
    | for port in 9000..9007:                    |
    |   lsof -ti:$port | xargs kill -9           |
    +--------------------------------------------+
                      |
                      v
                  Complete
```

---

## Debugging

### Check Worker Logs

```bash
# Attach to worker tmux session
tmux -S /tmp/claude-tmux-sockets/test-worker-0.sock attach -t test-worker-0

# Capture logs from worker
tmux -S /tmp/claude-tmux-sockets/test-worker-0.sock capture-pane -p -S -100

# Check Hono server logs
cat test-orchestrator/logs/worker-0-hono.log
```

### Manual Health Check

```bash
curl http://127.0.0.1:9000/health
curl http://127.0.0.1:9001/health
```

### Inspect Ephemeral Data

```bash
# Find worker's data directory
ls /tmp/smartscraper-test-*/

# Check sites.jsonc state
cat /tmp/smartscraper-test-0-*/sites.jsonc
```

---

## Performance

### Benchmarks (Estimated)

| Workers | Total Tests | Duration | Speedup |
|---------|-------------|----------|---------|
| 1 | 20 | ~60s | 1x |
| 4 | 20 | ~20s | 3x |
| 8 | 20 | ~12s | 5x |

**Note:** Speedup is sublinear due to:
- Startup overhead (Hono server initialization ~3-5s per worker)
- Puppeteer resource contention (CPU/memory for headless Chrome)
- Test duration variance

### Resource Usage

**Per Worker:**
- **Memory:** ~100-150 MB (Hono + Node.js)
- **Memory (with Puppeteer):** ~200-400 MB additional per browser instance
- **CPU:** 10-15% during test execution
- **Port:** 1 (9000-9007)
- **Disk:** ~1 MB ephemeral data

---

## Integration with Just Commands

Add to `.justfile`:

```just
# Run tests with parallel workers
test:
    cd test-orchestrator && go run . --workers 4

# Run specific test
test-file pattern:
    cd test-orchestrator && go run . --workers 1 --file {{pattern}}

# Force full test run (bypass cache)
test-full:
    cd test-orchestrator && go run . --workers 4 --full

# Clean up orphan processes and cache
test-clean:
    rm -f .test-cache.json
    rm -rf test-orchestrator/logs/*
    rm -rf /tmp/smartscraper-test-*
    for port in 9000 9001 9002 9003 9004 9005 9006 9007; do \
        lsof -ti:$port | xargs -r kill -9 2>/dev/null || true; \
    done
```

---

## Future Improvements

### Planned Features

- [x] **Test result caching** (skip passing tests on re-run)
- [ ] **Browser pool sharing** (reuse Puppeteer instances across tests)
- [ ] **Worker reuse** (keep workers alive between test batches)
- [ ] **HTML test report** (generate visual report with timing/failures)
- [ ] **Source dependency tracking** (invalidate tests when src/ files change)
- [ ] **CI/CD integration** (GitHub Actions workflow)

### Optimization Ideas

- Reduce health check timeout (workers usually ready in 3-5s)
- Implement Puppeteer connection pooling per worker
- Cache npm dependencies in shared location
- Pre-warm workers during test discovery phase

---

## Related Documentation

- **Project AGENTS.md**: `/home/chuck/git/smartScraper/AGENTS.md`
- **Source AGENTS.md**: `/home/chuck/git/smartScraper/src/AGENTS.md`
- **ADRs**: `/home/chuck/git/smartScraper/docs/adr/`
- **Configuration**: `/home/chuck/git/smartScraper/docs/CONFIGURATION.md`
