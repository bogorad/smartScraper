import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { Hono } from "hono";
import { createSession } from "../../middleware/auth.js";
import { dashboardRouter } from "./index.js";
import {
  resetSitesRouteEngine,
  setSitesRouteEngine,
  sitesRouter,
} from "./sites.js";
import { statsRouter } from "./stats.js";

const mocks = vi.hoisted(() => {
  const site = {
    domainPattern: "example.com",
    xpathMainContent: "//article",
    failureCountSinceLastSuccess: 0,
  };

  return {
    resetStats: vi.fn(),
    saveConfig: vi.fn(),
    deleteConfig: vi.fn(),
    scrapeUrl: vi.fn(),
    validateScrapeTargetUrl: vi.fn(),
    site,
  };
});

vi.mock("../../config.js", () => ({
  getApiToken: () => "test-api-token",
  getNodeEnv: () => "test",
  getLogLevel: () => "NONE",
  getTrustProxyHeaders: () => false,
}));

vi.mock("../../services/stats-storage.js", () => ({
  loadStats: vi.fn().mockResolvedValue({
    scrapeTotal: 4,
    scrapeToday: 2,
    failTotal: 1,
    failToday: 0,
    todayDate: "2026-04-26",
    domainCounts: { "example.com": 4 },
  }),
  getTopDomains: vi
    .fn()
    .mockResolvedValue([
      { domain: "example.com", count: 4 },
    ]),
  resetStats: mocks.resetStats,
}));

vi.mock("../../services/log-storage.js", () => ({
  readTodayLogs: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../middleware/rate-limit.js", () => ({
  rateLimitMiddleware:
    () => async (_c: unknown, next: () => Promise<void>) =>
      next(),
}));

vi.mock("../../adapters/fs-known-sites.js", () => ({
  knownSitesAdapter: {
    getAllConfigs: vi.fn().mockResolvedValue([mocks.site]),
    getConfig: vi
      .fn()
      .mockImplementation((domain: string) => {
        return Promise.resolve(
          domain === "example.com" ? mocks.site : undefined,
        );
      }),
    saveConfig: mocks.saveConfig,
    deleteConfig: mocks.deleteConfig,
  },
}));

vi.mock("../../core/engine.js", () => ({
  getQueueStats: vi.fn().mockReturnValue({
    size: 0,
    active: 0,
    max: 1,
    activeUrls: [],
  }),
  workerEvents: {
    on: vi.fn(),
  },
  getDefaultEngine: () => {
    throw new Error("default engine should not be used");
  },
}));

vi.mock("../../utils/url.js", () => ({
  validateScrapeTargetUrl: mocks.validateScrapeTargetUrl,
}));

function buildApp(): Hono {
  const app = new Hono();

  app.post("/test-session", (c) => {
    createSession(c, "test-api-token");
    return c.text("OK");
  });

  app.route("/dashboard", dashboardRouter);
  app.route("/dashboard/sites", sitesRouter);
  app.route("/dashboard/stats", statsRouter);

  return app;
}

function readCookie(
  setCookie: string | null,
  name: string,
): string {
  if (!setCookie) {
    throw new Error(
      `Missing Set-Cookie header for ${name}`,
    );
  }

  const matches = Array.from(
    setCookie.matchAll(new RegExp(`${name}=([^;]+)`, "g")),
  );
  if (matches.length === 0) {
    throw new Error(`Missing ${name} cookie`);
  }

  return `${name}=${matches[matches.length - 1][1]}`;
}

async function createSessionCookie(
  app: Hono,
): Promise<string> {
  const res = await app.request("/test-session", {
    method: "POST",
  });
  return readCookie(
    res.headers.get("Set-Cookie"),
    "ss_session",
  );
}

async function getPageCsrf(
  app: Hono,
  path: string,
  sessionCookie: string,
  csrfCookie?: string,
) {
  const res = await app.request(path, {
    headers: {
      Cookie: csrfCookie
        ? `${sessionCookie}; ${csrfCookie}`
        : sessionCookie,
    },
  });
  const html = await res.text();
  const nextCsrfCookie = res.headers.get("Set-Cookie")
    ? readCookie(
        res.headers.get("Set-Cookie"),
        "csrf_token",
      )
    : csrfCookie;

  if (!nextCsrfCookie) {
    throw new Error("Missing csrf_token cookie");
  }

  const csrfToken = nextCsrfCookie.split("=")[1];

  return {
    res,
    html,
    csrfCookie: nextCsrfCookie,
    csrfToken,
  };
}

async function getFreshPageCsrf(
  app: Hono,
  path: string,
  sessionCookie: string,
) {
  const page = await getPageCsrf(app, path, sessionCookie);

  expect(page.res.headers.get("Set-Cookie")).toContain(
    "csrf_token=",
  );
  return page;
}

describe("dashboard CSRF coverage", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateScrapeTargetUrl.mockResolvedValue({
      safe: true,
    });
    setSitesRouteEngine({
      scrapeUrl: mocks.scrapeUrl,
    });
    app = buildApp();
  });

  afterEach(() => {
    resetSitesRouteEngine();
  });

  it.each([
    ["/dashboard", "Dashboard - SmartScraper"],
    ["/dashboard/sites", "Sites - SmartScraper"],
    ["/dashboard/sites/new", "New Site - SmartScraper"],
    [
      "/dashboard/sites/example.com",
      "example.com - SmartScraper",
    ],
    ["/dashboard/stats", "Stats - SmartScraper"],
  ])(
    "renders inherited HTMX CSRF headers for %s",
    async (path, title) => {
      const sessionCookie = await createSessionCookie(app);
      const { res, html, csrfToken } =
        await getFreshPageCsrf(app, path, sessionCookie);

      expect(res.status).toBe(200);
      expect(html).toContain(title);
      expect(html).toContain("hx-headers");
      expect(html).toContain("X-CSRF-Token");
      expect(html).toContain(csrfToken);
    },
  );

  it.each([
    ["/dashboard", "Dashboard - SmartScraper"],
    ["/dashboard/sites", "Sites - SmartScraper"],
    ["/dashboard/sites/new", "New Site - SmartScraper"],
    [
      "/dashboard/sites/example.com",
      "example.com - SmartScraper",
    ],
    ["/dashboard/stats", "Stats - SmartScraper"],
  ])(
    "renders no inline scripts or event handlers for %s",
    async (path, title) => {
      const sessionCookie = await createSessionCookie(app);
      const { res, html } = await getFreshPageCsrf(
        app,
        path,
        sessionCookie,
      );

      expect(res.status).toBe(200);
      expect(html).toContain(title);
      expect(html).not.toMatch(
        /<script(?![^>]*\bsrc=)[^>]*>/i,
      );
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    },
  );

  it("protects dashboard theme POST with CSRF", async () => {
    const sessionCookie = await createSessionCookie(app);
    const { csrfCookie, csrfToken } =
      await getFreshPageCsrf(
        app,
        "/dashboard",
        sessionCookie,
      );

    const invalid = await app.request("/dashboard/theme", {
      method: "POST",
      headers: {
        Cookie: `${sessionCookie}; ${csrfCookie}`,
      },
    });
    expect(invalid.status).toBe(403);

    const valid = await app.request("/dashboard/theme", {
      method: "POST",
      headers: {
        Cookie: `${sessionCookie}; ${csrfCookie}`,
        "X-CSRF-Token": csrfToken,
      },
    });
    expect(valid.status).toBe(200);
    expect(valid.headers.get("HX-Refresh")).toBe("true");
  });

  it("keeps existing dashboard CSRF tokens valid across GET requests", async () => {
    const sessionCookie = await createSessionCookie(app);
    const firstPage = await getFreshPageCsrf(
      app,
      "/dashboard",
      sessionCookie,
    );
    const secondPage = await getPageCsrf(
      app,
      "/dashboard/sites",
      sessionCookie,
      firstPage.csrfCookie,
    );

    expect(secondPage.res.status).toBe(200);
    expect(
      secondPage.res.headers.get("Set-Cookie"),
    ).toBeNull();
    expect(secondPage.html).toContain(firstPage.csrfToken);
    expect(secondPage.csrfToken).toBe(firstPage.csrfToken);

    const valid = await app.request("/dashboard/theme", {
      method: "POST",
      headers: {
        Cookie: `${sessionCookie}; ${firstPage.csrfCookie}`,
        "X-CSRF-Token": firstPage.csrfToken,
      },
    });
    expect(valid.status).toBe(200);
    expect(valid.headers.get("HX-Refresh")).toBe("true");
  });

  it("keeps SSE authenticated while exempting it from CSRF token cookies", async () => {
    const unauthenticated = await app.request(
      "/dashboard/events",
    );
    expect(unauthenticated.status).toBe(302);
    expect(
      unauthenticated.headers.get("Location"),
    ).toContain("/login");

    const sessionCookie = await createSessionCookie(app);
    const res = await app.request("/dashboard/events", {
      headers: {
        Cookie: sessionCookie,
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain(
      "text/event-stream",
    );
    expect(res.headers.get("Set-Cookie")).toBeNull();

    await res.body?.cancel();
  });

  it("protects stats reset POST with CSRF", async () => {
    const sessionCookie = await createSessionCookie(app);
    const { csrfCookie, csrfToken } =
      await getFreshPageCsrf(
        app,
        "/dashboard/stats",
        sessionCookie,
      );

    const invalid = await app.request(
      "/dashboard/stats/reset",
      {
        method: "POST",
        headers: {
          Cookie: `${sessionCookie}; ${csrfCookie}`,
        },
      },
    );
    expect(invalid.status).toBe(403);
    expect(mocks.resetStats).not.toHaveBeenCalled();

    const valid = await app.request(
      "/dashboard/stats/reset",
      {
        method: "POST",
        headers: {
          Cookie: `${sessionCookie}; ${csrfCookie}`,
          "X-CSRF-Token": csrfToken,
        },
      },
    );
    expect(valid.status).toBe(200);
    expect(valid.headers.get("HX-Refresh")).toBe("true");
    expect(mocks.resetStats).toHaveBeenCalledTimes(1);
  });

  it("protects site form, delete, and test POST/DELETE actions with CSRF", async () => {
    mocks.scrapeUrl.mockResolvedValue({
      success: true,
      xpath: "//article",
      data: "content",
    });

    const sessionCookie = await createSessionCookie(app);
    const { csrfCookie, csrfToken } =
      await getFreshPageCsrf(
        app,
        "/dashboard/sites/example.com",
        sessionCookie,
      );

    const invalidSave = await app.request(
      "/dashboard/sites/example.com",
      {
        method: "POST",
        headers: {
          Cookie: `${sessionCookie}; ${csrfCookie}`,
          "Content-Type":
            "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          domainPattern: "example.com",
          xpathMainContent: "//main",
        }),
      },
    );
    expect(invalidSave.status).toBe(403);
    expect(mocks.saveConfig).not.toHaveBeenCalled();

    const validSave = await app.request(
      "/dashboard/sites/example.com",
      {
        method: "POST",
        headers: {
          Cookie: `${sessionCookie}; ${csrfCookie}`,
          "Content-Type":
            "application/x-www-form-urlencoded",
          "X-CSRF-Token": csrfToken,
        },
        body: new URLSearchParams({
          domainPattern: "example.com",
          xpathMainContent: "//main",
          method: "chrome",
          captcha: "datadome",
          proxy: "datadome",
        }),
      },
    );
    expect(validSave.status).toBe(302);
    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
    expect(mocks.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "chrome",
        captcha: "datadome",
        proxy: "datadome",
        needsProxy: "datadome",
      }),
    );

    const validDelete = await app.request(
      "/dashboard/sites/example.com",
      {
        method: "DELETE",
        headers: {
          Cookie: `${sessionCookie}; ${csrfCookie}`,
          "X-CSRF-Token": csrfToken,
        },
      },
    );
    expect(validDelete.status).toBe(200);
    expect(mocks.deleteConfig).toHaveBeenCalledWith(
      "example.com",
    );

    const validTest = await app.request(
      "/dashboard/sites/example.com/test",
      {
        method: "POST",
        headers: {
          Cookie: `${sessionCookie}; ${csrfCookie}`,
          "Content-Type":
            "application/x-www-form-urlencoded",
          "X-CSRF-Token": csrfToken,
        },
        body: new URLSearchParams({
          testUrl: "https://example.com/story",
        }),
      },
    );
    expect(validTest.status).toBe(200);
    expect(mocks.scrapeUrl).toHaveBeenCalledWith(
      "https://example.com/story",
    );
  });

  it("blocks private-network dashboard test URLs before scraping", async () => {
    mocks.validateScrapeTargetUrl.mockResolvedValueOnce({
      safe: false,
      error:
        "Target URL resolves to a private or local network address",
    });

    const sessionCookie = await createSessionCookie(app);
    const { csrfCookie, csrfToken } =
      await getFreshPageCsrf(
        app,
        "/dashboard/sites/example.com",
        sessionCookie,
      );

    const res = await app.request(
      "/dashboard/sites/example.com/test",
      {
        method: "POST",
        headers: {
          Cookie: `${sessionCookie}; ${csrfCookie}`,
          "Content-Type":
            "application/x-www-form-urlencoded",
          "X-CSRF-Token": csrfToken,
        },
        body: new URLSearchParams({
          testUrl: "http://127.0.0.1:3000",
        }),
      },
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Failed");
    expect(html).toContain(
      "Target URL resolves to a private or local network address",
    );
    expect(mocks.scrapeUrl).not.toHaveBeenCalled();
  });

  it("posts the new site form to the dedicated create route", async () => {
    const sessionCookie = await createSessionCookie(app);
    const { html } = await getFreshPageCsrf(
      app,
      "/dashboard/sites/new",
      sessionCookie,
    );

    expect(html).toContain(
      'hx-post="/dashboard/sites/new"',
    );
  });

  it("creates a new site through the dedicated route", async () => {
    const sessionCookie = await createSessionCookie(app);
    const { csrfCookie, csrfToken } =
      await getFreshPageCsrf(
        app,
        "/dashboard/sites/new",
        sessionCookie,
      );

    const res = await app.request("/dashboard/sites/new", {
      method: "POST",
      headers: {
        Cookie: `${sessionCookie}; ${csrfCookie}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-CSRF-Token": csrfToken,
      },
      body: new URLSearchParams({
        domainPattern: "WWW.New-Site.example.",
        xpathMainContent: "//main",
        siteSpecificHeaders: "Accept-Language: en-US",
        method: "curl",
        captcha: "none",
        proxy: "none",
      }),
    });

    expect(res.status).toBe(302);
    expect(mocks.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        domainPattern: "new-site.example",
        xpathMainContent: "//main",
        siteSpecificHeaders: {
          "Accept-Language": "en-US",
        },
        method: "curl",
        captcha: "none",
        proxy: "none",
      }),
    );
  });

  it.each([
    [
      "bad domain",
      {
        domainPattern: "*.example.com",
        xpathMainContent: "//main",
      },
      "Domain must be a hostname",
    ],
    [
      "bad XPath",
      {
        domainPattern: "example.org",
        xpathMainContent: "main",
      },
      "XPath main content must start",
    ],
    [
      "bad headers",
      {
        domainPattern: "example.org",
        xpathMainContent: "//main",
        siteSpecificHeaders: "Accept-Language",
      },
      "Custom headers must use",
    ],
    [
      "bad strategy",
      {
        domainPattern: "example.org",
        xpathMainContent: "//main",
        method: "browser",
      },
      "Invalid method strategy",
    ],
  ])(
    "rejects invalid site save input: %s",
    async (_name, values, expectedMessage) => {
      const sessionCookie = await createSessionCookie(app);
      const { csrfCookie, csrfToken } =
        await getFreshPageCsrf(
          app,
          "/dashboard/sites/new",
          sessionCookie,
        );

      const res = await app.request(
        "/dashboard/sites/new",
        {
          method: "POST",
          headers: {
            Cookie: `${sessionCookie}; ${csrfCookie}`,
            "Content-Type":
              "application/x-www-form-urlencoded",
            "X-CSRF-Token": csrfToken,
          },
          body: new URLSearchParams(values),
        },
      );
      const html = await res.text();

      expect(res.status).toBe(400);
      expect(html).toContain(expectedMessage);
      expect(mocks.saveConfig).not.toHaveBeenCalled();
    },
  );
});
