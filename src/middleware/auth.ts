import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie } from 'hono/cookie';
import { createHash } from 'crypto';
import { getApiToken, getNodeEnv } from '../config.js';
import { logger } from '../utils/logger.js';

const SESSION_COOKIE = 'ss_session';
const SESSION_MAX_AGE = 86400;

function getConfiguredApiToken(): string | null {
  const token = getApiToken();
  return token ? token : null;
}

function getSessionSecret(): string {
  const token = getConfiguredApiToken();
  return token ? createHash('sha256').update(token).digest('hex').slice(0, 32) : 'fallback-secret';
}

function hashToken(token: string): string {
  return createHash('sha256').update(token + getSessionSecret()).digest('hex');
}

export const apiAuthMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  const apiToken = getConfiguredApiToken();

  if (!apiToken) {
    return c.json({ error: 'API token not configured' }, 500);
  }

  if (token !== apiToken) {
    logger.warn('[AUTH] API authentication failed', {
      ip: c.req.header('x-forwarded-for') || 'unknown',
      userAgent: c.req.header('user-agent')?.slice(0, 100) || 'unknown'
    });
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
});

export const dashboardAuthMiddleware = createMiddleware(async (c, next) => {
  const sessionCookie = getCookie(c, SESSION_COOKIE);
  const apiToken = getConfiguredApiToken();

  if (!apiToken) {
    return c.redirect('/login?error=config');
  }

  const expectedHash = hashToken(apiToken);

  if (sessionCookie !== expectedHash) {
    // Only log if a cookie was actually presented but failed (avoid noise on first visit)
    if (sessionCookie) {
      logger.warn('[AUTH] Invalid session cookie presented', {
        ip: c.req.header('x-forwarded-for') || 'unknown',
        userAgent: c.req.header('user-agent')?.slice(0, 100) || 'unknown',
        path: c.req.path
      });
    } else {
      logger.info('[AUTH] No session cookie received', { path: c.req.path });
    }
    const path = c.req.path;
    return c.redirect(`/login?redirect=${encodeURIComponent(path)}`);
  }

  await next();
});

export function createSession(c: any, token: string): void {
  const hash = hashToken(token);

  // Adaptive security: secure=true only in production on non-localhost
  const hostname = c.req.header('host')?.split(':')[0] || '';
  const isLocalhost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname);
  const isProduction = getNodeEnv() === 'production';
  const isSecure = isProduction && !isLocalhost;

  logger.info(`[AUTH] Creating session. Secure: ${isSecure}, Host: ${hostname}`);

  setCookie(c, SESSION_COOKIE, hash, {
    httpOnly: true,
    secure: isSecure,
    maxAge: SESSION_MAX_AGE,
    sameSite: 'Lax',
    path: '/'
  });
}

export function validateToken(token: string): boolean {
  const configuredToken = getConfiguredApiToken();
  const isValid = token === configuredToken;
  if (!isValid && token) {
    logger.warn('[AUTH] Token validation failed');
  }
  return isValid;
}
