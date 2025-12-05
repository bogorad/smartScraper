import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import fs from 'fs';

import { scrapeRouter } from './routes/api/scrape.js';
import { loginRouter } from './routes/dashboard/login.js';
import { dashboardRouter } from './routes/dashboard/index.js';
import { sitesRouter } from './routes/dashboard/sites.js';
import { statsRouter } from './routes/dashboard/stats.js';
import { cleanupOldLogs } from './services/log-storage.js';
import { initializeEngine } from './core/engine.js';
import { PuppeteerBrowserAdapter } from './adapters/puppeteer-browser.js';
import { OpenRouterLlmAdapter } from './adapters/openrouter-llm.js';
import { TwoCaptchaAdapter } from './adapters/twocaptcha.js';
import { knownSitesAdapter } from './adapters/fs-known-sites.js';
import { VERSION } from './constants.js';

export { scrapeUrl, getDefaultEngine } from './core/engine.js';
export { METHODS, OUTPUT_TYPES, VERSION } from './constants.js';

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'Reason:', reason);
  process.exit(1);
});

const app = new Hono();

app.use('*', logger());

app.use('/htmx.min.js', serveStatic({ path: './src/htmx.min.js' }));

app.get('/health', (c) => {
  return c.json({ status: 'alive', version: VERSION, timestamp: Date.now() });
});

app.route('/api/scrape', scrapeRouter);

app.route('/login', loginRouter);
app.route('/dashboard', dashboardRouter);
app.route('/dashboard/sites', sitesRouter);
app.route('/dashboard/stats', statsRouter);

app.get('/', (c) => c.redirect('/dashboard'));

async function main() {
  const PORT = Number(process.env.PORT) || 5555;
  const DATA_DIR = process.env.DATA_DIR || './data';

  await fs.promises.mkdir(`${DATA_DIR}/logs`, { recursive: true });

  const execPath = process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium';
  try {
    await fs.promises.access(execPath);
    console.log(`[CHROMIUM] Found at: ${execPath}`);
  } catch {
    console.warn(`[WARNING] Chromium executable not found at: ${execPath}`);
  }

  if (process.env.EXTENSION_PATHS) {
    console.log(`[CHROMIUM] Extensions: ${process.env.EXTENSION_PATHS}`);
  }

  initializeEngine(
    new PuppeteerBrowserAdapter(),
    new OpenRouterLlmAdapter(),
    new TwoCaptchaAdapter(),
    knownSitesAdapter
  );

  await cleanupOldLogs();
  setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);

  console.log(`[SERVER] Starting on port ${PORT}`);

  serve({
    fetch: app.fetch,
    port: PORT,
    hostname: '0.0.0.0'
  }, (info) => {
    console.log(`[SERVER] Running at http://0.0.0.0:${info.port}`);
  });
}

main().catch((error) => {
  console.error('[FATAL] Startup failed:', error);
  process.exit(1);
});
