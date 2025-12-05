import { Hono } from 'hono';
import { dashboardAuthMiddleware } from '../../middleware/auth.js';
import { Layout } from '../../components/layout.js';
import { SiteRow } from '../../components/site-row.js';
import { SiteForm } from '../../components/site-form.js';
import { TestForm, TestResult } from '../../components/test-form.js';
import { knownSitesAdapter } from '../../adapters/fs-known-sites.js';
import { getDefaultEngine } from '../../core/engine.js';
import type { SiteConfig } from '../../domain/models.js';

export const sitesRouter = new Hono();

sitesRouter.use('/*', dashboardAuthMiddleware);

sitesRouter.get('/', async (c) => {
  const q = c.req.query('q')?.toLowerCase() || '';
  const sort = c.req.query('sort') || 'domain';

  let sites = await knownSitesAdapter.getAllConfigs();

  if (q) {
    sites = sites.filter(s => s.domainPattern.toLowerCase().includes(q));
  }

  sites.sort((a, b) => {
    switch (sort) {
      case 'failures':
        return b.failureCountSinceLastSuccess - a.failureCountSinceLastSuccess;
      case 'last':
        const aDate = a.lastSuccessfulScrapeTimestamp || '';
        const bDate = b.lastSuccessfulScrapeTimestamp || '';
        return bDate.localeCompare(aDate);
      default:
        return a.domainPattern.localeCompare(b.domainPattern);
    }
  });

  const isHtmx = c.req.header('HX-Request') === 'true';

  const tableContent = (
    <>
      <thead>
        <tr>
          <th hx-get="/dashboard/sites?sort=domain" hx-target="#sites-table" hx-push-url="true" style="cursor: pointer">
            Domain {sort === 'domain' && '↓'}
          </th>
          <th>XPath</th>
          <th hx-get="/dashboard/sites?sort=last" hx-target="#sites-table" hx-push-url="true" style="cursor: pointer">
            Last Success {sort === 'last' && '↓'}
          </th>
          <th hx-get="/dashboard/sites?sort=failures" hx-target="#sites-table" hx-push-url="true" style="cursor: pointer">
            Failures {sort === 'failures' && '↓'}
          </th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {sites.map(site => <SiteRow site={site} />)}
        {sites.length === 0 && (
          <tr>
            <td colSpan={5} class="text-muted text-center">No sites configured yet.</td>
          </tr>
        )}
      </tbody>
    </>
  );

  if (isHtmx) {
    return c.html(tableContent);
  }

  return c.html(
    <Layout title="Sites - SmartScraper" activePath="/dashboard/sites">
      <div class="flex justify-between items-center mb-4">
        <h1 class="mb-0">Site Configurations</h1>
        <a href="/dashboard/sites/new" class="btn btn-primary">Add Site</a>
      </div>

      <div class="card mb-4">
        <input
          type="search"
          name="q"
          placeholder="Search domains..."
          value={q}
          hx-get="/dashboard/sites"
          hx-trigger="keyup changed delay:300ms"
          hx-target="#sites-table"
          hx-push-url="true"
        />
      </div>

      <div class="card">
        <table id="sites-table">
          {tableContent}
        </table>
      </div>
    </Layout>
  );
});

sitesRouter.get('/new', (c) => {
  const emptySite: SiteConfig = {
    domainPattern: '',
    xpathMainContent: '',
    failureCountSinceLastSuccess: 0
  };

  return c.html(
    <Layout title="New Site - SmartScraper" activePath="/dashboard/sites">
      <h1>Add New Site</h1>
      <SiteForm site={emptySite} isNew={true} />
    </Layout>
  );
});

sitesRouter.get('/:domain', async (c) => {
  const domain = decodeURIComponent(c.req.param('domain'));
  const site = await knownSitesAdapter.getConfig(domain);

  if (!site) {
    return c.html(
      <Layout title="Not Found - SmartScraper" activePath="/dashboard/sites">
        <div class="alert alert-error">Site configuration not found: {domain}</div>
        <a href="/dashboard/sites" class="btn btn-secondary">Back to Sites</a>
      </Layout>
    );
  }

  return c.html(
    <Layout title={`${domain} - SmartScraper`} activePath="/dashboard/sites">
      <h1>Edit Site</h1>
      <SiteForm site={site} />
      <TestForm domain={domain} />
    </Layout>
  );
});

sitesRouter.post('/:domain', async (c) => {
  const domain = decodeURIComponent(c.req.param('domain'));
  const body = await c.req.parseBody();

  const actualDomain = (body.domainPattern as string) || domain;

  const headersText = body.siteSpecificHeaders as string || '';
  const siteSpecificHeaders: Record<string, string> = {};
  for (const line of headersText.split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      siteSpecificHeaders[key.trim()] = rest.join(':').trim();
    }
  }

  const cleanupText = body.siteCleanupClasses as string || '';
  const siteCleanupClasses = cleanupText.split('\n').map(s => s.trim()).filter(Boolean);

  const existingConfig = await knownSitesAdapter.getConfig(actualDomain);

  const config: SiteConfig = {
    domainPattern: actualDomain,
    xpathMainContent: body.xpathMainContent as string,
    failureCountSinceLastSuccess: existingConfig?.failureCountSinceLastSuccess || 0,
    lastSuccessfulScrapeTimestamp: existingConfig?.lastSuccessfulScrapeTimestamp,
    discoveredByLlm: existingConfig?.discoveredByLlm,
    siteSpecificHeaders: Object.keys(siteSpecificHeaders).length > 0 ? siteSpecificHeaders : undefined,
    siteCleanupClasses: siteCleanupClasses.length > 0 ? siteCleanupClasses : undefined,
    userAgent: (body.userAgent as string) || undefined
  };

  await knownSitesAdapter.saveConfig(config);

  const isHtmx = c.req.header('HX-Request') === 'true';
  if (isHtmx) {
    return c.html(
      <>
        <div class="alert alert-success mb-4">Configuration saved successfully.</div>
        <SiteForm site={config} />
      </>
    );
  }

  return c.redirect('/dashboard/sites');
});

sitesRouter.delete('/:domain', async (c) => {
  const domain = decodeURIComponent(c.req.param('domain'));
  await knownSitesAdapter.deleteConfig(domain);
  return c.html('');
});

sitesRouter.post('/:domain/test', async (c) => {
  const domain = decodeURIComponent(c.req.param('domain'));
  const body = await c.req.parseBody();
  const testUrl = body.testUrl as string;

  if (!testUrl) {
    return c.html(<TestResult success={false} message="Test URL is required" />);
  }

  try {
    const engine = getDefaultEngine();
    const startTime = Date.now();
    const result = await engine.scrapeUrl(testUrl);
    const duration = Date.now() - startTime;

    if (result.success) {
      const contentLength = typeof result.data === 'string' ? result.data.length : 0;
      return c.html(
        <TestResult
          success={true}
          message={`Extracted ${contentLength.toLocaleString()} characters in ${(duration / 1000).toFixed(1)}s`}
          details={`XPath: ${result.xpath}`}
        />
      );
    } else {
      return c.html(
        <TestResult
          success={false}
          message={`${result.errorType}: ${result.error}`}
        />
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.html(<TestResult success={false} message={message} />);
  }
});
