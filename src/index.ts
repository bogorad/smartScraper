import { createApp } from "./app.js";
import { bootstrapApplication } from "./bootstrap.js";
import {
  startServer,
  registerProcessHandlers,
} from "./server.js";
import { logger } from "./utils/logger.js";
import type { RuntimeDependencies } from "./bootstrap.js";

export {
  scrapeUrl,
  getDefaultEngine,
} from "./core/engine.js";
export {
  METHODS,
  OUTPUT_TYPES,
  VERSION,
} from "./constants.js";

let runtimeDependencies: RuntimeDependencies | null = null;
let cleanupInterval: NodeJS.Timeout | undefined;

registerProcessHandlers(() => ({
  browserAdapter:
    runtimeDependencies?.browserAdapter ?? null,
  cleanupInterval,
}));

async function main() {
  const bootstrap = await bootstrapApplication();
  runtimeDependencies = bootstrap.dependencies;
  cleanupInterval = bootstrap.cleanupInterval;
  const app = createApp({
    engine: runtimeDependencies.engine,
  });

  startServer(app, bootstrap.port);
}

main().catch(async (error) => {
  logger.error("[FATAL] Startup failed:", error);
  await logger.shutdown();
  process.exit(1);
});
