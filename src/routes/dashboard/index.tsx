import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { dashboardAuthMiddleware } from '../../middleware/auth.js';
import { Layout } from '../../components/layout.js';
import { StatsCard } from '../../components/stats-card.js';
import { loadStats, getTopDomains } from '../../services/stats-storage.js';
import { logger } from '../../utils/logger.js';

export const dashboardRouter = new Hono();

dashboardRouter.use('/*', dashboardAuthMiddleware);

dashboardRouter.post('/theme', (c) => {
  const current = getCookie(c, 'theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  
  logger.debug(`[THEME] Toggling theme. Current: ${current}, Next: ${next}`);
  
  setCookie(c, 'theme', next, { 
    path: '/', 
    maxAge: 31536000,
    secure: false, // Force false for dev/http
    httpOnly: false
  }); 
  
  c.header('HX-Refresh', 'true');
  return c.body(null);
});

dashboardRouter.get('/', async (c) => {
  const theme = getCookie(c, 'theme') || 'light';
  logger.debug(`[THEME] Rendering dashboard with theme: ${theme}`);
  
  const stats = await loadStats();
  const topDomains = await getTopDomains(5);

  return c.html(
    <Layout title="Dashboard - SmartScraper" activePath="/dashboard" theme={theme}>
      <h1>Dashboard</h1>

      <div class="stats-grid">
        <StatsCard title="Total Scrapes" value={stats.scrapeTotal} />
        <StatsCard title="Today" value={stats.scrapeToday} />
        <StatsCard title="Total Failures" value={stats.failTotal} />
        <StatsCard title="Failed Today" value={stats.failToday} />
      </div>

      <div class="card">
        <div class="card-header">Top Domains</div>
        {topDomains.length > 0 ? (
          <ol>
            {topDomains.map((d) => (
              <li>
                <span class="code">{d.domain}</span>: {d.count.toLocaleString()} scrapes
              </li>
            ))}
          </ol>
        ) : (
          <p class="text-muted">No scrape data yet.</p>
        )}
      </div>

      <div class="btn-group">
        <a href="/dashboard/sites" class="btn btn-primary">Manage Sites</a>
        <a href="/dashboard/stats" class="btn btn-secondary">View Stats</a>
      </div>
    </Layout>
  );
});
