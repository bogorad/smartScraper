# ADR-015: Real-time Dashboard Updates (SSE + HTMX)

- Status: Accepted
- Date: 2026-01-09
- Updated: 2026-02-05

## Context

The SmartScraper dashboard needs to provide real-time visibility into the current scraping status. Users need to see when a scrape is in progress and which URL is being processed without manually refreshing the page.

## Decision

We chose to implement real-time updates using **Server-Sent Events (SSE)** combined with **HTMX**. This approach aligns with our goal of zero custom client-side JavaScript.

### Key Components

1.  **Server-Side Events**:
    -   The `CoreScraperEngine` emits events via a Node.js `EventEmitter` whenever a scrape starts or ends.
    -   A dedicated SSE route (`/dashboard/events`) maintains a pool of connected clients.
    -   When worker status changes, the server renders an HTML fragment and broadcasts it to all connected clients.

2.  **SSE Protocol**:
    -   Uses named events (`event: workers`).
    -   Data is pushed as raw HTML fragments.
    -   Includes a `: keepalive\n\n` heartbeat every 30 seconds to prevent connection drops by proxies/load balancers.

3.  **HTMX Integration**:
    -   Uses the HTMX SSE extension (`sse.js`).
    -   Markup: `<div hx-ext="sse" sse-connect="/dashboard/events" sse-swap="workers">`.
    -   No custom JavaScript is required on the client; HTMX automatically handles the EventSource connection and DOM swapping.

4.  **Security & Robustness**:
    -   All URLs and dynamic data in the SSE stream are HTML-escaped to prevent XSS.
    -   HTMX is configured with a 5-minute auto-refresh fallback on the body tag for long-lived tabs.

## Consequences

### Benefits

-   **Zero Client JS**: Leverages standard HTMX patterns for real-time interactivity.
-   **Low Latency**: Server pushes updates immediately when state changes occur in the engine.
-   **Efficient**: Single persistent connection per dashboard tab is less resource-intensive than aggressive polling.
-   **Granular**: Specific DOM elements can be updated independently via named events.

### Trade-offs

-   **Persistent Connections**: Server must maintain open HTTP connections for each dashboard user.
-   **Complexity**: Requires careful management of the SSE stream (heartbeats, client cleanup on disconnect).

### Implementation Requirements

-   `src/htmx.min.js` and `src/sse.js` must be served as static assets.
-   The dashboard layout must include both scripts.
-   Hono JSX is used for server-side rendering of the push fragments.
