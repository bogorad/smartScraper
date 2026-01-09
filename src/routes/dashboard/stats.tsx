import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { dashboardAuthMiddleware } from '../../middleware/auth.js';
import { Layout } from '../../components/layout.js';
import { StatsCard } from '../../components/stats-card.js';
import { loadStats, getTopDomains, resetStats } from '../../services/stats-storage.js';
import { readTodayLogs } from '../../services/log-storage.js';
import { formatDuration } from '../../utils/date.js';

export const statsRouter = new Hono();

statsRouter.use('/*', dashboardAuthMiddleware);

statsRouter.post('/reset', async (c) => {
  await resetStats();
  c.header('HX-Refresh', 'true');
  return c.body(null);
});

statsRouter.get('/', async (c) => {
  const theme = getCookie(c, 'theme') || 'light';
  const stats = await loadStats();
  const topDomains = await getTopDomains(10);
  const todayLogs = await readTodayLogs();

  const recentLogs = todayLogs.slice(-20).reverse();

  const successRate = stats.scrapeTotal > 0
    ? ((stats.scrapeTotal - stats.failTotal) / stats.scrapeTotal * 100).toFixed(1)
    : '0';

  const todaySuccessRate = stats.scrapeToday > 0
    ? ((stats.scrapeToday - stats.failToday) / stats.scrapeToday * 100).toFixed(1)
    : '0';

  return c.html(
    <Layout title="Stats - SmartScraper" activePath="/dashboard/stats" theme={theme}>
      <div class="flex justify-between items-center mb-4">
        <h1 class="mb-0">Statistics</h1>
        <button
          type="button"
          class="btn btn-danger btn-sm"
          hx-post="/dashboard/stats/reset"
          hx-swap="none"
        >
          Reset Stats
        </button>
      </div>

      <div class="stats-grid">
        <StatsCard title="Total Scrapes" value={stats.scrapeTotal} subtitle={`${successRate}% success`} />
        <StatsCard title="Today" value={stats.scrapeToday} subtitle={`${todaySuccessRate}% success`} />
        <StatsCard title="Total Failures" value={stats.failTotal} />
        <StatsCard title="Failed Today" value={stats.failToday} />
      </div>

      <div class="card">
        <div class="card-header">Top 10 Domains</div>
        {topDomains.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Domain</th>
                <th>Scrapes</th>
              </tr>
            </thead>
            <tbody>
              {topDomains.map((d, i) => (
                <tr>
                  <td class="text-muted">{i + 1}</td>
                  <td class="code">{d.domain}</td>
                  <td>{d.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="text-muted">No data yet.</p>
        )}
      </div>

      <div class="card">
        <div class="card-header">Recent Activity (Today)</div>
        {recentLogs.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Domain</th>
                <th>Status</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {recentLogs.map((log) => (
                <tr>
                  <td class="text-sm text-muted">{new Date(log.ts).toLocaleTimeString()}</td>
                  <td class="code">{log.domain}</td>
                  <td>
                    {log.success ? (
                      <span class="badge badge-success">OK</span>
                    ) : (
                      <span class="badge badge-error" title={log.error}>{log.errorType}</span>
                    )}
                  </td>
                  <td class="text-sm">{formatDuration(log.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="text-muted">No activity today.</p>
        )}
      </div>
    </Layout>
  );
});
