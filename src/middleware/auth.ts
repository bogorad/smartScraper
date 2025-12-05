import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie } from 'hono/cookie';
import { createHash } from 'crypto';
import fs from 'fs';

const SESSION_COOKIE = 'ss_session';
const SESSION_MAX_AGE = 86400;
const SECRETS_PATH = '/run/secrets/api_keys/smart-scraper';

let cachedToken: string | null = null;

function getApiToken(): string | null {
  if (cachedToken !== null) return cachedToken;

  try {
    cachedToken = fs.readFileSync(SECRETS_PATH, 'utf-8').trim();
    return cachedToken;
  } catch {
    cachedToken = process.env.API_TOKEN || null;
    return cachedToken;
  }
}

function getSessionSecret(): string {
  const token = getApiToken();
  return token ? createHash('sha256').update(token).digest('hex').slice(0, 32) : 'fallback-secret';
}

function hashToken(token: string): string {
  return createHash('sha256').update(token + getSessionSecret()).digest('hex');
}

export const apiAuthMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  const apiToken = getApiToken();

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
  const apiToken = getApiToken();

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
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE,
    sameSite: 'Lax',
    path: '/'
  });
}

export function validateToken(token: string): boolean {
  return token === getApiToken();
}
