package e2e

import (
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
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

	// Create a client that doesn't follow redirects
	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	req, err := http.NewRequest("GET", baseURL+"/dashboard/sites", nil)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	// Should redirect to login (302) since there's no session cookie
	if resp.StatusCode != 302 {
		t.Errorf("Expected 302 redirect to login without auth, got %d", resp.StatusCode)
	}

	location := resp.Header.Get("Location")
	if location == "" || !strings.Contains(location, "/login") {
		t.Errorf("Expected redirect Location to contain /login, got: %s", location)
	}
}

// TestDashboardSitesRenders verifies /dashboard/sites returns HTML.
func TestDashboardSitesRenders(t *testing.T) {
	baseURL := GetBaseURL(t)
	dataDir := GetDataDir(t)
	token := GetAPIToken(t)

	// Seed test data
	WriteSites(t, dataDir, []SiteConfig{
		{
			DomainPattern:    "example.com",
			XpathMainContent: "//article[@class='content']",
		},
	})

	// Dashboard requires session cookie, not Bearer token
	// First login to get session cookie
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("Failed to create cookie jar: %v", err)
	}
	client := &http.Client{Jar: jar}

	// Login via POST
	loginURL := baseURL + "/login"
	form := url.Values{}
	form.Set("token", token)
	resp, err := client.PostForm(loginURL, form)
	if err != nil {
		t.Fatalf("Login request failed: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != 200 && resp.StatusCode != 302 {
		t.Fatalf("Login failed with status: %d", resp.StatusCode)
	}

	// Now access dashboard with session cookie
	resp, err = client.Get(baseURL + "/dashboard/sites")
	if err != nil {
		t.Fatalf("Dashboard request failed: %v", err)
	}

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("Expected 200, got %d: %s", resp.StatusCode, string(body))
	}

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
