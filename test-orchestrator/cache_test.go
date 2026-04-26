package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProjectSourceChangeInvalidatesCache(t *testing.T) {
	tempDir := t.TempDir()
	originalDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	defer func() {
		if err := os.Chdir(originalDir); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	}()

	writeFile(t, filepath.Join(tempDir, ".justfile"), "test:\n\tgo test ./...\n")
	writeFile(t, filepath.Join(tempDir, "package.json"), "{}\n")
	writeFile(t, filepath.Join(tempDir, "package-lock.json"), "{}\n")
	writeFile(t, filepath.Join(tempDir, "tsconfig.json"), "{}\n")
	writeFile(t, filepath.Join(tempDir, "data", "sites.jsonc"), "[]\n")
	writeFile(t, filepath.Join(tempDir, "testing", "urls_for_testing.txt"), "https://example.com\n")
	writeFile(t, filepath.Join(tempDir, "src", "index.ts"), "export const value = 1;\n")
	writeFile(t, filepath.Join(tempDir, "test-orchestrator", "e2e", "helpers.go"), "package e2e\n")
	writeFile(t, filepath.Join(tempDir, "test-orchestrator", "e2e", "basic_test.go"), "package e2e\n")

	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("change working directory: %v", err)
	}

	cache := &TestCache{
		Entries: map[string]TestCacheEntry{},
		path:    filepath.Join(tempDir, CacheFile),
	}
	if err := cache.MarkPassed("test-orchestrator/e2e/basic_test.go::TestBasic", "test-orchestrator/e2e/basic_test.go"); err != nil {
		t.Fatalf("mark passed: %v", err)
	}

	needsRun, reason := cache.NeedsRunWithReason("test-orchestrator/e2e/basic_test.go::TestBasic", "test-orchestrator/e2e/basic_test.go")
	if needsRun {
		t.Fatalf("expected cached test before source change, got reason %q", reason)
	}

	writeFile(t, filepath.Join(tempDir, "src", "index.ts"), "export const value = 2;\n")

	needsRun, reason = cache.NeedsRunWithReason("test-orchestrator/e2e/basic_test.go::TestBasic", "test-orchestrator/e2e/basic_test.go")
	if !needsRun {
		t.Fatal("expected source change to invalidate cache")
	}
	if reason != "project source changed" {
		t.Fatalf("expected project source changed reason, got %q", reason)
	}
}

func TestCacheKeyIncludesTestFunction(t *testing.T) {
	tempDir := t.TempDir()
	originalDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	defer func() {
		if err := os.Chdir(originalDir); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	}()

	writeProjectFiles(t, tempDir)
	writeFile(t, filepath.Join(tempDir, "test-orchestrator", "e2e", "api_test.go"), "package e2e\n")

	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("change working directory: %v", err)
	}

	cache := &TestCache{
		Entries: map[string]TestCacheEntry{},
		path:    filepath.Join(tempDir, CacheFile),
	}
	if err := cache.MarkFailed("test-orchestrator/e2e/api_test.go::TestFailure", "test-orchestrator/e2e/api_test.go"); err != nil {
		t.Fatalf("mark failed: %v", err)
	}
	if err := cache.MarkPassed("test-orchestrator/e2e/api_test.go::TestSuccess", "test-orchestrator/e2e/api_test.go"); err != nil {
		t.Fatalf("mark passed: %v", err)
	}

	needsRun, reason := cache.NeedsRunWithReason("test-orchestrator/e2e/api_test.go::TestFailure", "test-orchestrator/e2e/api_test.go")
	if !needsRun {
		t.Fatal("expected failed sibling test to remain uncached")
	}
	if reason != "previously failed" {
		t.Fatalf("expected previously failed reason, got %q", reason)
	}

	needsRun, reason = cache.NeedsRunWithReason("test-orchestrator/e2e/api_test.go::TestSuccess", "test-orchestrator/e2e/api_test.go")
	if needsRun {
		t.Fatalf("expected passing sibling test to remain cached, got reason %q", reason)
	}
}

func writeFile(t *testing.T, path string, content string) {
	t.Helper()

	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("create parent directory for %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func writeProjectFiles(t *testing.T, root string) {
	t.Helper()

	writeFile(t, filepath.Join(root, ".justfile"), "test:\n\tgo test ./...\n")
	writeFile(t, filepath.Join(root, "package.json"), "{}\n")
	writeFile(t, filepath.Join(root, "package-lock.json"), "{}\n")
	writeFile(t, filepath.Join(root, "tsconfig.json"), "{}\n")
	writeFile(t, filepath.Join(root, "data", "sites.jsonc"), "[]\n")
	writeFile(t, filepath.Join(root, "testing", "urls_for_testing.txt"), "https://example.com\n")
	writeFile(t, filepath.Join(root, "src", "index.ts"), "export const value = 1;\n")
	writeFile(t, filepath.Join(root, "test-orchestrator", "e2e", "helpers.go"), "package e2e\n")
}
