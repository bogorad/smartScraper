package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// WorkerStatus represents the current state of a worker.
type WorkerStatus int

const (
	StatusIdle WorkerStatus = iota
	StatusStarting
	StatusReady
	StatusRunning
	StatusStopping
	StatusFailed
)

// String returns the string representation of the worker status.
func (s WorkerStatus) String() string {
	switch s {
	case StatusIdle:
		return "idle"
	case StatusStarting:
		return "starting"
	case StatusReady:
		return "ready"
	case StatusRunning:
		return "running"
	case StatusStopping:
		return "stopping"
	case StatusFailed:
		return "failed"
	default:
		return "unknown"
	}
}

// Worker manages a single test worker's lifecycle.
// Each worker runs a Hono dev server in a tmux session
// with an isolated file-based environment.
type Worker struct {
	ID              int
	Port            int
	TmuxSession     *TmuxSession
	IsolatedEnv     *IsolatedEnv
	LogFile         *os.File
	Status          WorkerStatus
	StartedAt       time.Time
	LastHealthCheck time.Time
	mu              sync.Mutex
}

// NewWorker creates a new worker with the given ID.
// It creates a log file and tmux session, but does not start them.
func NewWorker(id int, logsDir string) (*Worker, error) {
	// Create log file
	logPath := filepath.Join(logsDir, fmt.Sprintf("worker-%d.log", id))
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to create log file: %w", err)
	}

	// Create tmux session (not started yet)
	tmuxSession := NewTmuxSession(id)

	return &Worker{
		ID:          id,
		Port:        9000 + id,
		TmuxSession: tmuxSession,
		LogFile:     logFile,
		Status:      StatusIdle,
	}, nil
}

// StartTmux starts the tmux session for this worker.
func (w *Worker) StartTmux(verbose bool) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.Status = StatusStarting

	if err := w.TmuxSession.Start(verbose); err != nil {
		w.Status = StatusFailed
		return fmt.Errorf("%w: %v", ErrTmuxStartFailed, err)
	}

	return nil
}

// SetupIsolation creates the isolated environment for this worker.
func (w *Worker) SetupIsolation() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	env, err := CreateIsolatedEnv(w.ID)
	if err != nil {
		w.Status = StatusFailed
		return err
	}

	w.IsolatedEnv = env
	return nil
}

// StartHono starts the Hono dev server in the tmux session.
func (w *Worker) StartHono(verbose bool) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.IsolatedEnv == nil {
		return fmt.Errorf("isolated environment not set up")
	}

	// Get current working directory (project root)
	cwd, err := os.Getwd()
	if err != nil {
		w.Status = StatusFailed
		return fmt.Errorf("failed to get working directory: %w", err)
	}

	// Build the command with environment variables
	cmd := fmt.Sprintf("cd %s && DATA_DIR=%s PORT=%d API_TOKEN=test-token-%d npm run dev",
		cwd,
		w.IsolatedEnv.DataDir,
		w.Port,
		w.ID,
	)

	// Log the command
	timestamp := time.Now().Format(time.RFC3339)
	logEntry := fmt.Sprintf("[%s] Starting Hono: %s\n", timestamp, cmd)
	if _, err := w.LogFile.WriteString(logEntry); err != nil {
		// Log write failure is not fatal, continue
		if verbose {
			fmt.Printf("[worker-%d] Warning: failed to write to log: %v\n", w.ID, err)
		}
	}

	// Send command to tmux
	if err := w.TmuxSession.SendCommand(cmd, verbose); err != nil {
		w.Status = StatusFailed
		return fmt.Errorf("%w: %v", ErrTmuxCommandFailed, err)
	}

	w.StartedAt = time.Now()
	return nil
}

// CheckHealth performs a single health check against the worker's server.
func (w *Worker) CheckHealth(ctx context.Context) (bool, error) {
	url := fmt.Sprintf("http://127.0.0.1:%d/health", w.Port)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, err
	}

	client := &http.Client{
		Timeout: 2 * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		return false, nil // Not healthy, but not an error
	}
	defer resp.Body.Close()

	w.mu.Lock()
	w.LastHealthCheck = time.Now()
	w.mu.Unlock()

	return resp.StatusCode == http.StatusOK, nil
}

// WaitReady waits for the worker's server to become healthy.
func (w *Worker) WaitReady(ctx context.Context, timeout time.Duration, verbose bool) error {
	url := fmt.Sprintf("http://127.0.0.1:%d/health", w.Port)

	checker := NewHealthChecker(url, timeout)

	var progressFunc func(attempt int, elapsed time.Duration)
	if verbose {
		progressFunc = func(attempt int, elapsed time.Duration) {
			fmt.Printf("[worker-%d] Health check attempt %d (elapsed: %v)\n", w.ID, attempt, elapsed.Round(time.Millisecond))
		}
	}

	if err := checker.WaitWithProgress(ctx, progressFunc); err != nil {
		w.mu.Lock()
		w.Status = StatusFailed
		w.mu.Unlock()
		return err
	}

	w.mu.Lock()
	w.Status = StatusReady
	w.LastHealthCheck = time.Now()
	w.mu.Unlock()

	return nil
}

// Stop shuts down the worker, killing the tmux session and cleaning up isolation.
func (w *Worker) Stop(ctx context.Context) error {
	w.mu.Lock()
	w.Status = StatusStopping
	w.mu.Unlock()

	var errs []error

	// Kill tmux session
	if w.TmuxSession != nil {
		if err := w.TmuxSession.Kill(); err != nil {
			errs = append(errs, fmt.Errorf("tmux kill: %w", err))
		}
	}

	// Cleanup isolated environment
	if w.IsolatedEnv != nil {
		if err := w.IsolatedEnv.Cleanup(); err != nil {
			errs = append(errs, fmt.Errorf("isolation cleanup: %w", err))
		}
	}

	// Close log file
	if w.LogFile != nil {
		if err := w.LogFile.Close(); err != nil {
			errs = append(errs, fmt.Errorf("log file close: %w", err))
		}
	}

	w.mu.Lock()
	if len(errs) > 0 {
		w.Status = StatusFailed
	} else {
		w.Status = StatusIdle
	}
	w.mu.Unlock()

	if len(errs) > 0 {
		return fmt.Errorf("stop errors: %v", errs)
	}

	return nil
}

// URL returns the base URL for this worker's HTTP server.
func (w *Worker) URL() string {
	return fmt.Sprintf("http://127.0.0.1:%d", w.Port)
}

// Env returns environment variables for test processes to use this worker.
func (w *Worker) Env() []string {
	env := []string{
		fmt.Sprintf("TEST_BASE_URL=http://127.0.0.1:%d", w.Port),
		fmt.Sprintf("API_TOKEN=test-token-%d", w.ID),
	}

	if w.IsolatedEnv != nil {
		env = append(env, fmt.Sprintf("DATA_DIR=%s", w.IsolatedEnv.DataDir))
	}

	return env
}
