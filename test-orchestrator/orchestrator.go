package main

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Config holds configuration for the test orchestrator.
type Config struct {
	MaxWorkers    int
	Pattern       string
	ForceFull     bool
	LogsDir       string
	HealthTimeout time.Duration
	Verbose       bool
}

// TestInfo holds metadata about a single test function.
type TestInfo struct {
	FuncName string // e.g., "TestHealthEndpoint"
	FilePath string // e.g., "test-orchestrator/e2e/basic_test.go"
}

// Orchestrator coordinates test discovery, worker management, and parallel execution.
type Orchestrator struct {
	config       *Config
	secrets      *Secrets
	pool         *WorkerPool
	cache        *TestCache
	cleanupFuncs []func() error
	mu           sync.Mutex
}

// NewOrchestrator creates a new orchestrator with the given configuration.
func NewOrchestrator(config *Config) (*Orchestrator, error) {
	// Ensure logs directory exists
	if err := os.MkdirAll(config.LogsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create logs directory: %w", err)
	}

	// Load secrets
	secrets, err := LoadSecrets(config.Verbose)
	if err != nil {
		return nil, fmt.Errorf("failed to load secrets: %w", err)
	}

	// Load test cache
	cache, err := LoadCache()
	if err != nil {
		return nil, fmt.Errorf("failed to load test cache: %w", err)
	}

	// Check if helpers changed - if so, invalidate entire cache
	if cache.CheckHelpersChanged() && config.Verbose {
		fmt.Println("[orchestrator] helpers.go changed - all tests will run")
	}

	// Create worker pool
	pool := NewWorkerPool(config.MaxWorkers, config.LogsDir)

	return &Orchestrator{
		config:       config,
		secrets:      secrets,
		pool:         pool,
		cache:        cache,
		cleanupFuncs: make([]func() error, 0),
	}, nil
}

// Run executes the orchestrator workflow.
func (o *Orchestrator) Run(ctx context.Context) error {
	// Phase 1: Discover test functions
	if o.config.Verbose {
		fmt.Println("[orchestrator] Phase 1: Discovering tests...")
	}

	tests, err := o.discoverTestFunctions()
	if err != nil {
		return fmt.Errorf("test discovery failed: %w", err)
	}

	if len(tests) == 0 {
		return ErrNoTestsFound
	}

	if o.config.Verbose {
		fmt.Printf("[orchestrator] Found %d test function(s)\n", len(tests))
	}

	// Phase 2: Filter by pattern if specified
	if o.config.Pattern != "" {
		tests = o.filterTestFunctions(tests, o.config.Pattern)
		if len(tests) == 0 {
			fmt.Printf("No tests match pattern %q\n", o.config.Pattern)
			return nil
		}
		if o.config.Verbose {
			fmt.Printf("[orchestrator] %d test(s) match pattern %q\n", len(tests), o.config.Pattern)
		}
	}

	// Phase 3: Filter by cache (unless ForceFull)
	var toRun, skipped []TestInfo
	if o.config.ForceFull {
		toRun = tests
		if o.config.Verbose {
			fmt.Println("[orchestrator] Force full run - skipping cache check")
		}
	} else {
		toRun, skipped = o.filterByCache(tests)
		if o.config.Verbose {
			fmt.Printf("[orchestrator] %d test(s) to run, %d cached/skipped\n", len(toRun), len(skipped))
		}
	}

	if len(toRun) == 0 {
		fmt.Printf("All %d test(s) cached - nothing to run\n", len(skipped))
		return nil
	}

	// Phase 4: Start worker pool
	if o.config.Verbose {
		fmt.Println("[orchestrator] Phase 4: Starting worker pool...")
	}

	if err := o.pool.Start(ctx, o.config.HealthTimeout, o.config.Verbose); err != nil {
		return fmt.Errorf("failed to start worker pool: %w", err)
	}

	// Register cleanup for worker pool
	o.RegisterCleanup(func() error {
		return o.pool.Shutdown(ctx)
	})

	// Phase 5: Run tests in parallel
	if o.config.Verbose {
		fmt.Println("[orchestrator] Phase 5: Running tests in parallel...")
	}

	return o.runParallelTests(ctx, toRun, len(skipped))
}

// discoverTestFunctions finds all test functions in e2e test files.
func (o *Orchestrator) discoverTestFunctions() ([]TestInfo, error) {
	e2eDir := "test-orchestrator/e2e"
	pattern := filepath.Join(e2eDir, "*_test.go")

	files, err := filepath.Glob(pattern)
	if err != nil {
		return nil, fmt.Errorf("failed to glob test files: %w", err)
	}

	if len(files) == 0 {
		return nil, nil
	}

	// Regex to match test function declarations
	testFuncRegex := regexp.MustCompile(`^func\s+(Test\w+)\s*\(\s*\w+\s+\*testing\.T\s*\)`)

	var tests []TestInfo

	for _, filePath := range files {
		file, err := os.Open(filePath)
		if err != nil {
			return nil, fmt.Errorf("failed to open %s: %w", filePath, err)
		}

		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := scanner.Text()
			matches := testFuncRegex.FindStringSubmatch(line)
			if len(matches) >= 2 {
				funcName := matches[1]
				tests = append(tests, TestInfo{
					FuncName: funcName,
					FilePath: filePath,
				})
			}
		}

		file.Close()

		if err := scanner.Err(); err != nil {
			return nil, fmt.Errorf("failed to scan %s: %w", filePath, err)
		}
	}

	return tests, nil
}

// filterTestFunctions filters tests by case-insensitive substring match on FuncName.
func (o *Orchestrator) filterTestFunctions(tests []TestInfo, pattern string) []TestInfo {
	patternLower := strings.ToLower(pattern)
	var filtered []TestInfo

	for _, test := range tests {
		if strings.Contains(strings.ToLower(test.FuncName), patternLower) {
			filtered = append(filtered, test)
		}
	}

	return filtered
}

// filterByCache returns tests that need to run and tests that can be skipped.
func (o *Orchestrator) filterByCache(tests []TestInfo) (toRun, skipped []TestInfo) {
	for _, test := range tests {
		needsRun, reason := o.cache.NeedsRunWithReason(test.FilePath)
		if needsRun {
			if o.config.Verbose {
				fmt.Printf("[cache] %s: %s\n", test.FuncName, reason)
			}
			toRun = append(toRun, test)
		} else {
			if o.config.Verbose {
				fmt.Printf("[cache] %s: %s (skipped)\n", test.FuncName, reason)
			}
			skipped = append(skipped, test)
		}
	}
	return toRun, skipped
}

// runParallelTests executes tests in parallel using the worker pool.
func (o *Orchestrator) runParallelTests(ctx context.Context, tests []TestInfo, cachedCount int) error {
	var (
		passed  int64
		failed  int64
		skipped int64 = int64(cachedCount)
	)

	// Create test queue
	queue := make(chan TestInfo, len(tests))
	for _, test := range tests {
		queue <- test
	}
	close(queue)

	// Start worker goroutines
	var wg sync.WaitGroup
	workerCount := o.config.MaxWorkers
	if workerCount > len(tests) {
		workerCount = len(tests)
	}

	errChan := make(chan error, workerCount)
	acquireTimeout := 30 * time.Second

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func(workerNum int) {
			defer wg.Done()

			for test := range queue {
				// Acquire a worker
				worker, err := o.pool.Acquire(ctx, acquireTimeout, o.config.Verbose)
				if err != nil {
					errChan <- fmt.Errorf("failed to acquire worker for %s: %w", test.FuncName, err)
					return
				}

				// Run the test
				p, f, s := o.runSingleTest(ctx, worker, test)

				// Release the worker back to the pool
				o.pool.Release(worker)

				// Update counts atomically
				atomic.AddInt64(&passed, int64(p))
				atomic.AddInt64(&failed, int64(f))
				atomic.AddInt64(&skipped, int64(s))
			}
		}(i)
	}

	// Wait for all workers to finish
	wg.Wait()
	close(errChan)

	// Check for acquisition errors
	for err := range errChan {
		return err
	}

	// Print summary
	total := passed + failed + skipped
	fmt.Println()
	fmt.Printf("Test Summary: %d passed, %d failed, %d skipped (total: %d)\n",
		passed, failed, skipped, total)

	if failed > 0 {
		return ErrTestsFailed
	}

	return nil
}

// runSingleTest executes a single test function and returns pass/fail/skip counts.
func (o *Orchestrator) runSingleTest(ctx context.Context, worker *Worker, test TestInfo) (passed, failed, skipped int) {
	// Build the go test command
	// Run from project root, target ./test-orchestrator/e2e with -run filter
	args := []string{
		"test",
		"./test-orchestrator/e2e",
		"-run", fmt.Sprintf("^%s$", test.FuncName),
		"-v",
		"-count=1", // Disable test caching
	}

	cmd := exec.CommandContext(ctx, "go", args...)

	// Set environment:
	// - Worker environment (TEST_BASE_URL, DATA_DIR, API_TOKEN)
	// - Secrets (OPENROUTER_API_KEY, TWOCAPTCHA_API_KEY, PROXY_SERVER)
	// - Inherit some system env vars
	env := os.Environ()
	env = append(env, worker.Env()...)
	env = append(env, o.secrets.Env()...)
	cmd.Env = env

	// Capture output
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Log test start
	startTime := time.Now()
	if o.config.Verbose {
		fmt.Printf("[worker-%d] Running %s\n", worker.ID, test.FuncName)
	}

	// Execute
	err := cmd.Run()
	elapsed := time.Since(startTime)

	// Parse output for results
	output := stdout.String() + stderr.String()

	if err != nil {
		// Test failed
		failed = 1
		fmt.Printf("FAIL %s (%v)\n", test.FuncName, elapsed.Round(time.Millisecond))

		// Mark as failed in cache
		if cacheErr := o.cache.MarkFailed(test.FilePath); cacheErr != nil && o.config.Verbose {
			fmt.Printf("[cache] Warning: failed to mark %s as failed: %v\n", test.FuncName, cacheErr)
		}

		// Print failure output
		if o.config.Verbose {
			fmt.Println("--- Output ---")
			fmt.Println(output)
			fmt.Println("--- End Output ---")
		} else {
			// Even in non-verbose mode, show some context for failures
			lines := strings.Split(output, "\n")
			for _, line := range lines {
				if strings.Contains(line, "FAIL") || strings.Contains(line, "Error") ||
					strings.Contains(line, "panic") || strings.Contains(line, "--- FAIL") {
					fmt.Printf("    %s\n", line)
				}
			}
		}
	} else {
		// Test passed
		passed = 1
		fmt.Printf("PASS %s (%v)\n", test.FuncName, elapsed.Round(time.Millisecond))

		// Mark as passed in cache
		if cacheErr := o.cache.MarkPassed(test.FilePath); cacheErr != nil && o.config.Verbose {
			fmt.Printf("[cache] Warning: failed to mark %s as passed: %v\n", test.FuncName, cacheErr)
		}
	}

	return passed, failed, skipped
}

// RegisterCleanup adds a cleanup function to be called during shutdown.
func (o *Orchestrator) RegisterCleanup(fn func() error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.cleanupFuncs = append(o.cleanupFuncs, fn)
}

// Cleanup runs all registered cleanup functions in reverse order.
func (o *Orchestrator) Cleanup() error {
	o.mu.Lock()
	funcs := make([]func() error, len(o.cleanupFuncs))
	copy(funcs, o.cleanupFuncs)
	o.mu.Unlock()

	var errs []error

	// Run in reverse order (LIFO)
	for i := len(funcs) - 1; i >= 0; i-- {
		if err := funcs[i](); err != nil {
			errs = append(errs, err)
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("cleanup errors: %v", errs)
	}

	return nil
}
