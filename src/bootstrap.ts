import fs from "fs";

import { CurlFetchAdapter } from "./adapters/curl-fetch.js";
import { knownSitesAdapter } from "./adapters/fs-known-sites.js";
import { OpenRouterLlmAdapter } from "./adapters/openrouter-llm.js";
import { PuppeteerBrowserAdapter } from "./adapters/puppeteer-browser.js";
import { TwoCaptchaAdapter } from "./adapters/twocaptcha.js";
import {
  getDataDir,
  getExecutablePath,
  getExtensionPaths,
  getPort,
  initConfig,
  loadDotenvConfig,
} from "./config.js";
import { VERSION } from "./constants.js";
import { initializeEngine } from "./core/engine.js";
import type { CoreScraperEngine } from "./core/engine.js";
import { cleanupOldLogs } from "./services/log-storage.js";
import { logger } from "./utils/logger.js";

export interface RuntimeDependencies {
  browserAdapter: PuppeteerBrowserAdapter;
  curlFetchAdapter: CurlFetchAdapter;
  engine: CoreScraperEngine;
}

export interface BootstrapResult {
  port: number;
  dependencies: RuntimeDependencies;
  cleanupInterval: NodeJS.Timeout;
}

export function createRuntimeDependencies(): RuntimeDependencies {
  const browserAdapter = new PuppeteerBrowserAdapter();
  const llmAdapter = new OpenRouterLlmAdapter();
  const captchaAdapter = new TwoCaptchaAdapter();
  const curlFetchAdapter = new CurlFetchAdapter();
  const engine = initializeEngine(
    browserAdapter,
    llmAdapter,
    captchaAdapter,
    knownSitesAdapter,
    curlFetchAdapter,
  );

  return { browserAdapter, curlFetchAdapter, engine };
}

export async function bootstrapApplication(): Promise<BootstrapResult> {
  loadDotenvConfig();
  const config = initConfig();
  const port = getPort();
  const dataDir = getDataDir();

  logger.info(
    `[CONFIG] Environment: ${config.nodeEnv}, Log Level: ${config.logLevel}`,
  );
  logger.info(`[APP] SmartScraper v${VERSION} starting...`);

  await fs.promises.mkdir(`${dataDir}/logs`, {
    recursive: true,
  });
  await logChromiumConfiguration();

  const dependencies = createRuntimeDependencies();

  await cleanupOldLogs();
  const cleanupInterval = setInterval(
    cleanupOldLogs,
    24 * 60 * 60 * 1000,
  );

  return { port, dependencies, cleanupInterval };
}

async function logChromiumConfiguration(): Promise<void> {
  const execPath = getExecutablePath();
  try {
    await fs.promises.access(execPath);
    logger.info(`[CHROMIUM] Found at: ${execPath}`);
  } catch {
    logger.warn(
      `[WARNING] Chromium executable not found at: ${execPath}`,
    );
  }

  const extensionPaths = getExtensionPaths();
  if (extensionPaths.length > 0) {
    logger.info(
      `[CHROMIUM] Extensions: ${extensionPaths.join(", ")}`,
    );
  }
}
