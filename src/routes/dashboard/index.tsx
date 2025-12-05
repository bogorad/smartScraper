import { Hono } from 'hono';
import { dashboardAuthMiddleware } from '../../middleware/auth.js';
import { Layout } from '../../components/layout.js';
import { StatsCard } from '../../components/stats-card.js';
import { loadStats, getTopDomains } from '../../services/stats-storage.js';

export const dashboardRouter = new Hono();

dashboardRouter.use('/*', dashboardAuthMiddleware);

dashboardRouter.get('/', async (c) => {
  const stats = await loadStats();
  const topDomains = await getTopDomains(5);

  return c.html(
    <Layout title="Dashboard - SmartScraper" activePath="/dashboard">
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
