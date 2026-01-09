import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger as honoLogger } from 'hono/logger';
import fs from 'fs';

import { initConfig, getPort, getDataDir, getExecutablePath, getExtensionPaths } from './config.js';
import { logger } from './utils/logger.js';
import { scrapeRouter } from './routes/api/scrape.js';
import { loginRouter } from './routes/dashboard/login.js';
import { dashboardRouter } from './routes/dashboard/index.js';
import { sitesRouter } from './routes/dashboard/sites.js';
import { statsRouter } from './routes/dashboard/stats.js';
import { cleanupOldLogs } from './services/log-storage.js';
import { initializeEngine, getDefaultEngine } from './core/engine.js';
import { PuppeteerBrowserAdapter } from './adapters/puppeteer-browser.js';
import { OpenRouterLlmAdapter } from './adapters/openrouter-llm.js';
import { TwoCaptchaAdapter } from './adapters/twocaptcha.js';
import { knownSitesAdapter } from './adapters/fs-known-sites.js';
import { VERSION } from './constants.js';

export { scrapeUrl, getDefaultEngine } from './core/engine.js';
export { METHODS, OUTPUT_TYPES, VERSION } from './constants.js';

let browserAdapter: PuppeteerBrowserAdapter | null = null;

process.on('uncaughtException', (error) => {
  logger.error('[FATAL] Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('[FATAL] Unhandled Rejection at:', promise, 'Reason:', reason);
  process.exit(1);
});

async function shutdown(signal: string) {
  logger.info(`[SHUTDOWN] Received ${signal}, closing browsers...`);
  if (browserAdapter) {
    try {
      await browserAdapter.close();
      logger.info('[SHUTDOWN] All browsers closed');
    } catch (error) {
      logger.error('[SHUTDOWN] Error closing browsers:', error);
    }
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const app = new Hono();

app.use('*', honoLogger());

app.use('/htmx.min.js', serveStatic({ path: './src/htmx.min.js' }));
app.use('/sse.js', serveStatic({ path: './src/sse.js' }));

app.get('/health', (c) => {
  return c.json({ status: 'alive', version: VERSION, timestamp: Date.now() });
});

app.get('/api/version', (c) => {
  return c.json({ version: VERSION });
});

app.route('/api/scrape', scrapeRouter);

app.route('/login', loginRouter);
app.route('/dashboard', dashboardRouter);
app.route('/dashboard/sites', sitesRouter);
app.route('/dashboard/stats', statsRouter);

app.get('/', (c) => c.redirect('/dashboard'));

async function main() {
  // Initialize and validate all configuration at startup
  initConfig();
  
  const PORT = getPort();
  const DATA_DIR = getDataDir();
  
  // Debug config propagation
  logger.info(`[CONFIG] Environment: ${initConfig().nodeEnv}, Log Level: ${initConfig().logLevel}`);
  logger.info(`[APP] SmartScraper v${VERSION} starting...`);

  await fs.promises.mkdir(`${DATA_DIR}/logs`, { recursive: true });

  const execPath = getExecutablePath();
  try {
    await fs.promises.access(execPath);
    logger.info(`[CHROMIUM] Found at: ${execPath}`);
  } catch {
    logger.warn(`[WARNING] Chromium executable not found at: ${execPath}`);
  }

  const extensionPaths = getExtensionPaths();
  if (extensionPaths.length > 0) {
    logger.info(`[CHROMIUM] Extensions: ${extensionPaths.join(', ')}`);
  }

  browserAdapter = new PuppeteerBrowserAdapter();

  initializeEngine(
    browserAdapter,
    new OpenRouterLlmAdapter(),
    new TwoCaptchaAdapter(),
    knownSitesAdapter
  );

  await cleanupOldLogs();
  setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);

  logger.info(`[SERVER] Starting on port ${PORT}`);

  serve({
    fetch: app.fetch,
    port: PORT,
    hostname: '0.0.0.0'
  }, (info) => {
    logger.info(`[SERVER] Running at http://0.0.0.0:${info.port}`);
  });
}

main().catch((error) => {
  logger.error('[FATAL] Startup failed:', error);
  process.exit(1);
});
