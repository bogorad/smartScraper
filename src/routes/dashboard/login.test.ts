import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { loginRouter } from './login.js';

vi.mock('../../config.js', () => ({
  getApiToken: () => 'test-token',
  getDataDir: () => '/tmp/smart-scraper-test',
  getLogLevel: () => 'NONE',
  getNodeEnv: () => 'test',
  isDebugMode: () => false
}));

function createLoginApp(): Hono {
  const app = new Hono();
  app.route('/login', loginRouter);
  return app;
}

function loginRequest(redirect: string, token = 'test-token'): Request {
  const body = new URLSearchParams({ token });
  return new Request(`http://localhost/login?redirect=${encodeURIComponent(redirect)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
}

describe('loginRouter', () => {
  it('redirects valid logins to local dashboard paths', async () => {
    const app = createLoginApp();

    const res = await app.request(loginRequest('/dashboard/sites?filter=active'));

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard/sites?filter=active');
  });

  it('normalizes external absolute redirects after valid login', async () => {
    const app = createLoginApp();

    const res = await app.request(loginRequest('https://evil.example/phish'));

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard');
  });

  it('normalizes protocol-relative redirects after valid login', async () => {
    const app = createLoginApp();

    const res = await app.request(loginRequest('//evil.example/phish'));

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard');
  });

  it('does not preserve external redirects after invalid login', async () => {
    const app = createLoginApp();

    const res = await app.request(loginRequest('https://evil.example/phish', 'wrong-token'));

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login?error=invalid&redirect=%2Fdashboard');
  });
});
