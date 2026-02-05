# AI Agent Test Protocol: SmartScraper Test Orchestrator

**Directive:** You are the Test Quality Guardian. The Go test orchestrator runs E2E tests against real Hono server instances with isolated file-based storage. Your mission is to ensure all tests are reliable, fast, and thoroughly validated.

## 0. Context Loading

**Before writing or fixing tests:**

1. **Read Root Context:** Check `/home/chuck/git/smartScraper/AGENTS.md` for project conventions
2. **Read Source Context:** Check `/home/chuck/git/smartScraper/src/AGENTS.md` for implementation details
3. **Read Test Orchestrator Docs:** Review `README.md` in this directory for orchestrator architecture
4. **Read ADRs:** Consult `/home/chuck/git/smartScraper/docs/adr/` for architectural decisions
5. **Verify Endpoints:** Check route handlers in `src/routes/` to ensure endpoints being tested exist

---

## 1. Core Testing Philosophy

- **E2E Integration Tests:** Tests run against real Hono servers with isolated file storage
- **HTTP Black Box + File White Box:** Test HTTP endpoints but verify file state changes
- **Isolation First:** Each test gets its own ephemeral `DATA_DIR` with fresh files
- **No Mocking in E2E:** Test against actual Hono server, actual Puppeteer (when needed)
- **Coverage is Non-Negotiable:** Every endpoint needs happy path + error cases

---

## 2. SmartScraper-Specific Considerations

### Architecture Alignment

SmartScraper uses Hexagonal Architecture (Ports & Adapters). Tests should:

- Test through the HTTP API (routes layer)
- Verify state via file inspection (adapters layer)
- NOT mock ports for E2E tests (save mocking for unit tests)

### Key Components to Test

| Component | Location | Test Focus |
|-----------|----------|------------|
| Scrape API | `src/routes/api/scrape.ts` | Request/response contract, error handling |
| Dashboard | `src/routes/dashboard/*.tsx` | HTML rendering, HTMX interactions |
| Known Sites | `src/adapters/fs-known-sites.ts` | JSONC persistence, failure tracking |
| Stats | `src/services/stats-storage.ts` | Counter increments, daily reset |
| Auth | `src/middleware/auth.ts` | Token validation, session cookies |
| Health | `src/index.ts` | `/health` endpoint always returns 200 |

### File Storage Locations (Per Worker)

Each worker's `DATA_DIR` contains:

```
{DATA_DIR}/
+-- sites.jsonc      # SiteConfig[] - known site configurations
+-- stats.json       # { scrapeTotal, failTotal, todayDate, ... }
+-- logs/
    +-- YYYY-MM-DD.jsonl  # Daily scrape logs
```

---

## 3. Test Structure

### Standard Test File Structure

```go
package e2e

import (
    "encoding/json"
    "net/http"
    "os"
    "path/filepath"
    "testing"
)

func TestApiScrapeSuccess(t *testing.T) {
    // 1. Get shared resources (provided by orchestrator)
    baseURL := GetBaseURL(t)     // http://127.0.0.1:9000
    dataDir := GetDataDir(t)     // /tmp/smartscraper-test-0-.../
    apiToken := GetAPIToken(t)   // test-token-0
    client := NewTestClient(apiToken)

    // 2. Setup test data (seed files if needed)
    sitesFile := filepath.Join(dataDir, "sites.jsonc")
    seedData := `[{"domainPattern":"example.com","xpathMainContent":"//article"}]`
    os.WriteFile(sitesFile, []byte(seedData), 0644)

    // 3. Execute HTTP request
    resp, err := client.Post(baseURL+"/api/scrape", map[string]interface{}{
        "url":        "https://example.com/page",
        "outputType": "content_only",
    })
    if err != nil {
        t.Fatalf("Request failed: %v", err)
    }
    defer resp.Body.Close()

    // 4. Assert HTTP response
    if resp.StatusCode != 200 {
        t.Errorf("Expected 200, got %d", resp.StatusCode)
    }

    // 5. Parse response
    var result ScrapeResult
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        t.Fatalf("Failed to parse response: %v", err)
    }

    if !result.Success {
        t.Errorf("Expected success=true, got %v (error: %s)", result.Success, result.Error)
    }

    // 6. Assert file state changed (CRITICAL for stateful operations)
    statsFile := filepath.Join(dataDir, "stats.json")
    statsData, _ := os.ReadFile(statsFile)
    var stats Stats
    json.Unmarshal(statsData, &stats)

    if stats.ScrapeTotal < 1 {
        t.Errorf("Expected scrapeTotal >= 1, got %d", stats.ScrapeTotal)
    }
}
```

---

## 4. Helper Functions Reference

All tests have access to helper functions in `e2e/helpers.go`:

### Environment Helpers

```go
// GetBaseURL returns TEST_BASE_URL (e.g., http://127.0.0.1:9000)
baseURL := GetBaseURL(t)

// GetDataDir returns DATA_DIR (e.g., /tmp/smartscraper-test-0-...)
dataDir := GetDataDir(t)

// GetAPIToken returns API_TOKEN
apiToken := GetAPIToken(t)

// NewTestClient returns HTTP client with auth header
client := NewTestClient(apiToken)
```

### File Helpers

```go
// ReadSites reads and parses sites.jsonc from worker's DATA_DIR
sites := ReadSites(t, dataDir)

// WriteSites writes sites to worker's DATA_DIR
WriteSites(t, dataDir, []SiteConfig{...})

// ReadStats reads and parses stats.json
stats := ReadStats(t, dataDir)

// ReadLogs reads today's log file
logs := ReadLogs(t, dataDir)
```

### HTTP Utilities

```go
// Client with auth
client := NewTestClient(apiToken)

// GET with auth header
resp, err := client.Get(baseURL + "/dashboard/sites")

// POST JSON with auth header
resp, err := client.PostJSON(baseURL + "/api/scrape", map[string]interface{}{
    "url": "https://example.com",
})

// POST form with auth (for dashboard)
resp, err := client.PostForm(baseURL + "/dashboard/sites/example.com", url.Values{
    "xpathMainContent": {"//article"},
})
```

---

## 5. Common Testing Patterns

### Pattern 1: Testing API Endpoints

```go
func TestApiScrapeValidation(t *testing.T) {
    baseURL := GetBaseURL(t)
    client := NewTestClient(GetAPIToken(t))

    // Missing URL should fail validation
    resp, _ := client.PostJSON(baseURL+"/api/scrape", map[string]interface{}{
        "outputType": "content_only",
        // "url" is missing
    })

    if resp.StatusCode != 400 {
        t.Errorf("Expected 400 for missing URL, got %d", resp.StatusCode)
    }

    var result map[string]interface{}
    json.NewDecoder(resp.Body).Decode(&result)

    if result["success"] != false {
        t.Error("Expected success=false for validation error")
    }
}
```

### Pattern 2: Testing Authentication

```go
func TestApiRequiresAuth(t *testing.T) {
    baseURL := GetBaseURL(t)

    // No auth header
    req, _ := http.NewRequest("POST", baseURL+"/api/scrape", nil)
    resp, _ := http.DefaultClient.Do(req)

    if resp.StatusCode != 401 {
        t.Errorf("Expected 401 without auth, got %d", resp.StatusCode)
    }
}

func TestApiAcceptsValidToken(t *testing.T) {
    baseURL := GetBaseURL(t)
    client := NewTestClient(GetAPIToken(t))

    resp, _ := client.Get(baseURL + "/health")

    if resp.StatusCode != 200 {
        t.Errorf("Expected 200 with valid token, got %d", resp.StatusCode)
    }
}
```

### Pattern 3: Testing File State Changes

```go
func TestKnownSitesPersistence(t *testing.T) {
    baseURL := GetBaseURL(t)
    dataDir := GetDataDir(t)
    client := NewTestClient(GetAPIToken(t))

    // Seed initial state
    WriteSites(t, dataDir, []SiteConfig{})

    // Trigger action that should persist a site config
    resp, _ := client.PostJSON(baseURL+"/api/scrape", map[string]interface{}{
        "url": "https://test-site.com/article",
    })

    // Wait for async persistence (if applicable)
    time.Sleep(100 * time.Millisecond)

    // Verify file changed
    sites := ReadSites(t, dataDir)
    
    found := false
    for _, site := range sites {
        if site.DomainPattern == "test-site.com" {
            found = true
            break
        }
    }

    if !found {
        t.Error("Expected test-site.com to be persisted to sites.jsonc")
    }
}
```

### Pattern 4: Testing Dashboard HTML Responses

```go
func TestDashboardSitesRenders(t *testing.T) {
    baseURL := GetBaseURL(t)
    dataDir := GetDataDir(t)
    client := NewTestClient(GetAPIToken(t))

    // Seed test data
    WriteSites(t, dataDir, []SiteConfig{
        {DomainPattern: "example.com", XpathMainContent: "//article"},
    })

    // Get dashboard page
    resp, _ := client.Get(baseURL + "/dashboard/sites")

    if resp.StatusCode != 200 {
        t.Fatalf("Expected 200, got %d", resp.StatusCode)
    }

    body, _ := io.ReadAll(resp.Body)
    html := string(body)

    // Verify content
    if !strings.Contains(html, "example.com") {
        t.Error("Expected site domain in HTML")
    }

    if !strings.Contains(html, "//article") {
        t.Error("Expected xpath in HTML")
    }
}
```

### Pattern 5: Testing Stats Increments

```go
func TestStatsIncrementOnScrape(t *testing.T) {
    baseURL := GetBaseURL(t)
    dataDir := GetDataDir(t)
    client := NewTestClient(GetAPIToken(t))

    // Get initial stats
    initialStats := ReadStats(t, dataDir)
    initialTotal := initialStats.ScrapeTotal

    // Perform scrape
    client.PostJSON(baseURL+"/api/scrape", map[string]interface{}{
        "url": "https://example.com",
    })

    // Verify stats incremented
    finalStats := ReadStats(t, dataDir)

    if finalStats.ScrapeTotal != initialTotal+1 {
        t.Errorf("Expected scrapeTotal=%d, got %d", initialTotal+1, finalStats.ScrapeTotal)
    }
}
```

---

## 6. Required Test Cases for Each Endpoint

### `/api/scrape` (POST)

| Test | Description |
|------|-------------|
| `TestApiScrapeSuccess` | Valid URL returns success with data |
| `TestApiScrapeRequiresAuth` | Missing auth returns 401 |
| `TestApiScrapeInvalidToken` | Wrong token returns 401 |
| `TestApiScrapeValidation` | Missing URL returns 400 |
| `TestApiScrapeInvalidUrl` | Malformed URL returns 400 |
| `TestApiScrapeStats` | Successful scrape increments stats |
| `TestApiScrapeLogs` | Scrape is logged to daily log file |

### `/health` (GET)

| Test | Description |
|------|-------------|
| `TestHealthEndpoint` | Returns 200 with status "alive" |
| `TestHealthNoAuth` | Does NOT require authentication |

### `/dashboard/sites` (GET)

| Test | Description |
|------|-------------|
| `TestDashboardSitesRequiresAuth` | Missing auth redirects to login |
| `TestDashboardSitesRenders` | Returns HTML with site list |
| `TestDashboardSitesEmpty` | Empty sites shows appropriate message |
| `TestDashboardSitesFiltering` | Search parameter filters results |

### `/dashboard/sites/:domain` (POST)

| Test | Description |
|------|-------------|
| `TestDashboardSiteUpdate` | Updates site config in sites.jsonc |
| `TestDashboardSiteValidation` | Invalid xpath returns error |

### `/dashboard/sites/:domain` (DELETE)

| Test | Description |
|------|-------------|
| `TestDashboardSiteDelete` | Removes site from sites.jsonc |
| `TestDashboardSiteDeleteNotFound` | Non-existent domain returns 404 |

---

## 7. SmartScraper Domain Models

### ScrapeResult (from API response)

```go
type ScrapeResult struct {
    Success    bool   `json:"success"`
    Method     string `json:"method,omitempty"`
    Xpath      string `json:"xpath,omitempty"`
    Data       string `json:"data,omitempty"`
    ErrorType  string `json:"errorType,omitempty"`
    Error      string `json:"error,omitempty"`
}
```

### SiteConfig (from sites.jsonc)

```go
type SiteConfig struct {
    DomainPattern                 string            `json:"domainPattern"`
    XpathMainContent              string            `json:"xpathMainContent"`
    LastSuccessfulScrapeTimestamp string            `json:"lastSuccessfulScrapeTimestamp,omitempty"`
    FailureCountSinceLastSuccess  int               `json:"failureCountSinceLastSuccess"`
    DiscoveredByLlm               bool              `json:"discoveredByLlm,omitempty"`
    SiteSpecificHeaders           map[string]string `json:"siteSpecificHeaders,omitempty"`
    SiteCleanupClasses            []string          `json:"siteCleanupClasses,omitempty"`
    UserAgent                     string            `json:"userAgent,omitempty"`
}
```

### Stats (from stats.json)

```go
type Stats struct {
    ScrapeTotal  int               `json:"scrapeTotal"`
    FailTotal    int               `json:"failTotal"`
    TodayDate    string            `json:"todayDate"`
    ScrapeToday  int               `json:"scrapeToday"`
    FailToday    int               `json:"failToday"`
    DomainCounts map[string]int    `json:"domainCounts"`
}
```

---

## 8. Common Pitfalls to Avoid

### Wrong: Not Waiting for Async Operations

```go
// Wrong - file may not be written yet
client.PostJSON(baseURL+"/api/scrape", body)
sites := ReadSites(t, dataDir)  // May read stale data!
```

**Fix:** Add small delay for async file writes:

```go
client.PostJSON(baseURL+"/api/scrape", body)
time.Sleep(100 * time.Millisecond)  // Wait for async persistence
sites := ReadSites(t, dataDir)
```

### Wrong: Using Wrong Data Directory

```go
// Wrong - hardcoded path
sites, _ := os.ReadFile("/var/lib/smart-scraper/sites.jsonc")
```

**Fix:** Use worker's isolated DATA_DIR:

```go
dataDir := GetDataDir(t)
sitesPath := filepath.Join(dataDir, "sites.jsonc")
sites, _ := os.ReadFile(sitesPath)
```

### Wrong: Not Checking Response Status Before Parsing

```go
// Wrong - will fail cryptically if status is 500
var result ScrapeResult
json.NewDecoder(resp.Body).Decode(&result)
```

**Fix:** Always check status first:

```go
if resp.StatusCode != 200 {
    body, _ := io.ReadAll(resp.Body)
    t.Fatalf("Expected 200, got %d: %s", resp.StatusCode, body)
}
var result ScrapeResult
json.NewDecoder(resp.Body).Decode(&result)
```

### Wrong: Testing Production Secrets

```go
// Wrong - using real API keys
os.Setenv("OPENROUTER_API_KEY", "sk-or-v1-real-key")
```

**Fix:** Use test tokens or mock the LLM port for E2E tests that don't need LLM:

```go
// For tests that need LLM, orchestrator provides real key from secrets.yaml
// For tests that don't need LLM, seed sites.jsonc with known config
```

---

## 9. Test Organization Best Practices

### File Naming

- `api_test.go` - API endpoint tests
- `dashboard_test.go` - Dashboard UI tests
- `auth_test.go` - Authentication tests
- `storage_test.go` - File storage tests
- `health_test.go` - Health check tests

### Test Naming

```go
// Good: Descriptive, specific
func TestApiScrapeWithKnownConfig(t *testing.T)
func TestDashboardSitesFiltering(t *testing.T)
func TestAuthRejectsExpiredSession(t *testing.T)

// Bad: Vague, unclear
func TestFeature1(t *testing.T)
func TestStuff(t *testing.T)
```

### Test Independence

- Each test should be completely independent
- Don't rely on execution order
- Don't share state between tests
- Each test seeds its own data via `WriteSites()`, `WriteStats()`

---

## 10. Debugging Failed Tests

### Step 1: Read Error Message

```go
// Example error:
// api_test.go:45: Expected 200, got 500
```

### Step 2: Check Hono Server Logs

```bash
# While test is running, attach to tmux
tmux -S /tmp/claude-tmux-sockets/test-worker-0.sock attach

# Or capture logs
cat test-orchestrator/logs/worker-0-hono.log
```

### Step 3: Inspect Ephemeral Data

```bash
# Check what files exist
ls -la /tmp/smartscraper-test-0-*/

# Check sites.jsonc state
cat /tmp/smartscraper-test-0-*/sites.jsonc

# Check stats
cat /tmp/smartscraper-test-0-*/stats.json
```

### Step 4: Run Single Test

```bash
go run . --workers 1 --file TestApiScrape
```

---

## 11. Checklist for New Tests

Before considering a test complete:

- [ ] Test has descriptive name (`TestFeatureName`)
- [ ] Test uses helper functions from `helpers.go`
- [ ] Test uses `GetDataDir(t)` for file paths, not hardcoded paths
- [ ] Test checks HTTP status code before reading body
- [ ] Test verifies file state changed correctly (if applicable)
- [ ] Test handles errors with clear failure messages
- [ ] Test works when run alone: `go run . --workers 1 --file TestName`
- [ ] Test works when run with other tests: `just test`

---

## 12. When to Update This Document

Update `AGENTS.md` when:

- Adding new helper functions to `e2e/helpers.go`
- Discovering common test patterns worth documenting
- Finding common pitfalls that should be avoided
- Changing test architecture or structure
- Adding new debugging techniques
- New endpoints are added to the application

---

**OBEY THIS PROTOCOL.**
