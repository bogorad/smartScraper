package e2e

import (
	"net/http"
	"strings"
	"testing"
)

// TestHealthEndpoint verifies the /health endpoint returns 200.
// This endpoint should NOT require authentication.
func TestHealthEndpoint(t *testing.T) {
	baseURL := GetBaseURL(t)
	client := NewTestClient(GetAPIToken(t))

	resp, err := client.Get(baseURL + "/health")
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}

	AssertStatus(t, resp, 200)
}

// TestHealthNoAuth verifies /health works without authentication.
func TestHealthNoAuth(t *testing.T) {
	baseURL := GetBaseURL(t)

	// Use standard http client without auth
	resp, err := http.Get(baseURL + "/health")
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Errorf("Expected 200 without auth, got %d", resp.StatusCode)
	}
}

// TestApiScrapeRequiresAuth verifies /api/scrape rejects unauthenticated requests.
func TestApiScrapeRequiresAuth(t *testing.T) {
	baseURL := GetBaseURL(t)

	// Use standard http client without auth
	resp, err := http.Post(baseURL+"/api/scrape", "application/json", strings.NewReader(`{"url":"https://example.com"}`))
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 401 {
		t.Errorf("Expected 401 without auth, got %d", resp.StatusCode)
	}
}

// TestApiScrapeValidation verifies /api/scrape validates request body.
func TestApiScrapeValidation(t *testing.T) {
	baseURL := GetBaseURL(t)
	client := NewTestClient(GetAPIToken(t))

	// Missing URL should return 400
	resp, err := client.PostJSON(baseURL+"/api/scrape", map[string]interface{}{
		"outputType": "content_only",
		// "url" is missing
	})
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 400 {
		t.Errorf("Expected 400 for missing URL, got %d", resp.StatusCode)
	}
}

// TestApiScrapeInvalidUrl verifies /api/scrape rejects invalid URLs.
func TestApiScrapeInvalidUrl(t *testing.T) {
	baseURL := GetBaseURL(t)
	client := NewTestClient(GetAPIToken(t))

	resp, err := client.PostJSON(baseURL+"/api/scrape", map[string]interface{}{
		"url": "not-a-valid-url",
	})
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 400 {
		t.Errorf("Expected 400 for invalid URL, got %d", resp.StatusCode)
	}
}

// TestDashboardRequiresAuth verifies dashboard pages require authentication.
func TestDashboardRequiresAuth(t *testing.T) {
	baseURL := GetBaseURL(t)

	// Use standard http client without auth
	resp, err := http.Get(baseURL + "/dashboard/sites")
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	// Should redirect to login or return 401
	if resp.StatusCode != 401 && resp.StatusCode != 302 {
		t.Errorf("Expected 401 or 302 without auth, got %d", resp.StatusCode)
	}
}

// TestDashboardSitesRenders verifies /dashboard/sites returns HTML.
func TestDashboardSitesRenders(t *testing.T) {
	baseURL := GetBaseURL(t)
	dataDir := GetDataDir(t)
	client := NewTestClient(GetAPIToken(t))

	// Seed test data
	WriteSites(t, dataDir, []SiteConfig{
		{
			DomainPattern:    "example.com",
			XpathMainContent: "//article[@class='content']",
		},
	})

	resp, err := client.Get(baseURL + "/dashboard/sites")
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}

	AssertStatus(t, resp, 200)

	body := ReadBody(t, resp)

	// Verify HTML contains expected content
	AssertContains(t, body, "example.com")
	AssertContains(t, body, "//article")
}

// TestStatsFileInitialized verifies stats.json is created/readable.
func TestStatsFileInitialized(t *testing.T) {
	dataDir := GetDataDir(t)

	// Write initial stats
	WriteStats(t, dataDir, Stats{
		ScrapeTotal: 0,
		FailTotal:   0,
		TodayDate:   "2026-02-05",
		ScrapeToday: 0,
		FailToday:   0,
	})

	// Read back
	stats := ReadStats(t, dataDir)

	if stats.TodayDate != "2026-02-05" {
		t.Errorf("Expected todayDate='2026-02-05', got '%s'", stats.TodayDate)
	}
}

// TestSitesFilePersistence verifies sites.jsonc can be read/written.
func TestSitesFilePersistence(t *testing.T) {
	dataDir := GetDataDir(t)

	// Write sites
	testSites := []SiteConfig{
		{
			DomainPattern:                "test-domain.com",
			XpathMainContent:             "//main",
			FailureCountSinceLastSuccess: 0,
		},
		{
			DomainPattern:                "another-domain.org",
			XpathMainContent:             "//article",
			FailureCountSinceLastSuccess: 2,
		},
	}
	WriteSites(t, dataDir, testSites)

	// Read back
	sites := ReadSites(t, dataDir)

	if len(sites) != 2 {
		t.Fatalf("Expected 2 sites, got %d", len(sites))
	}

	if sites[0].DomainPattern != "test-domain.com" {
		t.Errorf("Expected first site domain='test-domain.com', got '%s'", sites[0].DomainPattern)
	}

	if sites[1].FailureCountSinceLastSuccess != 2 {
		t.Errorf("Expected second site failures=2, got %d", sites[1].FailureCountSinceLastSuccess)
	}
}
