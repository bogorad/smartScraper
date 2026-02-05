package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// IsolatedEnv represents an ephemeral isolated environment for a test worker.
// Each worker gets its own temp directory with isolated storage files.
type IsolatedEnv struct {
	ID        int
	DataDir   string
	SitesFile string
	StatsFile string
	LogsDir   string
	Port      int
}

// CreateIsolatedEnv creates a new isolated environment for the given worker.
// It creates a temp directory with the pattern /tmp/smartscraper-test-{id}-{timestamp}/
// and initializes the required files and directories.
func CreateIsolatedEnv(workerID int) (*IsolatedEnv, error) {
	timestamp := time.Now().Unix()
	baseDir := fmt.Sprintf("/tmp/smartscraper-test-%d-%d", workerID, timestamp)

	// Create the base directory
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrIsolationCreateFailed, err)
	}

	// Create logs subdirectory
	logsDir := filepath.Join(baseDir, "logs")
	if err := os.MkdirAll(logsDir, 0755); err != nil {
		// Cleanup on failure
		os.RemoveAll(baseDir)
		return nil, fmt.Errorf("%w: failed to create logs dir: %v", ErrIsolationCreateFailed, err)
	}

	// Initialize sites.jsonc with empty array
	sitesFile := filepath.Join(baseDir, "sites.jsonc")
	if err := os.WriteFile(sitesFile, []byte("[]"), 0644); err != nil {
		os.RemoveAll(baseDir)
		return nil, fmt.Errorf("%w: failed to create sites.jsonc: %v", ErrIsolationCreateFailed, err)
	}

	// Initialize stats.json with empty object
	statsFile := filepath.Join(baseDir, "stats.json")
	if err := os.WriteFile(statsFile, []byte("{}"), 0644); err != nil {
		os.RemoveAll(baseDir)
		return nil, fmt.Errorf("%w: failed to create stats.json: %v", ErrIsolationCreateFailed, err)
	}

	env := &IsolatedEnv{
		ID:        workerID,
		DataDir:   baseDir,
		SitesFile: sitesFile,
		StatsFile: statsFile,
		LogsDir:   logsDir,
		Port:      9000 + workerID,
	}

	return env, nil
}

// Cleanup removes the entire DataDir recursively.
func (e *IsolatedEnv) Cleanup() error {
	if err := os.RemoveAll(e.DataDir); err != nil {
		return fmt.Errorf("%w: %v", ErrIsolationCleanupFailed, err)
	}
	return nil
}

// Env returns environment variables for the worker process.
func (e *IsolatedEnv) Env() []string {
	return []string{
		fmt.Sprintf("DATA_DIR=%s", e.DataDir),
		fmt.Sprintf("PORT=%d", e.Port),
		fmt.Sprintf("API_TOKEN=test-token-%d", e.ID),
	}
}

// URL returns the base URL for the worker's HTTP server.
func (e *IsolatedEnv) URL() string {
	return fmt.Sprintf("http://127.0.0.1:%d", e.Port)
}
