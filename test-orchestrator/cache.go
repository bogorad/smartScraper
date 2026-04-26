package main

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// CacheFile is the default filename for the test cache.
const CacheFile = ".test-cache.json"

// TestCacheEntry stores metadata about a cached test result.
type TestCacheEntry struct {
	Hash    string `json:"hash"`
	LastRun int64  `json:"lastRun"`
	Passed  bool   `json:"passed"`
}

// TestCache manages test result caching to skip unchanged passing tests.
type TestCache struct {
	Entries     map[string]TestCacheEntry `json:"entries"`
	HelpersHash string                    `json:"helpersHash"`
	ProjectHash string                    `json:"projectHash"`
	path        string
	mu          sync.Mutex
}

var projectSignaturePaths = []string{
	".justfile",
	"data/sites.jsonc",
	"package-lock.json",
	"package.json",
	"src",
	"testing/urls_for_testing.txt",
	"tsconfig.json",
}

// LoadCache loads the test cache from disk or creates a new empty cache.
func LoadCache() (*TestCache, error) {
	cache := &TestCache{
		Entries: make(map[string]TestCacheEntry),
		path:    CacheFile,
	}

	data, err := os.ReadFile(CacheFile)
	if err != nil {
		if os.IsNotExist(err) {
			return cache, nil
		}
		return nil, fmt.Errorf("failed to read cache file: %w", err)
	}

	if err := json.Unmarshal(data, cache); err != nil {
		// Corrupted cache, start fresh
		return &TestCache{
			Entries: make(map[string]TestCacheEntry),
			path:    CacheFile,
		}, nil
	}

	cache.path = CacheFile
	return cache, nil
}

// Save persists the cache to disk.
func (c *TestCache) Save() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal cache: %w", err)
	}

	if err := os.WriteFile(c.path, data, 0644); err != nil {
		return fmt.Errorf("failed to write cache file: %w", err)
	}

	return nil
}

// NeedsRun checks if a test file needs to run based on its hash and last result.
func (c *TestCache) NeedsRun(filePath string) bool {
	needsRun, _ := c.NeedsRunWithReason(filePath, filePath)
	return needsRun
}

// NeedsRunWithReason checks if a test cache entry needs to run and returns the reason.
func (c *TestCache) NeedsRunWithReason(cacheKey string, filePath string) (bool, string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Check if helpers changed
	if c.CheckHelpersChanged() {
		return true, "helpers.go changed"
	}

	if c.CheckProjectChanged() {
		return true, "project source changed"
	}

	// Get current file hash
	currentHash, err := FileHash(filePath)
	if err != nil {
		return true, fmt.Sprintf("cannot hash file: %v", err)
	}

	// Check cache entry
	entry, exists := c.Entries[cacheKey]
	if !exists {
		return true, "not in cache"
	}

	if entry.Hash != currentHash {
		return true, "file changed"
	}

	if !entry.Passed {
		return true, "previously failed"
	}

	return false, "cached pass"
}

// MarkPassed records a passing test result and saves immediately.
func (c *TestCache) MarkPassed(cacheKey string, filePath string) error {
	c.mu.Lock()

	hash, err := FileHash(filePath)
	if err != nil {
		c.mu.Unlock()
		return fmt.Errorf("failed to hash file: %w", err)
	}

	c.Entries[cacheKey] = TestCacheEntry{
		Hash:    hash,
		LastRun: time.Now().Unix(),
		Passed:  true,
	}

	// Update helpers hash
	helpersHash, _ := FileHash("test-orchestrator/e2e/helpers.go")
	c.HelpersHash = helpersHash
	projectHash, _ := ProjectHash()
	c.ProjectHash = projectHash

	c.mu.Unlock()
	return c.Save()
}

// MarkFailed records a failing test result and saves immediately.
func (c *TestCache) MarkFailed(cacheKey string, filePath string) error {
	c.mu.Lock()

	hash, err := FileHash(filePath)
	if err != nil {
		c.mu.Unlock()
		return fmt.Errorf("failed to hash file: %w", err)
	}

	c.Entries[cacheKey] = TestCacheEntry{
		Hash:    hash,
		LastRun: time.Now().Unix(),
		Passed:  false,
	}

	helpersHash, _ := FileHash("test-orchestrator/e2e/helpers.go")
	c.HelpersHash = helpersHash
	projectHash, _ := ProjectHash()
	c.ProjectHash = projectHash

	c.mu.Unlock()
	return c.Save()
}

// CheckHelpersChanged checks if the helpers.go file has changed since last run.
// NOTE: Must be called with mutex held or from NeedsRunWithReason which holds it.
func (c *TestCache) CheckHelpersChanged() bool {
	helpersPath := "test-orchestrator/e2e/helpers.go"

	currentHash, err := FileHash(helpersPath)
	if err != nil {
		// If we can't read helpers, assume changed to be safe
		return true
	}

	if c.HelpersHash == "" {
		// No stored hash, first run
		return true
	}

	return c.HelpersHash != currentHash
}

// CheckProjectChanged checks if source, config, dependency, or fixture inputs
// that affect E2E behavior have changed since the last cached run.
// NOTE: Must be called with mutex held or from NeedsRunWithReason which holds it.
func (c *TestCache) CheckProjectChanged() bool {
	currentHash, err := ProjectHash()
	if err != nil {
		return true
	}

	if c.ProjectHash == "" {
		return true
	}

	return c.ProjectHash != currentHash
}

// FileHash computes the MD5 hash of a file's contents.
func FileHash(filePath string) (string, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to read file: %w", err)
	}

	hash := md5.Sum(data)
	return hex.EncodeToString(hash[:]), nil
}

// ProjectHash computes a deterministic signature for project inputs that can
// change E2E behavior without changing an E2E test file.
func ProjectHash() (string, error) {
	var files []string
	for _, path := range projectSignaturePaths {
		info, err := os.Stat(path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return "", fmt.Errorf("failed to stat %s: %w", path, err)
		}

		if !info.IsDir() {
			files = append(files, path)
			continue
		}

		err = filepath.WalkDir(path, func(filePath string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				return nil
			}
			files = append(files, filePath)
			return nil
		})
		if err != nil {
			return "", fmt.Errorf("failed to walk %s: %w", path, err)
		}
	}

	sort.Strings(files)

	hash := md5.New()
	for _, filePath := range files {
		data, err := os.ReadFile(filePath)
		if err != nil {
			return "", fmt.Errorf("failed to read %s: %w", filePath, err)
		}
		hash.Write([]byte(filePath))
		hash.Write([]byte{0})
		hash.Write(data)
		hash.Write([]byte{0})
	}

	return hex.EncodeToString(hash.Sum(nil)), nil
}
