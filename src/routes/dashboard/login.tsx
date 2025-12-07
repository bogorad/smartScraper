import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { LoginLayout } from '../../components/layout.js';
import { createSession, validateToken } from '../../middleware/auth.js';
import { logger } from '../../utils/logger.js';

export const loginRouter = new Hono();

loginRouter.get('/', (c) => {
  const theme = getCookie(c, 'theme') || 'light';
  const error = c.req.query('error');
  const redirect = c.req.query('redirect') || '/dashboard';

  return c.html(
    <LoginLayout theme={theme}>
      <div class="login-box">
        <div class="login-title">
          <h1>SmartScraper</h1>
          <p class="text-muted">Enter your API token to continue</p>
        </div>

        {error === 'invalid' && (
          <div class="alert alert-error">Invalid token. Please try again.</div>
        )}

        {error === 'config' && (
          <div class="alert alert-error">API_TOKEN not configured on server.</div>
        )}

        <form method="post" action={`/login?redirect=${encodeURIComponent(redirect)}`}>
          <div class="form-group">
            <label for="token">API Token</label>
            <input
              type="password"
              id="token"
              name="token"
              placeholder="Enter your UUID7 token"
              required
              autofocus
            />
          </div>
          <button type="submit" class="btn btn-primary" style="width: 100%">
            Sign In
          </button>
        </form>
      </div>
    </LoginLayout>
  );
});

loginRouter.post('/', async (c) => {
  const body = await c.req.parseBody();
  const token = body.token as string;
  const redirect = c.req.query('redirect') || '/dashboard';

  logger.info('[AUTH] Login attempt received');
  const isValid = validateToken(token);

  if (!isValid) {
    return c.redirect(`/login?error=invalid&redirect=${encodeURIComponent(redirect)}`);
  }

  createSession(c, token);
  return c.redirect(redirect);
});
