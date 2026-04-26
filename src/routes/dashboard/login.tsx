import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { LoginLayout } from "../../components/layout.js";
import {
  createSession,
  hasConfiguredApiToken,
  validateToken,
} from "../../middleware/auth.js";
import {
  csrfMiddleware,
  getCsrfToken,
} from "../../middleware/csrf.js";
import { logger } from "../../utils/logger.js";

export const loginRouter = new Hono();

loginRouter.use("/*", csrfMiddleware);

function getSafeDashboardRedirect(
  redirect: string | undefined,
): string {
  if (!redirect || redirect.startsWith("//")) {
    return "/dashboard";
  }

  if (!redirect.startsWith("/dashboard")) {
    return "/dashboard";
  }

  const nextCharacter = redirect.charAt(
    "/dashboard".length,
  );
  if (
    nextCharacter &&
    nextCharacter !== "/" &&
    nextCharacter !== "?" &&
    nextCharacter !== "#"
  ) {
    return "/dashboard";
  }

  return redirect;
}

loginRouter.get("/", (c) => {
  const theme = getCookie(c, "theme") || "light";
  const error = c.req.query("error");
  const redirect = getSafeDashboardRedirect(
    c.req.query("redirect"),
  );
  const csrfToken = getCsrfToken(c);

  return c.html(
    <LoginLayout theme={theme}>
      <div class="login-box">
        <div class="login-title">
          <h1>SmartScraper</h1>
          <p class="text-muted">
            Enter your API token to continue
          </p>
        </div>

        {error === "invalid" && (
          <div class="alert alert-error">
            Invalid token. Please try again.
          </div>
        )}

        {error === "config" && (
          <div class="alert alert-error">
            API_TOKEN not configured on server.
          </div>
        )}

        <form
          method="post"
          action={`/login?redirect=${encodeURIComponent(redirect)}`}
        >
          <input
            type="hidden"
            name="_csrf"
            value={csrfToken}
          />
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
          <button
            type="submit"
            class="btn btn-primary"
            style="width: 100%"
          >
            Sign In
          </button>
        </form>
      </div>
    </LoginLayout>,
  );
});

loginRouter.post("/", async (c) => {
  const redirect = getSafeDashboardRedirect(
    c.req.query("redirect"),
  );

  logger.info("[AUTH] Login attempt received");
  if (!hasConfiguredApiToken()) {
    logger.error(
      "[AUTH] API token not configured; refusing login",
    );
    return c.redirect(
      `/login?error=config&redirect=${encodeURIComponent(redirect)}`,
    );
  }

  let body: Awaited<ReturnType<typeof c.req.parseBody>>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.redirect(
      `/login?error=invalid&redirect=${encodeURIComponent(redirect)}`,
    );
  }

  const token = body.token;
  if (typeof token !== "string") {
    return c.redirect(
      `/login?error=invalid&redirect=${encodeURIComponent(redirect)}`,
    );
  }

  const isValid = validateToken(token);

  if (!isValid) {
    return c.redirect(
      `/login?error=invalid&redirect=${encodeURIComponent(redirect)}`,
    );
  }

  if (!createSession(c, token)) {
    return c.redirect(
      `/login?error=config&redirect=${encodeURIComponent(redirect)}`,
    );
  }

  return c.redirect(redirect);
});
