import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { dashboardAuthMiddleware } from "../../middleware/auth.js";
import { rateLimitMiddleware } from "../../middleware/rate-limit.js";
import { csrfMiddleware, getCsrfToken } from "../../middleware/csrf.js";
import { Layout } from "../../components/layout.js";
import { StatsCard } from "../../components/stats-card.js";
import {
  loadStats,
  getTopDomains,
} from "../../services/stats-storage.js";
import {
  getQueueStats,
  workerEvents,
} from "../../core/engine.js";
import { logger } from "../../utils/logger.js";

export const dashboardRouter = new Hono();

// Rate limit: 60 requests per minute per client (UI interactions)
dashboardRouter.use("/*", rateLimitMiddleware({ maxRequests: 60, windowMs: 60000 }));
dashboardRouter.use("/*", csrfMiddleware);
dashboardRouter.use("/*", dashboardAuthMiddleware);

dashboardRouter.post("/theme", (c) => {
  const current = getCookie(c, "theme") || "light";
  const next = current === "dark" ? "light" : "dark";

  logger.debug(
    `[THEME] Toggling theme. Current: ${current}, Next: ${next}`,
  );

  setCookie(c, "theme", next, {
    path: "/",
    maxAge: 31536000,
    secure: false,
    httpOnly: false,
  });

  c.header("HX-Refresh", "true");
  return c.body(null);
});

interface Client {
  controller: ReadableStreamDefaultController;
  id: symbol;
  connectedAt: number;
}

const clients = new Set<Client>();
const MAX_SSE_CLIENTS = 100;
const SSE_CONNECTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Periodic cleanup of stale connections
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const client of clients) {
    if (now - client.connectedAt > SSE_CONNECTION_TIMEOUT_MS) {
      clients.delete(client);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug(`[SSE] Cleaned up ${cleaned} stale connections`);
  }
}, 60000); // Run every minute

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderWorkersHtml(stats: {
  active: number;
  activeUrl?: string;
}): string {
  if (stats.active > 0) {
    if (stats.activeUrl) {
      return `<div class="card-header">Scraping</div><p class="code text-sm" style="margin: 0; word-break: break-all;">${escapeHtml(stats.activeUrl)}</p>`;
    }
    return `<div class="card-header">Status</div><p class="text-muted text-sm" style="margin: 0;">Starting...</p>`;
  }
  return `<div class="card-header">Status</div><p class="text-muted text-sm" style="margin: 0;">Idle</p>`;
}

function broadcast(data: {
  active: number;
  activeUrl?: string;
}) {
  logger.debug(
    `[SSE] Broadcasting: active=${data.active}, url=${data.activeUrl || 'none'}`,
  );
  const html = renderWorkersHtml(data);
  logger.debug(
    `[SSE] HTML length: ${html.length}, preview: ${html.substring(0, 200)}`,
  );
  const event = `event: workers\ndata: ${html}\n\n`;
  logger.debug(`[SSE] Sending to ${clients.size} clients`);
  for (const client of clients) {
    try {
      client.controller.enqueue(
        new TextEncoder().encode(event),
      );
    } catch (error) {
      logger.debug(
        `[SSE] Client disconnected, removing from broadcast list`,
      );
      clients.delete(client);
    }
  }
}

workerEvents.on("change", (data: { activeUrls: string[]; active: number }) => {
  broadcast({
    active: data.active,
    activeUrl: data.activeUrls.length > 0 ? data.activeUrls[0] : undefined,
  });
});

dashboardRouter.get("/events", async (c) => {
  // Check connection limit
  if (clients.size >= MAX_SSE_CLIENTS) {
    logger.warn(`[SSE] Connection limit reached: ${MAX_SSE_CLIENTS}`);
    return c.json({ error: 'Server connection limit reached' }, 503);
  }

  let clientId: symbol | null = null;
  let keepaliveInterval: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      clientId = Symbol("client");
      clients.add({ controller, id: clientId, connectedAt: Date.now() });
      logger.debug(
        `[SSE] Client connected, total clients: ${clients.size}`,
      );

      const stats = getQueueStats();
      const html = renderWorkersHtml({
        active: stats.active,
        activeUrl: stats.activeUrls.length > 0 ? stats.activeUrls[0] : undefined,
      });
      controller.enqueue(
        new TextEncoder().encode(
          `event: workers\ndata: ${html}\n\n`,
        ),
      );

      // Send keepalive every 30 seconds
      keepaliveInterval = setInterval(() => {
        try {
          controller.enqueue(
            new TextEncoder().encode(": keepalive\n\n"),
          );
        } catch {
          if (keepaliveInterval)
            clearInterval(keepaliveInterval);
        }
      }, 30000);
    },
    cancel() {
      if (keepaliveInterval)
        clearInterval(keepaliveInterval);
      if (clientId) {
        for (const client of clients) {
          if (client.id === clientId) {
            clients.delete(client);
            logger.debug(
              `[SSE] Client disconnected, total clients: ${clients.size}`,
            );
            break;
          }
        }
      }
    },
  });

  return c.newResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

dashboardRouter.get("/", async (c) => {
  const theme = getCookie(c, "theme") || "light";
  logger.debug(
    `[THEME] Rendering dashboard with theme: ${theme}`,
  );

  const stats = await loadStats();
  const topDomains = await getTopDomains(5);
  const queueStats = getQueueStats();

  const csrfToken = getCsrfToken(c);

  return c.html(
    <Layout
      title="Dashboard - SmartScraper"
      activePath="/dashboard"
      theme={theme}
      csrfToken={csrfToken}
    >
      <h1>Dashboard</h1>

      <div class="stats-grid" style="margin-bottom: 12px;">
        <StatsCard
          title="Total"
          value={stats.scrapeTotal}
        />
        <StatsCard
          title="Today"
          value={stats.scrapeToday}
        />
        <StatsCard title="Failed" value={stats.failTotal} />
        <StatsCard
          title="Failed Today"
          value={stats.failToday}
        />
      </div>

      <div
        class="card"
        style="margin-bottom: 16px;"
        hx-ext="sse"
        sse-connect="/dashboard/events"
        sse-swap="workers"
      >
        {queueStats.active > 0 && queueStats.activeUrls.length > 0 ? (
          <>
            <div class="card-header">Scraping</div>
            <p
              class="code text-sm"
              style="margin: 0; word-break: break-all;"
            >
              {queueStats.activeUrls[0]}
            </p>
          </>
        ) : queueStats.active > 0 ? (
          <>
            <div class="card-header">Status</div>
            <p class="text-muted text-sm" style="margin: 0;">
              Starting...
            </p>
          </>
        ) : (
          <>
            <div class="card-header">Status</div>
            <p class="text-muted text-sm" style="margin: 0;">
              Idle
            </p>
          </>
        )}
      </div>

      <div class="card">
        <div class="card-header">Top Domains</div>
        {topDomains.length > 0 ? (
          <ol>
            {topDomains.map((d) => (
              <li>
                <span class="code">{d.domain}</span>:{" "}
                {d.count.toLocaleString()} scrapes
              </li>
            ))}
          </ol>
        ) : (
          <p class="text-muted">No scrape data yet.</p>
        )}
      </div>
    </Layout>,
  );
});
