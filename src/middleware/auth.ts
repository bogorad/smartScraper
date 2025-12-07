import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie } from 'hono/cookie';
import { createHash } from 'crypto';
import { getApiToken, getNodeEnv } from '../config.js';

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
    const path = c.req.path;
    return c.redirect(`/login?redirect=${encodeURIComponent(path)}`);
  }

  await next();
});

export function createSession(c: any, token: string): void {
  const hash = hashToken(token);
  setCookie(c, SESSION_COOKIE, hash, {
    httpOnly: true,
    secure: getNodeEnv() === 'production',
    maxAge: SESSION_MAX_AGE,
    sameSite: 'Lax',
    path: '/'
  });
}

export function validateToken(token: string): boolean {
  return token === getConfiguredApiToken();
}
