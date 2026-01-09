import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { dashboardAuthMiddleware } from "../../middleware/auth.js";
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
}

const clients = new Set<Client>();

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
  max: number;
  activeUrls: string[];
}): string {
  const list =
    stats.activeUrls.length > 0
      ? `<ul style="margin: 0; padding-left: 16px;">${stats.activeUrls
          .map(
            (url) =>
              `<li class="code text-sm" style="word-break: break-all;">${escapeHtml(url)}</li>`,
          )
          .join("")}</ul>`
      : `<p class="text-muted text-sm" style="margin: 0;">No active scrapes</p>`;

  return `<div class="card-header">${stats.active} of ${stats.max} Workers</div>${list}`.replace(
    /\n/g,
    "",
  );
}

function broadcast(data: {
  active: number;
  max: number;
  activeUrls: string[];
}) {
  logger.debug(
    `[SSE] Broadcasting: active=${data.active}, urls=${JSON.stringify(data.activeUrls)}`,
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

workerEvents.on("change", (data) => {
  broadcast(data);
});

dashboardRouter.get("/events", async (c) => {
  let clientId: symbol | null = null;
  let keepaliveInterval: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      clientId = Symbol("client");
      clients.add({ controller, id: clientId });
      logger.debug(
        `[SSE] Client connected, total clients: ${clients.size}`,
      );

      const stats = getQueueStats();
      const html = renderWorkersHtml(stats);
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

  return c.html(
    <Layout
      title="Dashboard - SmartScraper"
      activePath="/dashboard"
      theme={theme}
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
        <div class="card-header">
          {queueStats.active} of {queueStats.max} Workers
        </div>
        {queueStats.activeUrls.length > 0 ? (
          <ul style="margin: 0; padding-left: 16px;">
            {queueStats.activeUrls.map((url) => (
              <li
                class="code text-sm"
                style="word-break: break-all;"
              >
                {url}
              </li>
            ))}
          </ul>
        ) : (
          <p class="text-muted text-sm" style="margin: 0;">
            No active scrapes
          </p>
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
