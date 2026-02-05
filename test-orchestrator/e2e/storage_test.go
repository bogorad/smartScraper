package e2e

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestSitesJsoncRoundtrip verifies that sites.jsonc can be written and read correctly.
func TestSitesJsoncRoundtrip(t *testing.T) {
	dataDir := GetDataDir(t)

	// Create test sites with various fields
	originalSites := []SiteConfig{
		{
			DomainPattern:                 "example.com",
			XpathMainContent:              "//article[@class='main-content']",
			FailureCountSinceLastSuccess:  0,
			LastSuccessfulScrapeTimestamp: "2026-02-05T10:30:00Z",
			DiscoveredByLlm:               true,
			SiteSpecificHeaders:           map[string]string{"X-Custom": "value"},
			SiteCleanupClasses:            []string{"ad", "sidebar", "footer"},
			UserAgent:                     "CustomBot/1.0",
		},
		{
			DomainPattern:                "another-site.org",
			XpathMainContent:             "//div[@id='content']",
			FailureCountSinceLastSuccess: 5,
		},
		{
			DomainPattern:                "minimal.io",
			XpathMainContent:             "//body",
			FailureCountSinceLastSuccess: 0,
		},
	}

	// Write sites
	WriteSites(t, dataDir, originalSites)

	// Read back
	readSites := ReadSites(t, dataDir)

	// Verify count
	if len(readSites) != len(originalSites) {
		t.Fatalf("Expected %d sites, got %d", len(originalSites), len(readSites))
	}

	// Verify first site (with all fields)
	if readSites[0].DomainPattern != "example.com" {
		t.Errorf("Expected domainPattern='example.com', got '%s'", readSites[0].DomainPattern)
	}
	if readSites[0].XpathMainContent != "//article[@class='main-content']" {
		t.Errorf("Expected xpath preserved, got '%s'", readSites[0].XpathMainContent)
	}
	if !readSites[0].DiscoveredByLlm {
		t.Error("Expected discoveredByLlm=true to be preserved")
	}
	if readSites[0].SiteSpecificHeaders == nil || readSites[0].SiteSpecificHeaders["X-Custom"] != "value" {
		t.Error("Expected siteSpecificHeaders to be preserved")
	}
	if len(readSites[0].SiteCleanupClasses) != 3 {
		t.Errorf("Expected 3 cleanup classes, got %d", len(readSites[0].SiteCleanupClasses))
	}
	if readSites[0].UserAgent != "CustomBot/1.0" {
		t.Errorf("Expected userAgent='CustomBot/1.0', got '%s'", readSites[0].UserAgent)
	}

	// Verify second site (with failures)
	if readSites[1].FailureCountSinceLastSuccess != 5 {
		t.Errorf("Expected failureCount=5, got %d", readSites[1].FailureCountSinceLastSuccess)
	}
}

// TestSitesJsoncEmptyArray verifies that empty sites array is handled correctly.
func TestSitesJsoncEmptyArray(t *testing.T) {
	dataDir := GetDataDir(t)

	// Write empty array
	WriteSites(t, dataDir, []SiteConfig{})

	// Read back
	sites := ReadSites(t, dataDir)

	if len(sites) != 0 {
		t.Errorf("Expected 0 sites, got %d", len(sites))
	}
}

// TestSitesJsoncMissingFile verifies that missing file returns empty array.
func TestSitesJsoncMissingFile(t *testing.T) {
	dataDir := GetDataDir(t)

	// Remove sites.jsonc if it exists
	sitesPath := filepath.Join(dataDir, "sites.jsonc")
	os.Remove(sitesPath)

	// Read should return empty array, not error
	sites := ReadSites(t, dataDir)

	if len(sites) != 0 {
		t.Errorf("Expected 0 sites for missing file, got %d", len(sites))
	}
}

// TestStatsJsonIncrement verifies that stats increment correctly.
func TestStatsJsonIncrement(t *testing.T) {
	dataDir := GetDataDir(t)

	todayDate := time.Now().UTC().Format("2006-01-02")

	// Write initial stats
	initialStats := Stats{
		ScrapeTotal:  10,
		FailTotal:    2,
		TodayDate:    todayDate,
		ScrapeToday:  5,
		FailToday:    1,
		DomainCounts: map[string]int{"example.com": 7, "test.org": 3},
	}
	WriteStats(t, dataDir, initialStats)

	// Read back
	readStats := ReadStats(t, dataDir)

	// Verify all fields
	if readStats.ScrapeTotal != 10 {
		t.Errorf("Expected scrapeTotal=10, got %d", readStats.ScrapeTotal)
	}
	if readStats.FailTotal != 2 {
		t.Errorf("Expected failTotal=2, got %d", readStats.FailTotal)
	}
	if readStats.TodayDate != todayDate {
		t.Errorf("Expected todayDate='%s', got '%s'", todayDate, readStats.TodayDate)
	}
	if readStats.ScrapeToday != 5 {
		t.Errorf("Expected scrapeToday=5, got %d", readStats.ScrapeToday)
	}
	if readStats.FailToday != 1 {
		t.Errorf("Expected failToday=1, got %d", readStats.FailToday)
	}

	// Verify domain counts
	if readStats.DomainCounts["example.com"] != 7 {
		t.Errorf("Expected domainCounts['example.com']=7, got %d", readStats.DomainCounts["example.com"])
	}
	if readStats.DomainCounts["test.org"] != 3 {
		t.Errorf("Expected domainCounts['test.org']=3, got %d", readStats.DomainCounts["test.org"])
	}
}

// TestStatsJsonMissingFile verifies that missing stats file returns defaults.
func TestStatsJsonMissingFile(t *testing.T) {
	dataDir := GetDataDir(t)

	// Remove stats.json if it exists
	statsPath := filepath.Join(dataDir, "stats.json")
	os.Remove(statsPath)

	// Read should return defaults, not error
	stats := ReadStats(t, dataDir)

	if stats.ScrapeTotal != 0 {
		t.Errorf("Expected scrapeTotal=0 for missing file, got %d", stats.ScrapeTotal)
	}
	if stats.DomainCounts == nil {
		t.Error("Expected DomainCounts to be initialized, got nil")
	}
}

// TestLogsDirectoryCreation verifies that log files are created in the logs directory.
func TestLogsDirectoryCreation(t *testing.T) {
	dataDir := GetDataDir(t)

	// Ensure logs directory exists
	EnsureLogsDir(t, dataDir)

	logsDir := filepath.Join(dataDir, "logs")

	// Verify directory exists
	info, err := os.Stat(logsDir)
	if err != nil {
		t.Fatalf("Logs directory does not exist: %v", err)
	}
	if !info.IsDir() {
		t.Error("Logs path exists but is not a directory")
	}
}

// TestLogsReadEmpty verifies that reading logs from empty/missing file returns empty array.
func TestLogsReadEmpty(t *testing.T) {
	dataDir := GetDataDir(t)

	// Ensure logs directory exists but is empty
	EnsureLogsDir(t, dataDir)

	// Read logs (today's file likely doesn't exist yet)
	logs := ReadLogs(t, dataDir)

	// Should return empty array, not error
	if logs == nil {
		t.Error("Expected empty array, got nil")
	}
}

// TestFilePermissions verifies that created files have correct permissions.
func TestFilePermissions(t *testing.T) {
	dataDir := GetDataDir(t)

	// Write sites file
	WriteSites(t, dataDir, []SiteConfig{
		{
			DomainPattern:                "test.com",
			XpathMainContent:             "//body",
			FailureCountSinceLastSuccess: 0,
		},
	})

	// Check file permissions (should be readable/writable by owner)
	sitesPath := filepath.Join(dataDir, "sites.jsonc")
	info, err := os.Stat(sitesPath)
	if err != nil {
		t.Fatalf("Failed to stat sites.jsonc: %v", err)
	}

	mode := info.Mode()
	// Should have at least owner read/write (0600)
	if mode.Perm()&0600 != 0600 {
		t.Errorf("Expected file to have at least owner rw, got %v", mode.Perm())
	}
}

// TestDataDirIsolation verifies that DATA_DIR is used correctly.
func TestDataDirIsolation(t *testing.T) {
	dataDir := GetDataDir(t)

	// Verify dataDir is a real path
	if dataDir == "" {
		t.Fatal("DATA_DIR is empty")
	}

	// Verify it exists or can be created
	info, err := os.Stat(dataDir)
	if err != nil {
		// Try to create it
		if err := os.MkdirAll(dataDir, 0755); err != nil {
			t.Fatalf("Cannot create DATA_DIR: %v", err)
		}
	} else if !info.IsDir() {
		t.Fatal("DATA_DIR exists but is not a directory")
	}

	// Write a test file to verify we can write to this directory
	testFile := filepath.Join(dataDir, "test-isolation.txt")
	if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
		t.Fatalf("Cannot write to DATA_DIR: %v", err)
	}

	// Clean up
	os.Remove(testFile)
}
