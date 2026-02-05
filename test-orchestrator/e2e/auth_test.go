package e2e

import (
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"testing"
)

// TestApiInvalidToken verifies that an invalid token returns 401.
func TestApiInvalidToken(t *testing.T) {
	baseURL := GetBaseURL(t)

	// Create a client with a wrong token
	wrongClient := NewTestClient("invalid-token-12345")

	resp, err := wrongClient.PostJSON(baseURL+"/api/scrape", map[string]interface{}{
		"url": "https://example.com",
	})
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 401 {
		body := ReadBody(t, resp)
		t.Errorf("Expected 401 with invalid token, got %d: %s", resp.StatusCode, body)
	}
}

// TestApiEmptyToken verifies that missing auth header returns 401.
func TestApiEmptyToken(t *testing.T) {
	baseURL := GetBaseURL(t)

	// Create a client with empty token (no auth)
	emptyClient := &http.Client{}

	req, err := http.NewRequest("POST", baseURL+"/api/scrape", strings.NewReader(`{"url":"https://example.com"}`))
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	// Explicitly NOT setting Authorization header

	resp, err := emptyClient.Do(req)
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 401 {
		body, _ := readResponseBody(resp)
		t.Errorf("Expected 401 without auth header, got %d: %s", resp.StatusCode, body)
	}
}

// TestDashboardWithSession verifies that a session cookie grants access to dashboard.
func TestDashboardWithSession(t *testing.T) {
	baseURL := GetBaseURL(t)
	token := GetAPIToken(t)

	// Create an HTTP client with cookie jar to track sessions
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("Failed to create cookie jar: %v", err)
	}
	client := &http.Client{Jar: jar}

	// Step 1: Login via POST to /login
	loginURL := baseURL + "/login"
	form := url.Values{}
	form.Set("token", token)

	resp, err := client.PostForm(loginURL, form)
	if err != nil {
		t.Fatalf("Login request failed: %v", err)
	}
	defer resp.Body.Close()

	// Login should redirect (302) to dashboard
	// The client will follow redirects automatically, so final status should be 200
	if resp.StatusCode != 200 && resp.StatusCode != 302 {
		body, _ := readResponseBody(resp)
		t.Fatalf("Expected login to succeed, got status %d: %s", resp.StatusCode, body)
	}

	// Step 2: Access dashboard without bearer token (using session cookie)
	dashboardURL := baseURL + "/dashboard/sites"
	req, err := http.NewRequest("GET", dashboardURL, nil)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}
	// NOT setting Authorization header - relying on cookie

	resp2, err := client.Do(req)
	if err != nil {
		t.Fatalf("Dashboard request failed: %v", err)
	}
	defer resp2.Body.Close()

	// Should get 200 OK with session cookie
	if resp2.StatusCode != 200 {
		body, _ := readResponseBody(resp2)
		t.Errorf("Expected 200 with session cookie, got %d: %s", resp2.StatusCode, body)
	}
}

// TestDashboardWithoutSessionRedirects verifies that accessing dashboard without session redirects to login.
func TestDashboardWithoutSessionRedirects(t *testing.T) {
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

	// Should redirect to login
	if resp.StatusCode != 302 {
		t.Errorf("Expected 302 redirect to login, got %d", resp.StatusCode)
	}

	location := resp.Header.Get("Location")
	if !strings.Contains(location, "/login") {
		t.Errorf("Expected redirect to /login, got Location: %s", location)
	}
}

// TestApiValidTokenSucceeds verifies that a valid token grants API access.
func TestApiValidTokenSucceeds(t *testing.T) {
	baseURL := GetBaseURL(t)
	client := NewTestClient(GetAPIToken(t))

	// Health endpoint is always accessible, but let's check a protected one
	// by sending a valid but missing-url request (should get 400, not 401)
	resp, err := client.PostJSON(baseURL+"/api/scrape", map[string]interface{}{
		// Empty body - should trigger validation error, not auth error
	})
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	// Should get 400 (validation) not 401 (auth)
	if resp.StatusCode == 401 {
		t.Error("Valid token was rejected (got 401)")
	}
	if resp.StatusCode != 400 {
		// Could be 500 if server has issues, but should not be 401
		t.Logf("Got status %d (expected 400 for validation error)", resp.StatusCode)
	}
}

// readResponseBody is a local helper that reads the response body.
func readResponseBody(resp *http.Response) (string, error) {
	buf := make([]byte, 2048)
	n, _ := resp.Body.Read(buf)
	return string(buf[:n]), nil
}
