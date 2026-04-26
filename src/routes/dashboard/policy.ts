import type { Context, Hono } from "hono";
import { except } from "hono/combine";
import { dashboardAuthMiddleware } from "../../middleware/auth.js";
import { csrfMiddleware } from "../../middleware/csrf.js";
import { rateLimitMiddleware } from "../../middleware/rate-limit.js";

const DASHBOARD_RATE_LIMIT = {
  maxRequests: 60,
  windowMs: 60000,
};

function isCsrfExemptDashboardRequest(c: Context): boolean {
  return c.req.path === "/dashboard/events";
}

export function applyDashboardRoutePolicy(
  router: Hono,
): void {
  router.use(
    "/*",
    rateLimitMiddleware(DASHBOARD_RATE_LIMIT),
  );
  router.use(
    "/*",
    except(isCsrfExemptDashboardRequest, csrfMiddleware),
  );
  router.use("/*", dashboardAuthMiddleware);
}
