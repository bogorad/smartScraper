import { createMiddleware } from 'hono/factory';
import { logger } from '../utils/logger.js';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory rate limit store (consider Redis for multi-instance deployments)
const store = new Map<string, RateLimitEntry>();

interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
}

/**
 * Rate limiting middleware factory
 * @param maxRequests Maximum number of requests allowed in the window
 * @param windowMs Time window in milliseconds
 */
export const rateLimitMiddleware = (options: RateLimitOptions) => {
  const { maxRequests, windowMs } = options;

  return createMiddleware(async (c, next) => {
    // Identify client by Authorization header or IP
    const identifier = c.req.header('Authorization')?.replace('Bearer ', '') ||
                      c.req.header('x-forwarded-for') ||
                      'unknown';

    const now = Date.now();
    const key = `${identifier}:${Math.floor(now / windowMs)}`;

    const entry = store.get(key);

    if (!entry) {
      // First request in this window
      store.set(key, { count: 1, resetTime: now + windowMs });
    } else {
      entry.count++;
    }

    // Check if limit exceeded
    const currentEntry = store.get(key)!;
    if (currentEntry.count > maxRequests) {
      logger.warn('[RATE_LIMIT] Rate limit exceeded', {
        identifier: identifier.slice(0, 20),
        count: currentEntry.count,
        maxRequests
      });

      return c.json({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((currentEntry.resetTime - now) / 1000)
      }, 429, {
        'Retry-After': String(Math.ceil((currentEntry.resetTime - now) / 1000)),
        'X-RateLimit-Limit': String(maxRequests),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(currentEntry.resetTime / 1000))
      });
    }

    // Add rate limit headers to response
    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(Math.max(0, maxRequests - currentEntry.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(currentEntry.resetTime / 1000)));

    await next();
  });
};
