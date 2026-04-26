import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import { createHash, timingSafeEqual } from "crypto";
import {
  getApiToken,
  getNodeEnv,
  getTrustProxyHeaders,
} from "../config.js";
import { logger } from "../utils/logger.js";

const SESSION_COOKIE = "ss_session";
const SESSION_MAX_AGE = 86400;

function getConfiguredApiToken(): string | null {
  const token = getApiToken();
  return token ? token : null;
}

function getSessionSecret(): string | null {
  const token = getConfiguredApiToken();
  return token
    ? createHash("sha256")
        .update(token)
        .digest("hex")
        .slice(0, 32)
    : null;
}

function hashToken(token: string): string | null {
  const sessionSecret = getSessionSecret();
  if (!sessionSecret) {
    return null;
  }

  return createHash("sha256")
    .update(token + sessionSecret)
    .digest("hex");
}

function timingSafeStringEqual(
  value: string | undefined,
  expected: string | null,
): boolean {
  if (!value || !expected) {
    return false;
  }

  const valueHash = createHash("sha256")
    .update(value)
    .digest();
  const expectedHash = createHash("sha256")
    .update(expected)
    .digest();
  const hashesMatch = timingSafeEqual(
    valueHash,
    expectedHash,
  );

  return hashesMatch && value.length === expected.length;
}

export const apiAuthMiddleware = createMiddleware(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    const apiToken = getConfiguredApiToken();

    if (!apiToken) {
      logger.error(
        "[AUTH] API token not configured; rejecting API request",
      );
      return c.json(
        { error: "API token not configured" },
        500,
      );
    }

    if (!timingSafeStringEqual(token, apiToken)) {
      logger.warn("[AUTH] API authentication failed", {
        ip: c.req.header("x-forwarded-for") || "unknown",
        userAgent:
          c.req.header("user-agent")?.slice(0, 100) ||
          "unknown",
      });
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
  },
);

export const dashboardAuthMiddleware = createMiddleware(
  async (c, next) => {
    const sessionCookie = getCookie(c, SESSION_COOKIE);
    const apiToken = getConfiguredApiToken();

    if (!apiToken) {
      logger.error(
        "[AUTH] API token not configured; rejecting dashboard request",
      );
      return c.redirect("/login?error=config");
    }

    const expectedHash = hashToken(apiToken);

    if (
      !timingSafeStringEqual(sessionCookie, expectedHash)
    ) {
      // Only log if a cookie was actually presented but failed (avoid noise on first visit)
      if (sessionCookie) {
        logger.warn(
          "[AUTH] Invalid session cookie presented",
          {
            ip:
              c.req.header("x-forwarded-for") || "unknown",
            userAgent:
              c.req.header("user-agent")?.slice(0, 100) ||
              "unknown",
            path: c.req.path,
          },
        );
      } else {
        logger.info("[AUTH] No session cookie received", {
          path: c.req.path,
        });
      }
      const path = c.req.path;
      return c.redirect(
        `/login?redirect=${encodeURIComponent(path)}`,
      );
    }

    await next();
  },
);

export function createSession(
  c: any,
  token: string,
): boolean {
  const hash = hashToken(token);
  if (!hash) {
    logger.error(
      "[AUTH] Session secret unavailable; refusing to create dashboard session",
    );
    return false;
  }

  // Adaptive security: local production runs stay usable on HTTP,
  // and trusted reverse proxies can report the public HTTPS protocol.
  const hostname =
    c.req.header("host")?.split(":")[0] ||
    new URL(c.req.url).hostname;
  const isLocalhost = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
  ].includes(hostname);
  const isProduction = getNodeEnv() === "production";
  const forwardedProto = c.req
    .header("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const isTrustedProxyHttps =
    getTrustProxyHeaders() && forwardedProto === "https";
  const isSecure =
    isProduction && (isTrustedProxyHttps || !isLocalhost);

  logger.info(
    `[AUTH] Creating session. Secure: ${isSecure}, Host: ${hostname}, Forwarded-Proto: ${forwardedProto || "none"}`,
  );

  setCookie(c, SESSION_COOKIE, hash, {
    httpOnly: true,
    secure: isSecure,
    maxAge: SESSION_MAX_AGE,
    sameSite: "Lax",
    path: "/",
  });
  return true;
}

export function validateToken(token: string): boolean {
  const configuredToken = getConfiguredApiToken();
  if (!configuredToken) {
    logger.error(
      "[AUTH] API token not configured; rejecting token validation",
    );
    return false;
  }

  const isValid = timingSafeStringEqual(
    token,
    configuredToken,
  );
  if (!isValid && token) {
    logger.warn("[AUTH] Token validation failed");
  }
  return isValid;
}

export function hasConfiguredApiToken(): boolean {
  return getConfiguredApiToken() !== null;
}
