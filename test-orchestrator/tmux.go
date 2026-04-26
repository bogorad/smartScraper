package main

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// TmuxSocketDir is the directory where tmux sockets are stored
const TmuxSocketDir = "/tmp/claude-tmux-sockets"

// TmuxSession represents a tmux session with its socket and name
type TmuxSession struct {
	Socket string // Full path to socket file
	Name   string // Session name
}

// NewTmuxSession creates a new TmuxSession for a given worker ID
func NewTmuxSession(workerID int) *TmuxSession {
	return &TmuxSession{
		Socket: fmt.Sprintf("%s/test-worker-%d.sock", TmuxSocketDir, workerID),
		Name:   fmt.Sprintf("test-worker-%d", workerID),
	}
}

// EnsureSocketDir creates the socket directory if it doesn't exist
func EnsureSocketDir() error {
	return os.MkdirAll(TmuxSocketDir, 0755)
}

// Start creates a new detached tmux session, killing any existing one first
func (t *TmuxSession) Start(verbose bool) error {
	// Kill any existing session first, then remove stale socket files left by a
	// crashed tmux server. Each worker uses a dedicated socket.
	t.CleanupStaleState(verbose)

	// Create new detached session
	args := []string{"-S", t.Socket, "new", "-d", "-s", t.Name}
	cmd := exec.Command("tmux", args...)
	if verbose {
		fmt.Printf("[tmux] Creating session: %s (socket: %s)\n", t.Name, t.Socket)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		t.CleanupStaleState(verbose)
		retryOutput, retryErr := exec.Command("tmux", args...).CombinedOutput()
		if retryErr == nil {
			output = retryOutput
		} else {
			return fmt.Errorf("failed to create tmux session %s: %w (socket: %s, command: %s, output: %s, retry: %v, retry output: %s)",
				t.Name,
				err,
				t.Socket,
				tmuxCommandString(args),
				strings.TrimSpace(string(output)),
				retryErr,
				strings.TrimSpace(string(retryOutput)),
			)
		}
	}

	// Wait for session to be fully ready (window :0.0 must exist)
	// This prevents "can't find window: 0" race condition
	for i := 0; i < 50; i++ { // 50 * 10ms = 500ms max
		if t.Exists() {
			return nil
		}
		time.Sleep(10 * time.Millisecond)
	}

	return fmt.Errorf("tmux session %s created but not ready after 500ms (socket: %s, command: %s)", t.Name, t.Socket, tmuxCommandString(args))
}

// SendCommand sends a command to the tmux session
func (t *TmuxSession) SendCommand(command string, verbose bool) error {
	if verbose {
		fmt.Printf("[tmux] Sending to %s: %s\n", t.Name, command)
	}

	// Use just session name without window number - targets the active window
	// This works regardless of base-index setting in user's tmux config
	cmd := exec.Command("tmux", "-S", t.Socket, "send-keys", "-t", t.Name, "--", command, "Enter")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to send command to session %s: %w (output: %s)", t.Name, err, string(output))
	}

	return nil
}

// Kill terminates the tmux session
func (t *TmuxSession) Kill() error {
	cmd := exec.Command("tmux", "-S", t.Socket, "kill-session", "-t", t.Name)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to kill session %s: %w (output: %s)", t.Name, err, string(output))
	}
	return nil
}

// CleanupStaleState removes stale per-worker tmux state before startup.
func (t *TmuxSession) CleanupStaleState(verbose bool) {
	if err := t.Kill(); err != nil && verbose {
		fmt.Printf("[tmux] No existing session killed for %s: %v\n", t.Name, err)
	}

	if err := os.Remove(t.Socket); err != nil && !os.IsNotExist(err) && verbose {
		fmt.Printf("[tmux] Failed to remove stale socket %s: %v\n", t.Socket, err)
	}
}

// Exists checks if the tmux session exists
func (t *TmuxSession) Exists() bool {
	cmd := exec.Command("tmux", "-S", t.Socket, "has-session", "-t", t.Name)
	err := cmd.Run()
	return err == nil
}

// CapturePaneOutput captures the last N lines from the tmux pane
func (t *TmuxSession) CapturePaneOutput(lines int) (string, error) {
	// Use negative start to capture last N lines
	// Use just session name without window number - targets the active window
	startLine := -lines
	cmd := exec.Command("tmux", "-S", t.Socket, "capture-pane", "-t", t.Name, "-p", "-S", strconv.Itoa(startLine))
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to capture pane output from session %s: %w (output: %s)", t.Name, err, string(output))
	}

	return strings.TrimSpace(string(output)), nil
}

func tmuxCommandString(args []string) string {
	return "tmux " + strings.Join(args, " ")
}
