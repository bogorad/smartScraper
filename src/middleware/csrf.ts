import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import { logger } from "../utils/logger.js";

const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "X-CSRF-Token";

/**
 * CSRF protection middleware
 * - On GET: reuses existing cookie token or generates a new one
 * - On POST/PUT/DELETE: validates X-CSRF-Token header or form field matches cookie
 */
export const csrfMiddleware = createMiddleware(
  async (c, next) => {
    if (c.req.method === "GET") {
      const existingToken = getCookie(c, CSRF_COOKIE);
      const token = existingToken || crypto.randomUUID();

      if (!existingToken) {
        setCookie(c, CSRF_COOKIE, token, {
          httpOnly: false, // Allow JavaScript access for HTMX
          path: "/",
          sameSite: "Strict",
          maxAge: 3600, // 1 hour
        });
      }

      c.set("csrfToken", token);
      await next();
      return;
    }

    // For non-GET requests, validate CSRF token
    const cookieToken = getCookie(c, CSRF_COOKIE);
    const submittedToken = await getSubmittedCsrfToken(c);

    if (
      !cookieToken ||
      !submittedToken ||
      cookieToken !== submittedToken
    ) {
      logger.warn("[CSRF] Token validation failed", {
        hasCookie: !!cookieToken,
        hasSubmittedToken: !!submittedToken,
        match: cookieToken === submittedToken,
      });
      return c.json(
        { error: "CSRF token validation failed" },
        403,
      );
    }

    await next();
  },
);

/**
 * Get CSRF token for inclusion in forms/meta tags
 */
export function getCsrfToken(c: any): string | undefined {
  return c.get("csrfToken");
}

async function getSubmittedCsrfToken(
  c: any,
): Promise<string | undefined> {
  const headerToken = c.req.header(CSRF_HEADER);
  if (headerToken) {
    return headerToken;
  }

  const contentType = c.req.header("content-type") || "";
  if (
    !contentType.includes(
      "application/x-www-form-urlencoded",
    ) &&
    !contentType.includes("multipart/form-data")
  ) {
    return undefined;
  }

  const body = await c.req.parseBody();
  const token = body._csrf;
  return typeof token === "string" ? token : undefined;
}
