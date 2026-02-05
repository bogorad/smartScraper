package main

import (
	"context"
	"net/http"
	"time"
)

// HealthChecker polls a health endpoint with exponential backoff.
type HealthChecker struct {
	URL            string
	Timeout        time.Duration
	InitialBackoff time.Duration
	MaxBackoff     time.Duration
	BackoffFactor  float64
}

// NewHealthChecker creates a HealthChecker with sensible defaults.
func NewHealthChecker(url string, timeout time.Duration) *HealthChecker {
	return &HealthChecker{
		URL:            url,
		Timeout:        timeout,
		InitialBackoff: 500 * time.Millisecond,
		MaxBackoff:     5 * time.Second,
		BackoffFactor:  1.5,
	}
}

// Wait polls the health endpoint until it returns 200 or the timeout is reached.
func (h *HealthChecker) Wait(ctx context.Context) error {
	return h.WaitWithProgress(ctx, nil)
}

// WaitWithProgress polls the health endpoint with a progress callback.
// The onAttempt callback is called before each attempt with the attempt number (1-based)
// and elapsed time since the start of waiting.
func (h *HealthChecker) WaitWithProgress(ctx context.Context, onAttempt func(attempt int, elapsed time.Duration)) error {
	ctx, cancel := context.WithTimeout(ctx, h.Timeout)
	defer cancel()

	client := &http.Client{
		Timeout: 2 * time.Second,
	}

	startTime := time.Now()
	backoff := h.InitialBackoff
	attempt := 0

	for {
		attempt++
		elapsed := time.Since(startTime)

		if onAttempt != nil {
			onAttempt(attempt, elapsed)
		}

		// Check if context is already cancelled before making request
		select {
		case <-ctx.Done():
			return ErrHealthCheckTimeout
		default:
		}

		// Make the health check request
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.URL, nil)
		if err != nil {
			return err
		}

		resp, err := client.Do(req)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}

		// Wait before next attempt with exponential backoff
		select {
		case <-ctx.Done():
			return ErrHealthCheckTimeout
		case <-time.After(backoff):
		}

		// Increase backoff for next iteration
		backoff = time.Duration(float64(backoff) * h.BackoffFactor)
		if backoff > h.MaxBackoff {
			backoff = h.MaxBackoff
		}
	}
}
