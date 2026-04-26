import { serve } from "@hono/node-server";
import type { Hono } from "hono";

import type { BrowserPort } from "./ports/index.js";
import { logger } from "./utils/logger.js";

export interface ShutdownOptions {
  browserAdapter: BrowserPort | null;
  cleanupInterval?: NodeJS.Timeout;
}

export async function shutdown(
  signal: string,
  options: ShutdownOptions,
): Promise<never> {
  logger.info(
    `[SHUTDOWN] Received ${signal}, closing browsers...`,
  );

  if (options.cleanupInterval) {
    clearInterval(options.cleanupInterval);
  }

  if (options.browserAdapter) {
    try {
      await options.browserAdapter.close();
      logger.info("[SHUTDOWN] All browsers closed");
    } catch (error) {
      logger.error(
        "[SHUTDOWN] Error closing browsers:",
        error,
      );
    }
  }

  await logger.shutdown();
  process.exit(0);
}

export function registerProcessHandlers(
  getShutdownOptions: () => ShutdownOptions,
): void {
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught Exception", { error }, "FATAL");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    const reasonStr =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : String(reason);
    const isBenignExtensionError =
      reasonStr.includes("TargetCloseError") &&
      reasonStr.includes("Extensions.loadUnpacked");

    if (isBenignExtensionError) {
      logger.warn(
        "Ignoring benign extension cleanup error during browser close",
        undefined,
        "PUPPETEER",
      );
      return;
    }

    logger.error(
      "Unhandled Rejection",
      { reason },
      "FATAL",
    );
    process.exit(1);
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM", getShutdownOptions());
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT", getShutdownOptions());
  });
}

export function startServer(app: Hono, port: number): void {
  logger.info(`[SERVER] Starting on port ${port}`);

  serve(
    {
      fetch: app.fetch,
      port,
      hostname: "0.0.0.0",
    },
    (info) => {
      logger.info(
        `[SERVER] Running at http://0.0.0.0:${info.port}`,
      );
    },
  );
}
