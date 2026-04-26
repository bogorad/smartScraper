import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";

import { VERSION } from "./constants.js";
import { scrapeRouter } from "./routes/api/scrape.js";
import { dashboardRouter } from "./routes/dashboard/index.js";
import { loginRouter } from "./routes/dashboard/login.js";
import { sitesRouter } from "./routes/dashboard/sites.js";
import { statsRouter } from "./routes/dashboard/stats.js";

export interface AppFactoryOptions {
  enableRequestLogger?: boolean;
}

export function createApp(
  options: AppFactoryOptions = {},
): Hono {
  const app = new Hono();
  const enableRequestLogger =
    options.enableRequestLogger ?? true;

  if (enableRequestLogger) {
    app.use("*", honoLogger());
  }

  app.use(
    "/htmx.min.js",
    serveStatic({ path: "./src/htmx.min.js" }),
  );
  app.use("/sse.js", serveStatic({ path: "./src/sse.js" }));

  app.get("/health", (c) => {
    return c.json({
      status: "alive",
      version: VERSION,
      timestamp: Date.now(),
    });
  });

  app.get("/api/version", (c) => {
    return c.json({ version: VERSION });
  });

  app.route("/api/scrape", scrapeRouter);

  app.route("/login", loginRouter);
  app.route("/dashboard", dashboardRouter);
  app.route("/dashboard/sites", sitesRouter);
  app.route("/dashboard/stats", statsRouter);

  app.get("/", (c) => c.redirect("/dashboard"));

  return app;
}
