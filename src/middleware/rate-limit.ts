import { createHash } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { getTrustProxyHeaders } from "../config.js";
import { logger } from "../utils/logger.js";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory rate limit store (consider Redis for multi-instance deployments)
const store = new Map<string, RateLimitEntry>();

// Cleanup expired entries every minute
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetTime < now) {
      store.delete(key);
    }
  }
}, 60000);
cleanupInterval.unref?.();

interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
}

function hashIdentifier(
  type: string,
  value: string,
): string {
  return `${type}:${createHash("sha256").update(value).digest("hex")}`;
}

function getBearerToken(
  authorization: string | undefined,
): string | undefined {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function getForwardedIp(
  xForwardedFor: string | undefined,
): string | undefined {
  return xForwardedFor?.split(",")[0]?.trim() || undefined;
}

function getRateLimitIdentifier(headers: {
  authorization?: string;
  xForwardedFor?: string;
  xRealIp?: string;
}, trustProxyHeaders = false): string {
  const bearerToken = getBearerToken(headers.authorization);
  if (bearerToken) {
    return hashIdentifier("auth", bearerToken);
  }

  const trustedProxyIp = trustProxyHeaders
    ? getForwardedIp(headers.xForwardedFor) ||
      headers.xRealIp
    : undefined;

  return hashIdentifier(
    "ip",
    trustedProxyIp || "unknown",
  );
}

/**
 * Rate limiting middleware factory
 * @param maxRequests Maximum number of requests allowed in the window
 * @param windowMs Time window in milliseconds
 */
export const rateLimitMiddleware = (
  options: RateLimitOptions,
) => {
  const { maxRequests, windowMs } = options;

  return createMiddleware(async (c, next) => {
    // Identify client by a stable digest so credentials are never stored or logged.
    const identifier = getRateLimitIdentifier({
      authorization: c.req.header("Authorization"),
      xForwardedFor: c.req.header("x-forwarded-for"),
      xRealIp: c.req.header("x-real-ip"),
    }, getTrustProxyHeaders());

    const now = Date.now();
    const key = `${identifier}:${Math.floor(now / windowMs)}`;

    const entry = store.get(key);

    if (!entry) {
      // First request in this window
      store.set(key, {
        count: 1,
        resetTime: now + windowMs,
      });
    } else {
      entry.count++;
    }

    // Check if limit exceeded
    const currentEntry = store.get(key)!;
    if (currentEntry.count > maxRequests) {
      logger.warn("[RATE_LIMIT] Rate limit exceeded", {
        identifier,
        count: currentEntry.count,
        maxRequests,
      });

      return c.json(
        {
          error: "Rate limit exceeded",
          retryAfter: Math.ceil(
            (currentEntry.resetTime - now) / 1000,
          ),
        },
        429,
        {
          "Retry-After": String(
            Math.ceil(
              (currentEntry.resetTime - now) / 1000,
            ),
          ),
          "X-RateLimit-Limit": String(maxRequests),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(
            Math.ceil(currentEntry.resetTime / 1000),
          ),
        },
      );
    }

    // Add rate limit headers to response
    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header(
      "X-RateLimit-Remaining",
      String(Math.max(0, maxRequests - currentEntry.count)),
    );
    c.header(
      "X-RateLimit-Reset",
      String(Math.ceil(currentEntry.resetTime / 1000)),
    );

    await next();
  });
};

export const rateLimitTestUtils = {
  clearStore: () => store.clear(),
  getStoreKeys: () => Array.from(store.keys()),
  getRateLimitIdentifier,
};
