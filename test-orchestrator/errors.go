package main

import "errors"

// Sentinel errors for the orchestrator
var (
	// Secret management
	ErrSecretDecryptFailed = errors.New("failed to decrypt secrets")

	// Isolation (ephemeral DATA_DIR)
	ErrIsolationCreateFailed  = errors.New("failed to create isolated environment")
	ErrIsolationCleanupFailed = errors.New("failed to cleanup isolated environment")

	// Tmux session management
	ErrTmuxStartFailed   = errors.New("failed to start tmux session")
	ErrTmuxCommandFailed = errors.New("failed to send tmux command")

	// Health checks
	ErrHealthCheckTimeout = errors.New("health check timed out")

	// Test execution
	ErrTestsFailed  = errors.New("go test execution failed")
	ErrNoTestsFound = errors.New("no test files found")

	// Worker management
	ErrWorkerNotAvailable = errors.New("no worker available")
	ErrWorkerStartFailed  = errors.New("worker failed to start")
)
