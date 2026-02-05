// Package main provides the CLI entry point for the SmartScraper test orchestrator.
//
// Usage:
//
//	go run ./test-orchestrator [options]
//
// Options:
//
//	-f, --file string      Run tests matching pattern (case-insensitive substring)
//	    --full             Force full run, bypass cache
//	-w, --workers int      Number of parallel workers (1-8, default 1)
//	    --timeout duration Health check timeout (default 60s)
//	    --logs-dir string  Log directory (default "test-orchestrator/logs")
//	-v, --verbose          Enable verbose output
//
// Examples:
//
//	go run ./test-orchestrator                    # Run all tests with 1 worker
//	go run ./test-orchestrator -w 4               # Run with 4 parallel workers
//	go run ./test-orchestrator -f Health          # Run tests matching "Health"
//	go run ./test-orchestrator --full -v          # Force full run with verbose output
//
// The orchestrator manages isolated Hono server instances, runs E2E tests in parallel,
// and maintains a cache to skip unchanged tests.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	defer func() {
		if r := recover(); r != nil {
			fmt.Fprintf(os.Stderr, "[%s] PANIC: %v\n", time.Now().Format("15:04:05.000"), r)
			os.Exit(99)
		}
	}()

	// Log startup
	fmt.Printf("[%s] SmartScraper Test Orchestrator starting...\n", time.Now().Format("15:04:05.000"))

	// Change to project root if we're in test-orchestrator/
	if err := ensureProjectRoot(); err != nil {
		fmt.Fprintf(os.Stderr, "[%s] ERROR: %v\n", time.Now().Format("15:04:05.000"), err)
		os.Exit(1)
	}

	// Parse command line flags
	config := parseFlags()

	// Create context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Setup signal handler for graceful shutdown
	signalChan := make(chan os.Signal, 1)
	signal.Notify(signalChan, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP, syscall.SIGQUIT)

	go func() {
		sig := <-signalChan
		fmt.Printf("\n[%s] Received signal %v, initiating shutdown...\n", time.Now().Format("15:04:05.000"), sig)
		cancel()

		// Give cleanup 30 seconds before force exit
		select {
		case <-time.After(30 * time.Second):
			fmt.Fprintf(os.Stderr, "[%s] FATAL: Cleanup timed out after 30s, forcing exit\n", time.Now().Format("15:04:05.000"))
			os.Exit(2)
		case sig := <-signalChan:
			fmt.Fprintf(os.Stderr, "[%s] FATAL: Received second signal %v, forcing exit\n", time.Now().Format("15:04:05.000"), sig)
			os.Exit(2)
		}
	}()

	// Create orchestrator
	orchestrator, err := NewOrchestrator(config)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[%s] ERROR: Failed to create orchestrator: %v\n", time.Now().Format("15:04:05.000"), err)
		os.Exit(1)
	}

	// Ensure cleanup always runs
	defer func() {
		fmt.Printf("[%s] Running cleanup...\n", time.Now().Format("15:04:05.000"))
		if cleanupErr := orchestrator.Cleanup(); cleanupErr != nil {
			fmt.Fprintf(os.Stderr, "[%s] WARNING: Cleanup error: %v\n", time.Now().Format("15:04:05.000"), cleanupErr)
		}
	}()

	// Run orchestrator
	exitCode := 0
	if err := orchestrator.Run(ctx); err != nil {
		if err == ErrNoTestsFound {
			fmt.Fprintf(os.Stderr, "[%s] ERROR: No test files found in test-orchestrator/e2e/\n", time.Now().Format("15:04:05.000"))
			exitCode = 1
		} else if err == ErrTestsFailed {
			// Test failures already printed, exit with failure code
			exitCode = 1
		} else if ctx.Err() == context.Canceled {
			fmt.Printf("[%s] Orchestrator interrupted\n", time.Now().Format("15:04:05.000"))
			exitCode = 130 // Standard exit code for SIGINT
		} else {
			fmt.Fprintf(os.Stderr, "[%s] ERROR: %v\n", time.Now().Format("15:04:05.000"), err)
			exitCode = 1
		}
	}

	fmt.Printf("[%s] Done\n", time.Now().Format("15:04:05.000"))
	os.Exit(exitCode)
}

// parseFlags parses command line flags and returns a Config.
func parseFlags() *Config {
	config := &Config{}

	// Define flags with both long and short forms where specified
	flag.StringVar(&config.Pattern, "file", "", "Run tests matching pattern (case-insensitive substring)")
	flag.StringVar(&config.Pattern, "f", "", "Run tests matching pattern (shorthand for --file)")

	flag.BoolVar(&config.ForceFull, "full", false, "Force full run, bypass cache")

	flag.IntVar(&config.MaxWorkers, "workers", 1, "Number of parallel workers (1-8)")
	flag.IntVar(&config.MaxWorkers, "w", 1, "Number of parallel workers (shorthand for --workers)")

	flag.DurationVar(&config.HealthTimeout, "timeout", 60*time.Second, "Health check timeout")

	flag.StringVar(&config.LogsDir, "logs-dir", "test-orchestrator/logs", "Log directory")

	flag.BoolVar(&config.Verbose, "verbose", false, "Enable verbose output")
	flag.BoolVar(&config.Verbose, "v", false, "Enable verbose output (shorthand for --verbose)")

	flag.Parse()

	// Validate and clamp workers to 1-8 range
	if config.MaxWorkers < 1 {
		config.MaxWorkers = 1
	}
	if config.MaxWorkers > 8 {
		fmt.Printf("[%s] WARNING: Clamping workers from %d to maximum of 8\n",
			time.Now().Format("15:04:05.000"), config.MaxWorkers)
		config.MaxWorkers = 8
	}

	// Log configuration if verbose
	if config.Verbose {
		fmt.Printf("[%s] Config: workers=%d, pattern=%q, full=%v, timeout=%v, logs-dir=%q\n",
			time.Now().Format("15:04:05.000"),
			config.MaxWorkers,
			config.Pattern,
			config.ForceFull,
			config.HealthTimeout,
			config.LogsDir,
		)
	}

	return config
}

// ensureProjectRoot detects if we're running from test-orchestrator/ and changes
// to the project root if needed. This ensures consistent relative paths.
func ensureProjectRoot() error {
	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("failed to get working directory: %w", err)
	}

	// Check if we're in the test-orchestrator directory
	base := filepath.Base(cwd)
	if base == "test-orchestrator" {
		parent := filepath.Dir(cwd)
		if err := os.Chdir(parent); err != nil {
			return fmt.Errorf("failed to change to project root: %w", err)
		}
		fmt.Printf("[%s] Changed working directory to project root: %s\n",
			time.Now().Format("15:04:05.000"), parent)
	}

	return nil
}
