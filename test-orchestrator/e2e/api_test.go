package e2e

import (
	"testing"
	"time"
)

// TestApiScrapeSuccess tests that a scrape request with a known site configuration succeeds.
// This test seeds a site configuration first, then performs a scrape against it.
func TestApiScrapeSuccess(t *testing.T) {
	baseURL := GetBaseURL(t)
	dataDir := GetDataDir(t)
	client := NewTestClient(GetAPIToken(t))

	// Seed a known site configuration for httpbin.org (a reliable test target)
	WriteSites(t, dataDir, []SiteConfig{
		{
			DomainPattern:                "httpbin.org",
			XpathMainContent:             "//body",
			FailureCountSinceLastSuccess: 0,
		},
	})

	// Initialize stats to track increments
	WriteStats(t, dataDir, Stats{
		ScrapeTotal:  0,
		FailTotal:    0,
		TodayDate:    time.Now().UTC().Format("2006-01-02"),
		ScrapeToday:  0,
		FailToday:    0,
		DomainCounts: map[string]int{},
	})

	resp, err := client.PostJSON(baseURL+"/api/scrape", map[string]interface{}{
		"url":        "https://httpbin.org/html",
		"outputType": "content_only",
	})
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}

	// For scrape tests, we accept either success or rate limit
	// since the test might hit rate limits on repeated runs
	if resp.StatusCode != 200 && resp.StatusCode != 429 {
		body := ReadBody(t, resp)
		t.Fatalf("Expected 200 or 429, got %d: %s", resp.StatusCode, body)
	}

	if resp.StatusCode == 429 {
		t.Skip("Rate limited, skipping success check")
	}

	var result ScrapeResult
	ParseJSON(t, resp, &result)

	if !result.Success {
		t.Errorf("Expected success=true, got false. Error: %s (%s)", result.Error, result.ErrorType)
	}

	if result.Data == "" {
		t.Error("Expected non-empty data in response")
	}
}

// TestApiScrapeOutputTypes tests different output type options.
func TestApiScrapeOutputTypes(t *testing.T) {
	baseURL := GetBaseURL(t)
	dataDir := GetDataDir(t)
	client := NewTestClient(GetAPIToken(t))

	// Seed a known site configuration
	WriteSites(t, dataDir, []SiteConfig{
		{
			DomainPattern:                "httpbin.org",
			XpathMainContent:             "//body",
			FailureCountSinceLastSuccess: 0,
		},
	})

	outputTypes := []string{"content_only", "full_html"}

	for _, outputType := range outputTypes {
		t.Run(outputType, func(t *testing.T) {
			resp, err := client.PostJSON(baseURL+"/api/scrape", map[string]interface{}{
				"url":        "https://httpbin.org/html",
				"outputType": outputType,
			})
			if err != nil {
				t.Fatalf("Request failed: %v", err)
			}

			// Accept rate limiting
			if resp.StatusCode == 429 {
				t.Skip("Rate limited")
			}

			if resp.StatusCode != 200 {
				body := ReadBody(t, resp)
				t.Fatalf("Expected 200, got %d: %s", resp.StatusCode, body)
			}

			var result ScrapeResult
			ParseJSON(t, resp, &result)

			if !result.Success {
				t.Errorf("Expected success=true for outputType=%s, got false. Error: %s",
					outputType, result.Error)
			}
		})
	}
}

// TestApiScrapeStats verifies that stats.json is incremented after a scrape.
func TestApiScrapeStats(t *testing.T) {
	baseURL := GetBaseURL(t)
	dataDir := GetDataDir(t)
	client := NewTestClient(GetAPIToken(t))

	// Seed initial state
	WriteSites(t, dataDir, []SiteConfig{
		{
			DomainPattern:                "httpbin.org",
			XpathMainContent:             "//body",
			FailureCountSinceLastSuccess: 0,
		},
	})

	todayDate := time.Now().UTC().Format("2006-01-02")
	WriteStats(t, dataDir, Stats{
		ScrapeTotal:  5,
		FailTotal:    1,
		TodayDate:    todayDate,
		ScrapeToday:  2,
		FailToday:    0,
		DomainCounts: map[string]int{"other.com": 3},
	})

	initialStats := ReadStats(t, dataDir)
	initialTotal := initialStats.ScrapeTotal

	// Perform a scrape
	resp, err := client.PostJSON(baseURL+"/api/scrape", map[string]interface{}{
		"url":        "https://httpbin.org/html",
		"outputType": "content_only",
	})
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	// Accept rate limiting
	if resp.StatusCode == 429 {
		t.Skip("Rate limited")
	}

	// Wait for async stats persistence
	time.Sleep(200 * time.Millisecond)

	// Read updated stats
	finalStats := ReadStats(t, dataDir)

	if finalStats.ScrapeTotal != initialTotal+1 {
		t.Errorf("Expected scrapeTotal=%d, got %d", initialTotal+1, finalStats.ScrapeTotal)
	}

	// Check domain count was incremented
	httpbinCount, exists := finalStats.DomainCounts["httpbin.org"]
	if !exists || httpbinCount < 1 {
		t.Errorf("Expected domainCounts['httpbin.org'] >= 1, got %d", httpbinCount)
	}
}

// TestApiScrapeLogs verifies that scrapes are logged to the daily log file.
func TestApiScrapeLogs(t *testing.T) {
	baseURL := GetBaseURL(t)
	dataDir := GetDataDir(t)
	client := NewTestClient(GetAPIToken(t))

	// Seed a known site configuration
	WriteSites(t, dataDir, []SiteConfig{
		{
			DomainPattern:                "httpbin.org",
			XpathMainContent:             "//body",
			FailureCountSinceLastSuccess: 0,
		},
	})

	// Perform a scrape
	resp, err := client.PostJSON(baseURL+"/api/scrape", map[string]interface{}{
		"url":        "https://httpbin.org/html",
		"outputType": "content_only",
	})
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	// Accept rate limiting
	if resp.StatusCode == 429 {
		t.Skip("Rate limited")
	}

	// Wait for async log write
	time.Sleep(200 * time.Millisecond)

	// Check log file exists and has entries
	logs := ReadLogs(t, dataDir)

	if len(logs) == 0 {
		t.Error("Expected at least one log entry after scrape")
		return
	}

	// Find the httpbin.org entry
	found := false
	for _, entry := range logs {
		if entry.Domain == "httpbin.org" {
			found = true
			if entry.URL != "https://httpbin.org/html" {
				t.Errorf("Expected log URL='https://httpbin.org/html', got '%s'", entry.URL)
			}
			break
		}
	}

	if !found {
		t.Error("Expected log entry for httpbin.org domain")
	}
}

// TestApiScrapeXpathOverride tests that xpath override parameter works.
func TestApiScrapeXpathOverride(t *testing.T) {
	baseURL := GetBaseURL(t)
	dataDir := GetDataDir(t)
	client := NewTestClient(GetAPIToken(t))

	// Seed a site config (but we'll override the xpath)
	WriteSites(t, dataDir, []SiteConfig{
		{
			DomainPattern:                "httpbin.org",
			XpathMainContent:             "//body",
			FailureCountSinceLastSuccess: 0,
		},
	})

	resp, err := client.PostJSON(baseURL+"/api/scrape", map[string]interface{}{
		"url":        "https://httpbin.org/html",
		"xpath":      "//h1",
		"outputType": "content_only",
	})
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}

	// Accept rate limiting
	if resp.StatusCode == 429 {
		t.Skip("Rate limited")
	}

	if resp.StatusCode != 200 {
		body := ReadBody(t, resp)
		t.Fatalf("Expected 200, got %d: %s", resp.StatusCode, body)
	}

	var result ScrapeResult
	ParseJSON(t, resp, &result)

	if !result.Success {
		t.Errorf("Expected success=true with xpath override, got false. Error: %s", result.Error)
	}
}
