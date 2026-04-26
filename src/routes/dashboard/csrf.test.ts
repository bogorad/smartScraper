import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createSession } from '../../middleware/auth.js';
import { dashboardRouter } from './index.js';
import { sitesRouter } from './sites.js';
import { statsRouter } from './stats.js';

const mocks = vi.hoisted(() => {
  const site = {
    domainPattern: 'example.com',
    xpathMainContent: '//article',
    failureCountSinceLastSuccess: 0
  };

  return {
    resetStats: vi.fn(),
    saveConfig: vi.fn(),
    deleteConfig: vi.fn(),
    scrapeUrl: vi.fn(),
    site
  };
});

vi.mock('../../config.js', () => ({
  getApiToken: () => 'test-api-token',
  getNodeEnv: () => 'test',
  getLogLevel: () => 'NONE'
}));

vi.mock('../../services/stats-storage.js', () => ({
  loadStats: vi.fn().mockResolvedValue({
    scrapeTotal: 4,
    scrapeToday: 2,
    failTotal: 1,
    failToday: 0,
    todayDate: '2026-04-26',
    domainCounts: { 'example.com': 4 }
  }),
  getTopDomains: vi.fn().mockResolvedValue([{ domain: 'example.com', count: 4 }]),
  resetStats: mocks.resetStats
}));

vi.mock('../../services/log-storage.js', () => ({
  readTodayLogs: vi.fn().mockResolvedValue([])
}));

vi.mock('../../adapters/fs-known-sites.js', () => ({
  knownSitesAdapter: {
    getAllConfigs: vi.fn().mockResolvedValue([mocks.site]),
    getConfig: vi.fn().mockImplementation((domain: string) => {
      return Promise.resolve(domain === 'example.com' ? mocks.site : undefined);
    }),
    saveConfig: mocks.saveConfig,
    deleteConfig: mocks.deleteConfig
  }
}));

vi.mock('../../core/engine.js', () => ({
  getQueueStats: vi.fn().mockReturnValue({
    size: 0,
    active: 0,
    max: 1,
    activeUrls: []
  }),
  workerEvents: {
    on: vi.fn()
  },
  getDefaultEngine: () => ({
    scrapeUrl: mocks.scrapeUrl
  })
}));

function buildApp(): Hono {
  const app = new Hono();

  app.post('/test-session', (c) => {
    createSession(c, 'test-api-token');
    return c.text('OK');
  });

  app.route('/dashboard', dashboardRouter);
  app.route('/dashboard/sites', sitesRouter);
  app.route('/dashboard/stats', statsRouter);

  return app;
}

function readCookie(setCookie: string | null, name: string): string {
  if (!setCookie) {
    throw new Error(`Missing Set-Cookie header for ${name}`);
  }

  const matches = Array.from(setCookie.matchAll(new RegExp(`${name}=([^;]+)`, 'g')));
  if (matches.length === 0) {
    throw new Error(`Missing ${name} cookie`);
  }

  return `${name}=${matches[matches.length - 1][1]}`;
}

async function createSessionCookie(app: Hono): Promise<string> {
  const res = await app.request('/test-session', { method: 'POST' });
  return readCookie(res.headers.get('Set-Cookie'), 'ss_session');
}

async function getPageCsrf(app: Hono, path: string, sessionCookie: string) {
  const res = await app.request(path, {
    headers: {
      Cookie: sessionCookie
    }
  });
  const html = await res.text();
  const csrfCookie = readCookie(res.headers.get('Set-Cookie'), 'csrf_token');
  const csrfToken = csrfCookie.split('=')[1];

  return { res, html, csrfCookie, csrfToken };
}

describe('dashboard CSRF coverage', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it.each([
    ['/dashboard', 'Dashboard - SmartScraper'],
    ['/dashboard/sites', 'Sites - SmartScraper'],
    ['/dashboard/sites/new', 'New Site - SmartScraper'],
    ['/dashboard/sites/example.com', 'example.com - SmartScraper'],
    ['/dashboard/stats', 'Stats - SmartScraper']
  ])('renders inherited HTMX CSRF headers for %s', async (path, title) => {
    const sessionCookie = await createSessionCookie(app);
    const { res, html, csrfToken } = await getPageCsrf(app, path, sessionCookie);

    expect(res.status).toBe(200);
    expect(html).toContain(title);
    expect(html).toContain('hx-headers');
    expect(html).toContain('X-CSRF-Token');
    expect(html).toContain(csrfToken);
  });

  it('protects dashboard theme POST with CSRF', async () => {
    const sessionCookie = await createSessionCookie(app);
    const { csrfCookie, csrfToken } = await getPageCsrf(app, '/dashboard', sessionCookie);

    const invalid = await app.request('/dashboard/theme', {
      method: 'POST',
      headers: {
        Cookie: `${sessionCookie}; ${csrfCookie}`
      }
    });
    expect(invalid.status).toBe(403);

    const valid = await app.request('/dashboard/theme', {
      method: 'POST',
      headers: {
        Cookie: `${sessionCookie}; ${csrfCookie}`,
        'X-CSRF-Token': csrfToken
      }
    });
    expect(valid.status).toBe(200);
    expect(valid.headers.get('HX-Refresh')).toBe('true');
  });

  it('protects stats reset POST with CSRF', async () => {
    const sessionCookie = await createSessionCookie(app);
    const { csrfCookie, csrfToken } = await getPageCsrf(app, '/dashboard/stats', sessionCookie);

    const invalid = await app.request('/dashboard/stats/reset', {
      method: 'POST',
      headers: {
        Cookie: `${sessionCookie}; ${csrfCookie}`
      }
    });
    expect(invalid.status).toBe(403);
    expect(mocks.resetStats).not.toHaveBeenCalled();

    const valid = await app.request('/dashboard/stats/reset', {
      method: 'POST',
      headers: {
        Cookie: `${sessionCookie}; ${csrfCookie}`,
        'X-CSRF-Token': csrfToken
      }
    });
    expect(valid.status).toBe(200);
    expect(valid.headers.get('HX-Refresh')).toBe('true');
    expect(mocks.resetStats).toHaveBeenCalledTimes(1);
  });

  it('protects site form, delete, and test POST/DELETE actions with CSRF', async () => {
    mocks.scrapeUrl.mockResolvedValue({
      success: true,
      xpath: '//article',
      data: 'content'
    });

    const sessionCookie = await createSessionCookie(app);
    const { csrfCookie, csrfToken } = await getPageCsrf(app, '/dashboard/sites/example.com', sessionCookie);

    const invalidSave = await app.request('/dashboard/sites/example.com', {
      method: 'POST',
      headers: {
        Cookie: `${sessionCookie}; ${csrfCookie}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        domainPattern: 'example.com',
        xpathMainContent: '//main'
      })
    });
    expect(invalidSave.status).toBe(403);
    expect(mocks.saveConfig).not.toHaveBeenCalled();

    const validSave = await app.request('/dashboard/sites/example.com', {
      method: 'POST',
      headers: {
        Cookie: `${sessionCookie}; ${csrfCookie}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRF-Token': csrfToken
      },
      body: new URLSearchParams({
        domainPattern: 'example.com',
        xpathMainContent: '//main'
      })
    });
    expect(validSave.status).toBe(302);
    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);

    const validDelete = await app.request('/dashboard/sites/example.com', {
      method: 'DELETE',
      headers: {
        Cookie: `${sessionCookie}; ${csrfCookie}`,
        'X-CSRF-Token': csrfToken
      }
    });
    expect(validDelete.status).toBe(200);
    expect(mocks.deleteConfig).toHaveBeenCalledWith('example.com');

    const validTest = await app.request('/dashboard/sites/example.com/test', {
      method: 'POST',
      headers: {
        Cookie: `${sessionCookie}; ${csrfCookie}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRF-Token': csrfToken
      },
      body: new URLSearchParams({
        testUrl: 'https://example.com/story'
      })
    });
    expect(validTest.status).toBe(200);
    expect(mocks.scrapeUrl).toHaveBeenCalledWith('https://example.com/story');
  });
});
