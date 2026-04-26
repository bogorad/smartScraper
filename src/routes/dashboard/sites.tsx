import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getCsrfToken } from "../../middleware/csrf.js";
import { Layout } from "../../components/layout.js";
import { SiteRow } from "../../components/site-row.js";
import { SiteForm } from "../../components/site-form.js";
import {
  TestForm,
  TestResult,
} from "../../components/test-form.js";
import { knownSitesAdapter } from "../../adapters/fs-known-sites.js";
import { getDefaultEngine } from "../../core/engine.js";
import type {
  SiteConfig,
  SiteConfigCaptcha,
  SiteConfigMethod,
  SiteConfigProxy,
} from "../../domain/models.js";
import { logger } from "../../utils/logger.js";
import { applyDashboardRoutePolicy } from "./policy.js";

// Query parameter validation schema
const querySchema = z.object({
  q: z.string().optional().default(""),
  sort: z
    .enum(["domain", "failures", "last"])
    .optional()
    .default("domain"),
  limit: z
    .union([
      z.literal("all"),
      z.coerce.number().int().min(1).max(100),
    ])
    .optional()
    .default(10),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .default(1),
});

export const sitesRouter = new Hono();

applyDashboardRoutePolicy(sitesRouter);

const siteConfigMethods = new Set<SiteConfigMethod>([
  "curl",
  "chrome",
]);

const siteConfigCaptchas = new Set<SiteConfigCaptcha>([
  "none",
  "datadome",
  "recaptcha",
  "turnstile",
  "hcaptcha",
  "unsupported",
]);

const siteConfigProxies = new Set<SiteConfigProxy>([
  "none",
  "default",
  "datadome",
]);

function parseOptionalStrategy<T extends string>(
  value:
    | FormDataEntryValue
    | FormDataEntryValue[]
    | undefined,
  allowed: ReadonlySet<T>,
  fieldName: string,
): T | undefined {
  if (typeof value !== "string" || value === "") {
    return undefined;
  }

  if (!allowed.has(value as T)) {
    throw new Error(`Invalid ${fieldName}.`);
  }

  return value as T;
}

function normalizeSubmittedDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function validateDomain(domain: string): string | null {
  if (!domain) return "Domain is required.";
  if (domain.includes("*") || domain.includes("/")) {
    return "Domain must be a hostname without wildcards or paths.";
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) {
    return "Domain must be a valid hostname such as example.com.";
  }
  return null;
}

function validateXPath(xpath: string): string | null {
  if (!xpath) return "XPath main content is required.";
  if (!xpath.startsWith("/")) {
    return "XPath main content must start with / or //.";
  }
  return null;
}

function parseHeaders(headersText: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of headersText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error("Custom headers must use Name: Value format.");
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || !value) {
      throw new Error("Custom headers must include a valid name and value.");
    }
    headers[key] = value;
  }

  return headers;
}

function renderSiteFormError(
  c: Context,
  site: SiteConfig,
  message: string,
  isNew: boolean,
) {
  return c.html(
    <>
      <div class="alert alert-error mb-4">{message}</div>
      <SiteForm site={site} isNew={isNew} />
    </>,
    400,
  );
}

sitesRouter.get(
  "/",
  zValidator("query", querySchema),
  async (c) => {
    const theme = getCookie(c, "theme") || "light";
    const csrfToken = getCsrfToken(c);
    logger.debug(`[SITES] Page render theme: ${theme}`);
    const query = c.req.valid("query");
    const q = query.q.toLowerCase();
    const sort = query.sort;
    const limit = query.limit;
    const page = query.page;

    let sites = await knownSitesAdapter.getAllConfigs();
    logger.debug(
      `[SITES] Initial count: ${sites.length}, Query: "${q}", Limit: ${limit}, Page: ${page}`,
    );

    if (q) {
      sites = sites.filter((s) =>
        s.domainPattern.toLowerCase().includes(q),
      );
      logger.debug(
        `[SITES] Count after filter: ${sites.length}`,
      );
    }

    sites.sort((a, b) => {
      switch (sort) {
        case "failures":
          return (
            b.failureCountSinceLastSuccess -
            a.failureCountSinceLastSuccess
          );
        case "last":
          const aDate =
            a.lastSuccessfulScrapeTimestamp || "";
          const bDate =
            b.lastSuccessfulScrapeTimestamp || "";
          return bDate.localeCompare(aDate);
        default:
          return a.domainPattern.localeCompare(
            b.domainPattern,
          );
      }
    });

    // Pagination logic
    const totalSites = sites.length;
    const limitNum = limit === "all" ? totalSites : limit;
    const totalPages =
      limit === "all"
        ? 1
        : Math.ceil(totalSites / limitNum);
    const startIndex = (page - 1) * limitNum;
    const endIndex =
      limit === "all"
        ? totalSites
        : Math.min(startIndex + limitNum, totalSites);
    const paginatedSites = sites.slice(
      startIndex,
      endIndex,
    );

    logger.debug(
      `[SITES] Displaying ${paginatedSites.length} sites (Index ${startIndex} to ${endIndex})`,
    );

    const isHtmx = c.req.header("HX-Request") === "true";

    const tableContent = (
      <>
        <thead>
          <tr>
            <th
              hx-get={`/dashboard/sites?sort=domain&limit=${limit}&q=${encodeURIComponent(q)}&page=${page}`}
              hx-target="#sites-container"
              hx-push-url="true"
              style="cursor: pointer"
            >
              Domain {sort === "domain" && "↓"}
            </th>
            <th>XPath</th>
            <th
              hx-get={`/dashboard/sites?sort=last&limit=${limit}&q=${encodeURIComponent(q)}&page=${page}`}
              hx-target="#sites-container"
              hx-push-url="true"
              style="cursor: pointer"
            >
              Last Success {sort === "last" && "↓"}
            </th>
            <th
              hx-get={`/dashboard/sites?sort=failures&limit=${limit}&q=${encodeURIComponent(q)}&page=${page}`}
              hx-target="#sites-container"
              hx-push-url="true"
              style="cursor: pointer"
            >
              Failures {sort === "failures" && "↓"}
            </th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {paginatedSites.map((site) => (
            <SiteRow site={site} />
          ))}
          {paginatedSites.length === 0 && (
            <tr>
              <td
                colSpan={5}
                class="text-muted text-center"
              >
                No sites configured yet.
              </td>
            </tr>
          )}
        </tbody>
      </>
    );

    if (isHtmx) {
      return c.html(
        <div id="sites-container">
          <div class="card">
            <table id="sites-table">{tableContent}</table>
          </div>

          {totalPages > 1 && (
            <div class="card">
              <div class="flex justify-between items-center">
                <div class="text-sm text-muted">
                  Showing {startIndex + 1} to {endIndex} of{" "}
                  {totalSites} sites
                </div>
                <div class="btn-group gap-2">
                  {page > 1 && (
                    <a
                      href={`/dashboard/sites?page=${page - 1}&limit=${limit}&q=${encodeURIComponent(q)}&sort=${sort}`}
                      hx-get={`/dashboard/sites?page=${page - 1}&limit=${limit}&q=${encodeURIComponent(q)}&sort=${sort}`}
                      hx-target="#sites-container"
                      hx-push-url="true"
                      class="btn btn-secondary btn-sm"
                    >
                      ← Previous
                    </a>
                  )}

                  <span class="text-sm text-muted">
                    Page {page} of {totalPages}
                  </span>

                  {page < totalPages && (
                    <a
                      href={`/dashboard/sites?page=${page + 1}&limit=${limit}&q=${encodeURIComponent(q)}&sort=${sort}`}
                      hx-get={`/dashboard/sites?page=${page + 1}&limit=${limit}&q=${encodeURIComponent(q)}&sort=${sort}`}
                      hx-target="#sites-container"
                      hx-push-url="true"
                      class="btn btn-secondary btn-sm"
                    >
                      Next →
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>,
      );
    }

    return c.html(
      <Layout
        title="Sites - SmartScraper"
        activePath="/dashboard/sites"
        theme={theme}
        csrfToken={csrfToken}
      >
        <div class="flex justify-between items-center mb-4">
          <h1 class="mb-0">Site Configurations</h1>
          <a
            href="/dashboard/sites/new"
            class="btn btn-primary"
          >
            Add Site
          </a>
        </div>

        <div class="card mb-4">
          <form
            hx-get="/dashboard/sites"
            hx-target="#sites-container"
            hx-push-url="true"
          >
            <div class="flex gap-4 items-center">
              <input
                type="search"
                name="q"
                placeholder="Search domains..."
                value={q}
                hx-get="/dashboard/sites"
                hx-target="#sites-container"
                hx-push-url="true"
                hx-include="closest form"
                hx-trigger="keyup changed delay:300ms, search"
                style="flex: 1"
              />
              <input
                type="hidden"
                name="sort"
                value={sort}
              />
              <input type="hidden" name="page" value="1" />
              <div class="limit-selector">
                <label>Show:</label>
                <select
                  name="limit"
                  value={limit}
                  class="mb-0"
                  hx-get="/dashboard/sites"
                  hx-target="#sites-container"
                  hx-push-url="true"
                  hx-include="closest form"
                  hx-trigger="change"
                  style="width: auto"
                >
                  <option value="10">10</option>
                  <option value="50">50</option>
                  <option value="all">All</option>
                </select>
              </div>
            </div>
          </form>
        </div>

        <div id="sites-container">
          <div class="card">
            <table id="sites-table">{tableContent}</table>
          </div>

          {totalPages > 1 && (
            <div class="card">
              <div class="flex justify-between items-center">
                <div class="text-sm text-muted">
                  Showing {startIndex + 1} to {endIndex} of{" "}
                  {totalSites} sites
                </div>
                <div class="btn-group gap-2">
                  {page > 1 && (
                    <a
                      href={`/dashboard/sites?page=${page - 1}&limit=${limit}&q=${encodeURIComponent(q)}&sort=${sort}`}
                      hx-get={`/dashboard/sites?page=${page - 1}&limit=${limit}&q=${encodeURIComponent(q)}&sort=${sort}`}
                      hx-target="#sites-container"
                      hx-push-url="true"
                      class="btn btn-secondary btn-sm"
                    >
                      ← Previous
                    </a>
                  )}

                  <span class="text-sm text-muted">
                    Page {page} of {totalPages}
                  </span>

                  {page < totalPages && (
                    <a
                      href={`/dashboard/sites?page=${page + 1}&limit=${limit}&q=${encodeURIComponent(q)}&sort=${sort}`}
                      hx-get={`/dashboard/sites?page=${page + 1}&limit=${limit}&q=${encodeURIComponent(q)}&sort=${sort}`}
                      hx-target="#sites-container"
                      hx-push-url="true"
                      class="btn btn-secondary btn-sm"
                    >
                      Next →
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </Layout>,
    );
  },
);

sitesRouter.get("/new", (c) => {
  const theme = getCookie(c, "theme") || "light";
  const csrfToken = getCsrfToken(c);
  const emptySite: SiteConfig = {
    domainPattern: "",
    xpathMainContent: "",
    failureCountSinceLastSuccess: 0,
  };

  return c.html(
    <Layout
      title="New Site - SmartScraper"
      activePath="/dashboard/sites"
      theme={theme}
      csrfToken={csrfToken}
    >
      <h1>Add New Site</h1>
      <SiteForm site={emptySite} isNew={true} />
    </Layout>,
  );
});

sitesRouter.get("/:domain", async (c) => {
  const theme = getCookie(c, "theme") || "light";
  const csrfToken = getCsrfToken(c);
  const domain = decodeURIComponent(c.req.param("domain"));
  const site = await knownSitesAdapter.getConfig(domain);

  if (!site) {
    return c.html(
      <Layout
        title="Not Found - SmartScraper"
        activePath="/dashboard/sites"
        theme={theme}
        csrfToken={csrfToken}
      >
        <div class="alert alert-error">
          Site configuration not found: {domain}
        </div>
        <a
          href="/dashboard/sites"
          class="btn btn-secondary"
        >
          Back to Sites
        </a>
      </Layout>,
    );
  }

  return c.html(
    <Layout
      title={`${domain} - SmartScraper`}
      activePath="/dashboard/sites"
      theme={theme}
      csrfToken={csrfToken}
    >
      <h1>Edit Site</h1>
      <SiteForm site={site} />
      <TestForm domain={domain} />
    </Layout>,
  );
});

async function saveSiteConfig(
  c: Context,
  domain: string,
  isNew: boolean,
) {
  const body = await c.req.parseBody();

  const rawDomain =
    typeof body.domainPattern === "string" && body.domainPattern.trim()
      ? body.domainPattern
      : domain;
  const actualDomain = normalizeSubmittedDomain(rawDomain);
  const xpathMainContent =
    typeof body.xpathMainContent === "string"
      ? body.xpathMainContent.trim()
      : "";
  const submittedSite: SiteConfig = {
    domainPattern: actualDomain,
    xpathMainContent,
    failureCountSinceLastSuccess: 0,
  };

  const domainError = validateDomain(actualDomain);
  if (domainError) {
    return renderSiteFormError(c, submittedSite, domainError, isNew);
  }

  const xpathError = validateXPath(xpathMainContent);
  if (xpathError) {
    return renderSiteFormError(c, submittedSite, xpathError, isNew);
  }

  const headersText =
    typeof body.siteSpecificHeaders === "string"
      ? body.siteSpecificHeaders
      : "";
  let siteSpecificHeaders: Record<string, string>;
  try {
    siteSpecificHeaders = parseHeaders(headersText);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Invalid custom headers.";
    return renderSiteFormError(c, submittedSite, message, isNew);
  }

  const cleanupText =
    typeof body.siteCleanupClasses === "string"
      ? body.siteCleanupClasses
      : "";
  const siteCleanupClasses = cleanupText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  let method: SiteConfigMethod | undefined;
  let captcha: SiteConfigCaptcha | undefined;
  let proxy: SiteConfigProxy | undefined;
  try {
    method = parseOptionalStrategy(
      body.method,
      siteConfigMethods,
      "method strategy",
    );
    captcha = parseOptionalStrategy(
      body.captcha,
      siteConfigCaptchas,
      "CAPTCHA strategy",
    );
    proxy = parseOptionalStrategy(
      body.proxy,
      siteConfigProxies,
      "proxy strategy",
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Invalid site strategy.";
    return renderSiteFormError(c, submittedSite, message, isNew);
  }

  const needsProxy =
    proxy === "datadome" || body.needsProxy === "datadome";

  const existingConfig =
    await knownSitesAdapter.getConfig(actualDomain);

  const config: SiteConfig = {
    domainPattern: actualDomain,
    xpathMainContent,
    failureCountSinceLastSuccess:
      existingConfig?.failureCountSinceLastSuccess || 0,
    lastSuccessfulScrapeTimestamp:
      existingConfig?.lastSuccessfulScrapeTimestamp,
    discoveredByLlm: existingConfig?.discoveredByLlm,
    siteSpecificHeaders:
      Object.keys(siteSpecificHeaders).length > 0
        ? siteSpecificHeaders
        : undefined,
    siteCleanupClasses:
      siteCleanupClasses.length > 0
        ? siteCleanupClasses
        : undefined,
    userAgent:
      typeof body.userAgent === "string" && body.userAgent.trim()
        ? body.userAgent.trim()
        : undefined,
    method,
    captcha,
    proxy,
    needsProxy: needsProxy ? "datadome" : undefined,
  };

  await knownSitesAdapter.saveConfig(config);

  const isHtmx = c.req.header("HX-Request") === "true";
  if (isHtmx) {
    return c.html(
      <>
        <div class="alert alert-success mb-4">
          Configuration saved successfully.
        </div>
        <SiteForm site={config} />
      </>,
    );
  }

  return c.redirect("/dashboard/sites");
}

sitesRouter.post("/new", async (c) => {
  return saveSiteConfig(c, "", true);
});

sitesRouter.post("/:domain", async (c) => {
  const domain = decodeURIComponent(c.req.param("domain"));
  return saveSiteConfig(c, domain, false);
});

sitesRouter.delete("/:domain", async (c) => {
  const domain = decodeURIComponent(c.req.param("domain"));
  await knownSitesAdapter.deleteConfig(domain);
  return c.html("");
});

sitesRouter.post("/:domain/test", async (c) => {
  const body = await c.req.parseBody();
  const testUrl = body.testUrl as string;

  if (!testUrl) {
    return c.html(
      <TestResult
        success={false}
        message="Test URL is required"
      />,
    );
  }

  try {
    const engine = getDefaultEngine();
    const startTime = Date.now();
    const result = await engine.scrapeUrl(testUrl);
    const duration = Date.now() - startTime;

    if (result.success) {
      const contentLength =
        typeof result.data === "string"
          ? result.data.length
          : 0;
      return c.html(
        <TestResult
          success={true}
          message={`Extracted ${contentLength.toLocaleString()} characters in ${(duration / 1000).toFixed(1)}s`}
          details={`XPath: ${result.xpath}`}
        />,
      );
    } else {
      return c.html(
        <TestResult
          success={false}
          message={`${result.errorType}: ${result.error}`}
        />,
      );
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error";
    return c.html(
      <TestResult success={false} message={message} />,
    );
  }
});
