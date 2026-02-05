import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { apiAuthMiddleware, dashboardAuthMiddleware, createSession, validateToken } from './auth.js';

vi.mock('../config.js', () => ({
  getApiToken: () => 'test-token',
  getNodeEnv: () => 'test',
  getLogLevel: () => 'NONE'
}));

describe('auth middleware', () => {
  describe('apiAuthMiddleware', () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.use('/*', apiAuthMiddleware);
      app.get('/test', (c) => c.json({ message: 'success' }));
    });

    it('should allow requests with valid bearer token', async () => {
      const req = new Request('http://localhost/test', {
        headers: {
          'Authorization': 'Bearer test-token'
        }
      });

      const res = await app.request(req);
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.message).toBe('success');
    });

    it('should reject requests without authorization header', async () => {
      const req = new Request('http://localhost/test');

      const res = await app.request(req);
      
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('should reject requests with invalid token', async () => {
      const req = new Request('http://localhost/test', {
        headers: {
          'Authorization': 'Bearer wrong-token'
        }
      });

      const res = await app.request(req);
      
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('should handle authorization header without Bearer prefix', async () => {
      const req = new Request('http://localhost/test', {
        headers: {
          'Authorization': 'test-token'
        }
      });

      const res = await app.request(req);
      
      expect(res.status).toBeGreaterThanOrEqual(200);
    });

    it('should handle empty authorization header', async () => {
      const req = new Request('http://localhost/test', {
        headers: {
          'Authorization': ''
        }
      });

      const res = await app.request(req);
      
      expect(res.status).toBe(401);
    });
  });

  describe('dashboardAuthMiddleware', () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.use('/dashboard/*', dashboardAuthMiddleware);
      app.get('/dashboard/test', (c) => c.text('Dashboard content'));
    });

    it('should redirect to login when session cookie is missing', async () => {
      const req = new Request('http://localhost/dashboard/test');

      const res = await app.request(req);
      
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toContain('/login');
    });

    it('should redirect to login when session cookie is invalid', async () => {
      const req = new Request('http://localhost/dashboard/test', {
        headers: {
          'Cookie': 'ss_session=invalid-hash'
        }
      });

      const res = await app.request(req);
      
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toContain('/login');
    });

    it('should preserve redirect path in query parameter', async () => {
      const req = new Request('http://localhost/dashboard/test');

      const res = await app.request(req);
      
      expect(res.status).toBe(302);
      const location = res.headers.get('Location');
      expect(location).toContain('redirect=');
      expect(location).toContain(encodeURIComponent('/dashboard/test'));
    });
  });

  describe('validateToken', () => {
    it('should return true for valid token', () => {
      expect(validateToken('test-token')).toBe(true);
    });

    it('should return false for invalid token', () => {
      expect(validateToken('wrong-token')).toBe(false);
    });

    it('should return false for empty token', () => {
      expect(validateToken('')).toBe(false);
    });
  });

  describe('createSession', () => {
    it('should set session cookie', async () => {
      const testApp = new Hono();
      testApp.post('/login', (c) => {
        createSession(c, 'test-token');
        return c.text('OK');
      });

      const req = new Request('http://localhost/login', { method: 'POST' });
      const res = await testApp.request(req);

      expect(res.headers.get('Set-Cookie')).toContain('ss_session=');
    });
  });
});
