import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie } from 'hono/cookie';
import { logger } from '../utils/logger.js';

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'X-CSRF-Token';

/**
 * CSRF protection middleware
 * - On GET: generates token and sets cookie
 * - On POST/PUT/DELETE: validates X-CSRF-Token header matches cookie
 */
export const csrfMiddleware = createMiddleware(async (c, next) => {
  if (c.req.method === 'GET') {
    // Generate new token for GET requests
    const token = crypto.randomUUID();
    setCookie(c, CSRF_COOKIE, token, {
      httpOnly: false, // Allow JavaScript access for HTMX
      path: '/',
      sameSite: 'Strict',
      maxAge: 3600 // 1 hour
    });
    c.set('csrfToken', token);
    await next();
    return;
  }

  // For non-GET requests, validate CSRF token
  const cookieToken = getCookie(c, CSRF_COOKIE);
  const headerToken = c.req.header(CSRF_HEADER);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    logger.warn('[CSRF] Token validation failed', {
      hasCookie: !!cookieToken,
      hasHeader: !!headerToken,
      match: cookieToken === headerToken
    });
    return c.json({ error: 'CSRF token validation failed' }, 403);
  }

  await next();
});

/**
 * Get CSRF token for inclusion in forms/meta tags
 */
export function getCsrfToken(c: any): string | undefined {
  return c.get('csrfToken');
}
