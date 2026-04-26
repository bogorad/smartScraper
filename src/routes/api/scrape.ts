import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { apiAuthMiddleware } from "../../middleware/auth.js";
import { rateLimitMiddleware } from "../../middleware/rate-limit.js";
import { getDefaultEngine } from "../../core/engine.js";
import type { CoreScraperEngine } from "../../core/engine.js";
import { DEFAULTS, OUTPUT_TYPES } from "../../constants.js";
import {
  sanitizeErrorForClient,
  sanitizeScrapeResultForClient,
} from "../../utils/error-sanitizer.js";
import { logger } from "../../utils/logger.js";
import { validateScrapeTargetUrl } from "../../utils/url.js";
import { isValidXPath } from "../../utils/xpath-parser.js";

const MAX_PROXY_SERVER_LENGTH = 2048;
const MAX_USER_AGENT_LENGTH = 512;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = DEFAULTS.TIMEOUT_MS;
const ALLOWED_PROXY_PROTOCOLS = new Set([
  "http:",
  "https:",
  "socks4:",
  "socks5:",
]);

export type ScrapeRouteEngine = Pick<
  CoreScraperEngine,
  "scrapeUrl"
>;

export interface ScrapeRouteBindings {
  Variables: {
    scraperEngine?: ScrapeRouteEngine;
  };
}

let routeEngine: ScrapeRouteEngine | null = null;

export function setScrapeRouteEngine(
  engine: ScrapeRouteEngine,
): void {
  routeEngine = engine;
}

export function resetScrapeRouteEngine(): void {
  routeEngine = null;
}

function getScrapeRouteEngine(
  c: Context<ScrapeRouteBindings>,
): ScrapeRouteEngine {
  return (
    c.get("scraperEngine") ??
    routeEngine ??
    getDefaultEngine()
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:"
    );
  } catch {
    return false;
  }
}

function isValidProxyServer(value: string): boolean {
  try {
    const parsed = new URL(value);
    const port = parsed.port
      ? Number(parsed.port)
      : undefined;

    return (
      ALLOWED_PROXY_PROTOCOLS.has(parsed.protocol) &&
      Boolean(parsed.hostname) &&
      (port === undefined ||
        (Number.isInteger(port) &&
          port >= 1 &&
          port <= 65535))
    );
  } catch {
    return false;
  }
}

const scrapeSchema = z.object({
  url: z.string().url().refine(isHttpUrl),
  outputType: z
    .enum([
      "content_only",
      "markdown",
      "cleaned_html",
      "full_html",
      "metadata_only",
    ])
    .optional(),
  proxyServer: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PROXY_SERVER_LENGTH)
    .refine(isValidProxyServer)
    .optional(),
  userAgent: z
    .string()
    .trim()
    .min(1)
    .max(MAX_USER_AGENT_LENGTH)
    .optional(),
  timeoutMs: z
    .number()
    .int()
    .min(MIN_TIMEOUT_MS)
    .max(MAX_TIMEOUT_MS)
    .optional(),
  xpath: z.string().trim().refine(isValidXPath).optional(),
  debug: z.boolean().optional(),
});

export const scrapeRouter = new Hono<ScrapeRouteBindings>();

// Rate limit: 10 requests per minute per client
scrapeRouter.use(
  "/*",
  rateLimitMiddleware({ maxRequests: 10, windowMs: 60000 }),
);
scrapeRouter.use("/*", apiAuthMiddleware);

scrapeRouter.post(
  "/",
  zValidator("json", scrapeSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: "Invalid request body",
        },
        400,
      );
    }
  }),
  async (c) => {
    const body = c.req.valid("json");

    const engine = getScrapeRouteEngine(c);
    try {
      const urlSafety = await validateScrapeTargetUrl(
        body.url,
      );
      if (!urlSafety.safe) {
        return c.json(
          {
            success: false,
            errorType: "CONFIGURATION",
            error: urlSafety.error,
          },
          400,
        );
      }

      const result = await engine.scrapeUrl(body.url, {
        outputType:
          body.outputType as (typeof OUTPUT_TYPES)[keyof typeof OUTPUT_TYPES],
        proxyDetails: body.proxyServer
          ? { server: body.proxyServer }
          : undefined,
        userAgentString: body.userAgent,
        timeoutMs: body.timeoutMs,
        xpathOverride: body.xpath,
        debug: body.debug,
      });

      return c.json(
        result.success
          ? result
          : sanitizeScrapeResultForClient(result),
      );
    } catch (error) {
      logger.error("[API] Scrape failed:", error);
      return c.json(
        {
          success: false,
          error: sanitizeErrorForClient(error),
        },
        500,
      );
    }
  },
);
