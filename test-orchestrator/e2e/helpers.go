// Package e2e provides end-to-end tests for SmartScraper.
// These tests run against real Hono server instances with isolated file storage.
package e2e

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// --- Environment Helpers ---

// GetBaseURL returns TEST_BASE_URL or fails the test.
// Example: http://127.0.0.1:9000
func GetBaseURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("TEST_BASE_URL")
	if url == "" {
		t.Fatal("TEST_BASE_URL environment variable not set")
	}
	return url
}

// GetDataDir returns DATA_DIR or fails the test.
// Example: /tmp/smartscraper-test-0-1738765432/
func GetDataDir(t *testing.T) string {
	t.Helper()
	dir := os.Getenv("DATA_DIR")
	if dir == "" {
		t.Fatal("DATA_DIR environment variable not set")
	}
	return dir
}

// GetAPIToken returns API_TOKEN or fails the test.
func GetAPIToken(t *testing.T) string {
	t.Helper()
	token := os.Getenv("API_TOKEN")
	if token == "" {
		t.Fatal("API_TOKEN environment variable not set")
	}
	return token
}

// --- HTTP Client ---

// TestClient is an HTTP client with automatic auth header injection.
type TestClient struct {
	http  *http.Client
	token string
}

// NewTestClient creates an HTTP client with auth header.
func NewTestClient(apiToken string) *TestClient {
	jar, _ := cookiejar.New(nil)
	return &TestClient{
		http: &http.Client{
			Jar:     jar,
			Timeout: 45 * time.Second,
		},
		token: apiToken,
	}
}

// Get performs a GET request with auth header.
func (c *TestClient) Get(targetURL string) (*http.Response, error) {
	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	return c.http.Do(req)
}

// PostJSON performs a POST request with JSON body and auth header.
func (c *TestClient) PostJSON(targetURL string, body interface{}) (*http.Response, error) {
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", targetURL, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	return c.http.Do(req)
}

// PostForm performs a POST request with form data and auth header.
func (c *TestClient) PostForm(targetURL string, data url.Values) (*http.Response, error) {
	req, err := http.NewRequest("POST", targetURL, bytes.NewReader([]byte(data.Encode())))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return c.http.Do(req)
}

// Delete performs a DELETE request with auth header.
func (c *TestClient) Delete(targetURL string) (*http.Response, error) {
	req, err := http.NewRequest("DELETE", targetURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	return c.http.Do(req)
}

// --- Domain Models ---

// ScrapeResult represents the API response from /api/scrape
type ScrapeResult struct {
	Success   bool   `json:"success"`
	Method    string `json:"method,omitempty"`
	Xpath     string `json:"xpath,omitempty"`
	Data      string `json:"data,omitempty"`
	ErrorType string `json:"errorType,omitempty"`
	Error     string `json:"error,omitempty"`
}

// SiteConfig represents a site configuration from sites.jsonc
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

// Stats represents the stats.json structure
type Stats struct {
	ScrapeTotal  int            `json:"scrapeTotal"`
	FailTotal    int            `json:"failTotal"`
	TodayDate    string         `json:"todayDate"`
	ScrapeToday  int            `json:"scrapeToday"`
	FailToday    int            `json:"failToday"`
	DomainCounts map[string]int `json:"domainCounts"`
}

// --- File Helpers ---

// ReadSites reads and parses sites.jsonc from the worker's DATA_DIR.
func ReadSites(t *testing.T, dataDir string) []SiteConfig {
	t.Helper()
	path := filepath.Join(dataDir, "sites.jsonc")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []SiteConfig{}
		}
		t.Fatalf("Failed to read sites.jsonc: %v", err)
	}

	// Strip comments for JSON parsing (simple approach)
	// JSONC comments are // or /* */
	// For now, assume file is valid JSON or empty array
	var sites []SiteConfig
	if err := json.Unmarshal(data, &sites); err != nil {
		t.Fatalf("Failed to parse sites.jsonc: %v", err)
	}
	return sites
}

// WriteSites writes sites to the worker's DATA_DIR.
func WriteSites(t *testing.T, dataDir string, sites []SiteConfig) {
	t.Helper()
	path := filepath.Join(dataDir, "sites.jsonc")
	data, err := json.MarshalIndent(sites, "", "  ")
	if err != nil {
		t.Fatalf("Failed to marshal sites: %v", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatalf("Failed to write sites.jsonc: %v", err)
	}
}

// ReadStats reads and parses stats.json from the worker's DATA_DIR.
func ReadStats(t *testing.T, dataDir string) Stats {
	t.Helper()
	path := filepath.Join(dataDir, "stats.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return Stats{DomainCounts: make(map[string]int)}
		}
		t.Fatalf("Failed to read stats.json: %v", err)
	}

	var stats Stats
	if err := json.Unmarshal(data, &stats); err != nil {
		t.Fatalf("Failed to parse stats.json: %v", err)
	}
	if stats.DomainCounts == nil {
		stats.DomainCounts = make(map[string]int)
	}
	return stats
}

// WriteStats writes stats to the worker's DATA_DIR.
func WriteStats(t *testing.T, dataDir string, stats Stats) {
	t.Helper()
	path := filepath.Join(dataDir, "stats.json")
	data, err := json.MarshalIndent(stats, "", "  ")
	if err != nil {
		t.Fatalf("Failed to marshal stats: %v", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatalf("Failed to write stats.json: %v", err)
	}
}

// --- Response Helpers ---

// ReadBody reads and returns the response body as a string.
// Closes the response body after reading.
func ReadBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("Failed to read response body: %v", err)
	}
	return string(body)
}

// ParseJSON parses the response body as JSON into the target.
// Closes the response body after reading.
func ParseJSON(t *testing.T, resp *http.Response, target interface{}) {
	t.Helper()
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
		t.Fatalf("Failed to parse JSON response: %v", err)
	}
}

// --- Assertion Helpers ---

// AssertStatus checks that the response has the expected status code.
func AssertStatus(t *testing.T, resp *http.Response, expected int) {
	t.Helper()
	if resp.StatusCode != expected {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("Expected status %d, got %d. Body: %s", expected, resp.StatusCode, string(body))
	}
}

// AssertContains checks that the body contains the expected substring.
func AssertContains(t *testing.T, body, expected string) {
	t.Helper()
	if !bytes.Contains([]byte(body), []byte(expected)) {
		maxLen := 500
		if len(body) < maxLen {
			maxLen = len(body)
		}
		t.Errorf("Expected body to contain %q, got: %s...", expected, body[:maxLen])
	}
}

// --- Log Models and Helpers ---

// LogEntry represents a single scrape log entry
type LogEntry struct {
	Ts        string `json:"ts"`
	Domain    string `json:"domain"`
	URL       string `json:"url"`
	Success   bool   `json:"success"`
	Method    string `json:"method,omitempty"`
	Xpath     string `json:"xpath,omitempty"`
	ErrorType string `json:"errorType,omitempty"`
	Error     string `json:"error,omitempty"`
	Ms        int    `json:"ms"`
}

// ReadLogs reads today's log file from the worker's DATA_DIR/logs directory.
func ReadLogs(t *testing.T, dataDir string) []LogEntry {
	t.Helper()
	today := time.Now().UTC().Format("2006-01-02")
	logsDir := filepath.Join(dataDir, "logs")
	logFile := filepath.Join(logsDir, today+".jsonl")

	data, err := os.ReadFile(logFile)
	if err != nil {
		if os.IsNotExist(err) {
			return []LogEntry{}
		}
		t.Fatalf("Failed to read log file: %v", err)
	}

	var entries []LogEntry
	lines := bytes.Split(data, []byte("\n"))
	for _, line := range lines {
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var entry LogEntry
		if err := json.Unmarshal(line, &entry); err != nil {
			t.Logf("Warning: failed to parse log line: %v", err)
			continue
		}
		entries = append(entries, entry)
	}
	return entries
}

// EnsureLogsDir creates the logs directory if it doesn't exist.
func EnsureLogsDir(t *testing.T, dataDir string) {
	t.Helper()
	logsDir := filepath.Join(dataDir, "logs")
	if err := os.MkdirAll(logsDir, 0755); err != nil {
		t.Fatalf("Failed to create logs directory: %v", err)
	}
}
