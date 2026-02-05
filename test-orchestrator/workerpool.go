package main

import (
	"context"
	"fmt"
	"os/exec"
	"sync"
	"time"
)

// WorkerPool manages a pool of test workers.
type WorkerPool struct {
	workers    []*Worker
	maxWorkers int
	logsDir    string
	mu         sync.Mutex
	available  chan *Worker
}

// NewWorkerPool creates a new worker pool.
func NewWorkerPool(maxWorkers int, logsDir string) *WorkerPool {
	return &WorkerPool{
		workers:    make([]*Worker, 0, maxWorkers),
		maxWorkers: maxWorkers,
		logsDir:    logsDir,
		available:  make(chan *Worker, maxWorkers),
	}
}

// Start initializes and starts all workers in the pool.
// It runs through 4 phases:
//  1. Start tmux sessions (parallel)
//  2. Setup isolation - ephemeral DATA_DIRs (parallel)
//  3. Start Hono servers (parallel)
//  4. Health check loop until all workers healthy
func (p *WorkerPool) Start(ctx context.Context, healthTimeout time.Duration, verbose bool) error {
	// Ensure tmux socket directory exists
	if err := EnsureSocketDir(); err != nil {
		return fmt.Errorf("failed to ensure tmux socket dir: %w", err)
	}

	// Phase 1: Create workers and start tmux sessions in parallel
	if verbose {
		fmt.Printf("[pool] Phase 1: Starting %d tmux sessions...\n", p.maxWorkers)
	}

	var wg sync.WaitGroup
	errChan := make(chan error, p.maxWorkers)

	for i := 0; i < p.maxWorkers; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			worker, err := NewWorker(id, p.logsDir)
			if err != nil {
				errChan <- fmt.Errorf("worker %d: %w", id, err)
				return
			}

			if err := worker.StartTmux(verbose); err != nil {
				errChan <- fmt.Errorf("worker %d: %w", id, err)
				return
			}

			p.mu.Lock()
			p.workers = append(p.workers, worker)
			p.mu.Unlock()

			if verbose {
				fmt.Printf("[pool] Worker %d tmux session started\n", id)
			}
		}(i)
	}
	wg.Wait()
	close(errChan)

	// Check for phase 1 errors
	for err := range errChan {
		return fmt.Errorf("phase 1 (tmux sessions): %w", err)
	}

	if len(p.workers) != p.maxWorkers {
		return fmt.Errorf("%w: only %d of %d workers started", ErrWorkerStartFailed, len(p.workers), p.maxWorkers)
	}

	// Phase 2: Setup isolation (ephemeral DATA_DIRs) in parallel
	if verbose {
		fmt.Printf("[pool] Phase 2: Setting up %d isolated environments...\n", p.maxWorkers)
	}

	errChan = make(chan error, p.maxWorkers)
	for _, worker := range p.workers {
		wg.Add(1)
		go func(w *Worker) {
			defer wg.Done()

			if err := w.SetupIsolation(); err != nil {
				errChan <- fmt.Errorf("worker %d: %w", w.ID, err)
				return
			}

			if verbose {
				fmt.Printf("[pool] Worker %d isolation ready: %s\n", w.ID, w.IsolatedEnv.DataDir)
			}
		}(worker)
	}
	wg.Wait()
	close(errChan)

	// Check for phase 2 errors
	for err := range errChan {
		return fmt.Errorf("phase 2 (isolation): %w", err)
	}

	// Phase 3: Start Hono servers in parallel
	if verbose {
		fmt.Printf("[pool] Phase 3: Starting %d Hono servers...\n", p.maxWorkers)
	}

	errChan = make(chan error, p.maxWorkers)
	for _, worker := range p.workers {
		wg.Add(1)
		go func(w *Worker) {
			defer wg.Done()

			if err := w.StartHono(verbose); err != nil {
				errChan <- fmt.Errorf("worker %d: %w", w.ID, err)
				return
			}

			if verbose {
				fmt.Printf("[pool] Worker %d Hono start command sent (port %d)\n", w.ID, w.Port)
			}
		}(worker)
	}
	wg.Wait()
	close(errChan)

	// Check for phase 3 errors
	for err := range errChan {
		return fmt.Errorf("phase 3 (hono servers): %w", err)
	}

	// Phase 4: Health check loop - poll every 200ms until ALL workers healthy
	if verbose {
		fmt.Printf("[pool] Phase 4: Waiting for %d workers to become healthy (timeout: %v)...\n", p.maxWorkers, healthTimeout)
	}

	healthCtx, healthCancel := context.WithTimeout(ctx, healthTimeout)
	defer healthCancel()

	healthyWorkers := make(map[int]bool)
	pollInterval := 200 * time.Millisecond

	for {
		select {
		case <-healthCtx.Done():
			// List unhealthy workers
			var unhealthy []int
			for _, w := range p.workers {
				if !healthyWorkers[w.ID] {
					unhealthy = append(unhealthy, w.ID)
				}
			}
			return fmt.Errorf("%w: workers %v did not become healthy", ErrHealthCheckTimeout, unhealthy)

		default:
			// Check all workers in parallel
			var healthWg sync.WaitGroup
			healthResults := make(chan struct {
				id      int
				healthy bool
			}, p.maxWorkers)

			for _, worker := range p.workers {
				if healthyWorkers[worker.ID] {
					continue // Skip already healthy workers
				}

				healthWg.Add(1)
				go func(w *Worker) {
					defer healthWg.Done()

					healthy, _ := w.CheckHealth(healthCtx)
					healthResults <- struct {
						id      int
						healthy bool
					}{w.ID, healthy}
				}(worker)
			}
			healthWg.Wait()
			close(healthResults)

			// Process results
			for result := range healthResults {
				if result.healthy {
					healthyWorkers[result.id] = true
					if verbose {
						fmt.Printf("[pool] Worker %d is healthy\n", result.id)
					}
				}
			}

			// Check if all workers are healthy
			if len(healthyWorkers) == p.maxWorkers {
				if verbose {
					fmt.Printf("[pool] All %d workers healthy\n", p.maxWorkers)
				}

				// Add all workers to available channel
				for _, w := range p.workers {
					w.mu.Lock()
					w.Status = StatusReady
					w.mu.Unlock()
					p.available <- w
				}

				return nil
			}

			// Wait before next poll
			select {
			case <-healthCtx.Done():
				continue
			case <-time.After(pollInterval):
			}
		}
	}
}

// Acquire gets an available worker from the pool.
// It blocks until a worker is available or the context/timeout expires.
// If the acquired worker's server is unhealthy, it will attempt to restart it.
func (p *WorkerPool) Acquire(ctx context.Context, timeout time.Duration, verbose bool) (*Worker, error) {
	acquireCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	select {
	case worker := <-p.available:
		worker.mu.Lock()
		worker.Status = StatusRunning
		worker.mu.Unlock()

		// Health check - ensure server is still responsive
		healthy, _ := worker.CheckHealth(ctx)
		if !healthy {
			if verbose {
				fmt.Printf("[pool] Worker %d unhealthy, attempting restart...\n", worker.ID)
			}

			// Restart the Hono server
			if err := p.restartWorkerServer(ctx, worker, verbose); err != nil {
				if verbose {
					fmt.Printf("[pool] Worker %d restart failed: %v\n", worker.ID, err)
				}
				// Put worker back and return error
				p.available <- worker
				return nil, fmt.Errorf("worker %d restart failed: %w", worker.ID, err)
			}
		}

		if verbose {
			fmt.Printf("[pool] Acquired worker %d\n", worker.ID)
		}

		return worker, nil

	case <-acquireCtx.Done():
		return nil, ErrWorkerNotAvailable
	}
}

// restartWorkerServer restarts the Hono server for a worker.
func (p *WorkerPool) restartWorkerServer(ctx context.Context, worker *Worker, verbose bool) error {
	// Send Ctrl+C to stop any running process
	if err := worker.TmuxSession.SendCommand("\x03", verbose); err != nil {
		// Ignore error, might not have a running process
	}

	// Wait a moment for the process to stop
	time.Sleep(500 * time.Millisecond)

	// Start Hono again
	if err := worker.StartHono(verbose); err != nil {
		return fmt.Errorf("failed to start Hono: %w", err)
	}

	// Wait for health
	healthTimeout := 30 * time.Second
	if err := worker.WaitReady(ctx, healthTimeout, verbose); err != nil {
		return fmt.Errorf("server not healthy after restart: %w", err)
	}

	if verbose {
		fmt.Printf("[pool] Worker %d restarted successfully\n", worker.ID)
	}

	return nil
}

// Release returns a worker to the pool for reuse.
func (p *WorkerPool) Release(w *Worker) {
	w.mu.Lock()
	w.Status = StatusReady
	w.mu.Unlock()

	p.available <- w
}

// Shutdown stops all workers and cleans up resources.
func (p *WorkerPool) Shutdown(ctx context.Context) error {
	p.mu.Lock()
	workers := make([]*Worker, len(p.workers))
	copy(workers, p.workers)
	p.mu.Unlock()

	// Stop all workers in parallel
	var wg sync.WaitGroup
	errChan := make(chan error, len(workers))

	for _, worker := range workers {
		wg.Add(1)
		go func(w *Worker) {
			defer wg.Done()

			if err := w.Stop(ctx); err != nil {
				errChan <- fmt.Errorf("worker %d: %w", w.ID, err)
			}
		}(worker)
	}
	wg.Wait()
	close(errChan)

	// Collect errors
	var errs []error
	for err := range errChan {
		errs = append(errs, err)
	}

	// Force kill any remaining processes on ports 9000-9007
	forceKillPorts()

	// Drain available channel
	close(p.available)
	for range p.available {
		// Drain remaining workers
	}

	if len(errs) > 0 {
		return fmt.Errorf("shutdown errors: %v", errs)
	}

	return nil
}

// forceKillPorts forcefully kills any processes listening on ports 9000-9007.
func forceKillPorts() {
	for port := 9000; port <= 9007; port++ {
		// Use fuser to find and kill processes on the port
		cmd := exec.Command("fuser", "-k", fmt.Sprintf("%d/tcp", port))
		_ = cmd.Run() // Ignore errors - port may not be in use
	}
}

// Workers returns a copy of the workers slice (for diagnostics).
func (p *WorkerPool) Workers() []*Worker {
	p.mu.Lock()
	defer p.mu.Unlock()

	workers := make([]*Worker, len(p.workers))
	copy(workers, p.workers)
	return workers
}

// HealthyCount returns the number of healthy workers in the pool.
func (p *WorkerPool) HealthyCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()

	count := 0
	for _, w := range p.workers {
		w.mu.Lock()
		if w.Status == StatusReady || w.Status == StatusRunning {
			count++
		}
		w.mu.Unlock()
	}
	return count
}

// AvailableCount returns the number of workers currently available for acquisition.
func (p *WorkerPool) AvailableCount() int {
	return len(p.available)
}
