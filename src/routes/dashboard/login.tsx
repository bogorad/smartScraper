import { Hono } from 'hono';
import { LoginLayout } from '../../components/layout.js';
import { createSession, validateToken } from '../../middleware/auth.js';

export const loginRouter = new Hono();

loginRouter.get('/', (c) => {
  const error = c.req.query('error');
  const redirect = c.req.query('redirect') || '/dashboard';

  return c.html(
    <LoginLayout>
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

  console.log(`[AUTH-DEBUG] Login attempt. Token provided: "${token}"`);
  const isValid = validateToken(token);
  console.log(`[AUTH-DEBUG] Token validation result: ${isValid}`);

  if (!isValid) {
    return c.redirect(`/login?error=invalid&redirect=${encodeURIComponent(redirect)}`);
  }

  createSession(c, token);
  return c.redirect(redirect);
});
