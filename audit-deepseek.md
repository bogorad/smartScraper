# SmartScraper Codebase Audit

**Date**: 2026-04-26
**Auditor**: DeepSeek V4 Pro (automated security/code review)
**Scope**: Full codebase, all TypeScript source under `src/`

---

## Issue 1: No CSRF Protection on Login Endpoint

**Severity**: [High]

**Description**: The POST `/login` route handler (`routes/dashboard/login.tsx`) is registered on the `loginRouter`, which has NO CSRF middleware applied. The `applyDashboardRoutePolicy` function applies CSRF protection only to `dashboardRouter`, `sitesRouter`, and `statsRouter`. The login form submits the API token and creates a session cookie — without CSRF protection, an attacker can craft a cross-site form that submits tokens to the victim's SmartScraper instance, causing session fixation or enabling brute-forcing of tokens from a third-party page (rate limits mitigate severity, but do not eliminate the risk).

**Location**: `src/routes/dashboard/login.tsx`, lines 68–81 (POST handler); `src/app.ts`, line 47 (router registration without CSRF); `src/routes/dashboard/policy.ts`, lines 16–28 (CSRF applied only to dashboard/sites/stats routers).

**Fix**: Apply CSRF middleware to the login router. The login form must include the CSRF token as an `X-CSRF-Token` header or hidden field, and the POST handler must validate it.

```typescript
// In src/app.ts — wrap login router with CSRF-aware route policy
import { csrfMiddleware } from "./middleware/csrf.js";
// Option A: Apply middleware directly
loginRouter.use("/*", csrfMiddleware);
```

```tsx
// In src/routes/dashboard/login.tsx — include CSRF token in form
// (Requires the login GET handler to set the CSRF cookie by including csrfMiddleware)
<form method="post" action={`/login?redirect=${encodeURIComponent(redirect)}`}
      hx-headers='{"X-CSRF-Token": "<csrf-value>"}'>
```

---

## Issue 2: Hardcoded Fallback Session Secret in Auth Middleware

**Severity**: [Medium]

**Description**: In `middleware/auth.ts`, the `getSessionSecret()` function falls back to the literal string `'fallback-secret'` when no API token is configured (line 17). While the `dashboardAuthMiddleware` correctly redirects to login with `error=config` before calling `hashToken()` when no token is set, this fallback value remains in the codebase as a latent vulnerability. If the auth flow is ever refactored — or if `hashToken()` is called from a new code path that bypasses the token-existence guard — session cookies become trivially forgeable: an attacker who knows the source code can compute `createHash('sha256').update("any-token" + "fallback-secret").digest('hex')` and forge any session.

**Location**: `src/middleware/auth.ts`, line 17.

**Fix**: Remove the fallback and either throw or log a clear error. The session secret must always be derived from a configured secret.

```typescript
function getSessionSecret(): string {
  const token = getConfiguredApiToken();
  if (!token) {
    throw new Error("Cannot derive session secret: API_TOKEN not configured.");
  }
  return createHash("sha256").update(token).digest("hex").slice(0, 32);
}
```

---

## Issue 3: Session Cookie `secure` Flag Logic Fragile Behind Reverse Proxy

**Severity**: [Medium]

**Description**: In `middleware/auth.ts`, the `createSession()` function determines the `secure` flag on the session cookie by checking `c.req.header('host')` against a list of localhost hostnames (lines 76–79). In production deployments behind a reverse proxy (e.g., Nginx, Caddy), the `Host` header seen by Hono is often the upstream/backend address (e.g., `localhost:5555`), not the public-facing hostname. This causes the `secure` flag to remain `false` even in production, meaning the session cookie is transmitted over unencrypted HTTP when the next request is made to the reverse proxy's public HTTPS endpoint. This increases the risk of session hijacking via MITM on untrusted networks.

**Location**: `src/middleware/auth.ts`, lines 72–89.

**Fix**: Use an explicit environment variable (e.g., `SESSION_SECURE`) to override, or check the `X-Forwarded-Proto` header trusted from the reverse proxy.

```typescript
export function createSession(c: any, token: string): void {
  const hash = hashToken(token);
  const forcedSecure = process.env.SESSION_SECURE === "true";
  const isProduction = getNodeEnv() === "production";
  const isLocalhost = ["localhost", "127.0.0.1", "0.0.0.0"]
    .includes(c.req.header("host")?.split(":")[0] || "");
  const proto = c.req.header("x-forwarded-proto");
  const isSecure = forcedSecure ||
    (isProduction && !isLocalhost) ||
    proto === "https";

  setCookie(c, SESSION_COOKIE, hash, {
    httpOnly: true,
    secure: isSecure,
    maxAge: SESSION_MAX_AGE,
    sameSite: "Lax",
    path: "/",
  });
}
```

---

## Issue 4: Duplicated XPath Validation Constants

**Severity**: [Medium]

**Description**: The same XPath validation constants — `MAX_XPATH_LENGTH = 500` and `ALLOWED_XPATH_PATTERN = /^[\w\-\/\[\]@="'\s\.\(\)\|\*\:,]+$/` — are defined independently in two places: `src/routes/api/scrape.ts` (lines 14, 25–26) and `src/adapters/puppeteer-browser.ts` (lines 284–285). If only one is updated during a maintenance change, the other becomes stale, leading to inconsistent validation: an XPath accepted by the API route might be rejected by the browser adapter (or vice versa), causing mysterious failures on otherwise valid input.

**Location**:
- `src/routes/api/scrape.ts`, lines 14, 25–26
- `src/adapters/puppeteer-browser.ts`, lines 284–285

**Fix**: Extract shared constants to a single location (e.g., `src/constants.ts` or a new `src/utils/xpath-constants.ts`) and import from both files.

```typescript
// In src/constants.ts — add:
export const XPATH = {
  MAX_LENGTH: 500,
  ALLOWED_PATTERN: /^[\w\-\/\[\]@="'\s\.\(\)\|\*\:,]+$/,
} as const;
```

```typescript
// In src/routes/api/scrape.ts and src/adapters/puppeteer-browser.ts:
import { XPATH } from "../constants.js";

// Replace inline constants with XPATH.MAX_LENGTH and XPATH.ALLOWED_PATTERN
```

---

## Issue 5: Rate Limit Store Key Rotation Causes Entries to Linger

**Severity**: [Low]

**Description**: In `src/middleware/rate-limit.ts`, the rate limit key includes the window timestamp (`Math.floor(now / windowMs)`), creating a new key each window. The cleanup interval (`setInterval` every 60 seconds) only removes entries where `resetTime < now`. In practice this works because `resetTime` is `now + windowMs`, but if `windowMs` is very large (e.g., hours), entries from old windows could accumulate until `resetTime` passes. For a window of 60 seconds and a cleanup interval of 60 seconds, each entry lives at most 120 seconds, which is acceptable. However, the design couples the cleanup to `resetTime` rather than to the window key, creating a subtle dependency that could break if `windowMs` changes independent of cleanup interval.

**Location**: `src/middleware/rate-limit.ts`, lines 14–22, 86, 92–94.

**Fix**: No code change required for current defaults, but document the coupling between `windowMs`, `resetTime`, and `cleanupInterval`. Consider adding a second cleanup pass that removes entries with expired window keys.

```typescript
// Optional: Add comment documenting the dependency
// CLEANUP: Entries are removed when resetTime < now.
// With windowMs=60000 and cleanupInterval=60000, max entry lifetime is ~120s.
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetTime < now) {
      store.delete(key);
    }
  }
}, 60000);
```

---

## Issue 6: `execFile` with User-Controlled URL in CurlFetchAdapter

**Severity**: [Low]

**Description**: The `CurlFetchAdapter.fetchHtml()` method passes a URL to the `curl` binary via `execFile` (`src/adapters/curl-fetch.ts`, line 47). While `execFile` avoids shell injection (no `/bin/sh` intermediary), and the URL is validated at the API route layer, the adapter itself performs no validation. If this adapter is ever called outside the API route context (e.g., from an internal queue processor or future direct invocation), an unvalidated URL could contain argument-injection payloads targeting `curl`, such as `--output` or `--header` flags embedded in the URL string passed as a positional argument.

**Location**: `src/adapters/curl-fetch.ts`, lines 46–66.

**Fix**: Validate the URL within the adapter using the same `isHttpUrl()` validator or at minimum verify the URL starts with `http://` or `https://` before passing it to `curl`.

```typescript
import { isValidUrl } from "../utils/url.js";

async fetchHtml(url: string, options: CurlFetchOptions = {}): Promise<CurlFetchResult> {
  // Defensive URL validation at adapter boundary
  if (!/^https?:\/\/.+/.test(url)) {
    return {
      ok: false,
      reason: "invalid_url",
      message: "URL must use http or https protocol",
    };
  }
  // ... rest of method
}
```

---

## Issue 7: `dangerouslySetInnerHTML` Used for CSS Styles

**Severity**: [Low]

**Description**: In `src/components/layout.tsx` (line 80 and 175), the `<style>` tag uses `dangerouslySetInnerHTML` to inject CSS from `components/styles.ts`. The `css` import is a developer-controlled string constant, not user input, so this is not an XSS vector in practice. However, the use of `dangerouslySetInnerHTML` for a compile-time constant is misleading and could desensitize developers to its presence, leading to more dangerous uses in future components.

**Location**: `src/components/layout.tsx`, lines 80 and 175.

**Fix**: Replace `dangerouslySetInnerHTML` with a standard JSX child expression if Hono JSX supports it, or document why it is safe.

```tsx
// If Hono JSX supports text content in <style>:
<style>{css}</style>

// Otherwise add a comment explaining safety:
{/* Safe: css is a build-time constant from styles.ts */}
<style dangerouslySetInnerHTML={{ __html: css }} />
```

---

## Issue 8: Global Mutable Singleton Engine

**Severity**: [Low]

**Description**: `src/core/engine.ts` uses a module-level `defaultEngine` variable (line 1084) that is set by `initializeEngine()` and read by `getDefaultEngine()`. This pattern makes integration testing difficult (tests cannot instantiate independent engines), couples all consumers to a single global instance, and prevents any future multi-engine use cases. The `bootstrap.ts` file even casts `initializeEngine` to accept a 5-argument overload to work around the exported signature (lines 36–42).

**Location**:
- `src/core/engine.ts`, lines 1084–1109 (singleton pattern)
- `src/bootstrap.ts`, lines 36–42 (type cast workaround)

**Fix**: Accept the engine as a dependency in route handlers rather than calling `getDefaultEngine()`. For a minimal change, remove the singleton and let `bootstrap.ts` pass the engine instance through function arguments or a lightweight DI container.

```typescript
// In bootstrap.ts — create engine without global singleton
const engine = new CoreScraperEngine(
  browserAdapter, llmAdapter, captchaAdapter, knownSitesAdapter, curlFetchAdapter
);
// Pass engine to route setup or app context
```

```typescript
// In routes/api/scrape.ts — receive engine as parameter
export function createScrapeRouter(engine: CoreScraperEngine): Hono {
  // ... use engine directly instead of getDefaultEngine()
}
```

---

## Issue 9: Scrape Error Messages May Leak Internal Paths

**Severity**: [Low]

**Description**: In `src/routes/api/scrape.ts`, when `engine.scrapeUrl()` throws (the outer catch block, lines 149–158), the error is sanitized by `sanitizeErrorForClient()`. However, the sanitizer falls through to a generic message for any error not matching its pattern list (`src/utils/error-sanitizer.ts`, lines 47–82). This is correct behavior. The risk is that filesystem errors, module-resolution errors, or other infrastructure errors could leak server paths. For example, an `ENOENT` error containing `/home/user/.../data/sites.jsonc` would be caught but the generic fallback prevents leakage — however, the sanitizer's pattern-matching approach is inherently incomplete; a message like `"ENOENT: no such file or directory, open '/data/sites.jsonc'"` would not match any of the defined patterns and would be returned as the generic message, which is safe. The current implementation is defensive but the pattern-based approach could be made more robust.

**Location**: `src/utils/error-sanitizer.ts`, lines 47–82.

**Fix**: Add a file-path-aware transform that strips paths from error messages before pattern-matching. This is a defense-in-depth improvement.

```typescript
function stripFilePaths(message: string): string {
  // Remove absolute and relative paths from error messages
  return message
    .replace(/(?:\/[\w.-]+)+/g, "[path]")
    .replace(/\.\/[\w./-]+/g, "[path]");
}

export function sanitizeErrorForClient(error: unknown): string {
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  const message = stripFilePaths(rawMessage);
  // ... rest of existing pattern matching
}
```

---

## Issue 10: `parseBody()` Used Without Type Guards in Login Route

**Severity**: [Low]

**Description**: In `src/routes/dashboard/login.tsx` (line 69–70), the login POST handler calls `await c.req.parseBody()` and then casts `body.token as string`. If `parseBody()` returns a `FormData` object with complex types, or if `body.token` is a `File` object (possible with multipart form submissions), the cast to `string` is incorrect at runtime. The downstream `validateToken(token)` function compares using `===`, so a non-string would fail validation harmlessly, but this represents fragile type handling.

**Location**: `src/routes/dashboard/login.tsx`, lines 69–71.

**Fix**: Add an explicit type guard check.

```typescript
loginRouter.post("/", async (c) => {
  const body = await c.req.parseBody();
  const token = typeof body.token === "string" ? body.token : "";
  const redirect = getSafeDashboardRedirect(c.req.query("redirect"));
  // ... rest
});
```

---

## Issue 11: Log File Stream Opened Unnecessarily in Non-Debug Mode

**Severity**: [Low]

**Description**: In `src/utils/logger.ts`, the `writeToFile()` function lazily initializes the log file stream on first call. However, it also checks `debugEnabled`, which defaults to `false`. In non-debug modes, the log directory and file stream are still created but never written to, and the file stream remains open for the process lifetime, consuming a file descriptor. The `initLogFile()` function also always sets up the file stream even when `logLevel` is `INFO` or higher.

**Location**: `src/utils/logger.ts`, lines 200–262, 355–373.

**Fix**: Skip file stream creation entirely when debug mode is off. Check `shouldLog("DEBUG")` or `debugEnabled` before calling `initLogFile()`.

```typescript
function writeToFile(entry: LogEntry) {
  // Early exit if debug logging is disabled — avoids unnecessary FS operations
  if (!debugEnabled) return;

  if (!logFileStream) {
    initLogFile();
  }
  // ... rest
}
```

---

## Issue 12: Config Module Reads `.env` at Import Time

**Severity**: [Low]

**Description**: `src/config.ts` (lines 9–11) reads and parses `.env` via `dotenv.config()` at module import time, before `initConfig()` is called. This is a side effect that happens when any file imports from `config.ts`. While this is the conventional pattern for `dotenv`, it means the environment is mutated before any explicit initialization, making testing harder and the control flow implicit.

**Location**: `src/config.ts`, lines 8–11.

**Fix**: Move `dotenv.config()` into `initConfig()` or `parseConfig()`, or use a dedicated bootstrap step.

```typescript
// Remove the top-level dotenv call (lines 9-11).
// Move into initConfig:
export function initConfig(): Config {
  if (config !== null) {
    return config;
  }
  // Load .env before parsing configuration
  if (fs.existsSync(".env")) {
    dotenv.config();
  }
  config = parseConfig();
  return config;
}
```

---

## Issue 13: SSE Broadcast Lacks Backpressure Handling

**Severity**: [Low]

**Description**: In `src/routes/dashboard/index.tsx`, the `broadcast()` function (lines 99–125) iterates over all SSE clients and calls `controller.enqueue()` for each. If a client's ReadableStream is full (not being consumed fast enough), `enqueue()` can throw or block. The current error handling logs and removes the client, but backpressure on a slow client can delay broadcast to all other clients. In production with many SSE connections, a single slow client could stall the broadcast loop.

**Location**: `src/routes/dashboard/index.tsx`, lines 113–124.

**Fix**: Use `controller.desiredSize` to check backpressure before enqueuing, or use a non-blocking pattern.

```typescript
for (const client of clients) {
  try {
    if (client.controller.desiredSize === null || client.controller.desiredSize > 0) {
      client.controller.enqueue(new TextEncoder().encode(event));
    } else {
      // Client is not keeping up — drop or close
      logger.debug("[SSE] Client backpressured, closing");
      client.controller.close();
      clients.delete(client);
    }
  } catch (error) {
    logger.debug("[SSE] Client disconnected, removing");
    clients.delete(client);
  }
}
```

---

## Summary

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| 1 | No CSRF protection on login endpoint | High | Security |
| 2 | Hardcoded fallback session secret | Medium | Security |
| 3 | Session cookie `secure` flag fragile behind reverse proxy | Medium | Security |
| 4 | Duplicated XPath validation constants | Medium | Maintainability |
| 5 | Rate limit store key rotation coupling | Low | Correctness |
| 6 | `execFile` with user-controlled URL in CurlFetchAdapter | Low | Defense-in-depth |
| 7 | `dangerouslySetInnerHTML` for compile-time CSS | Low | Code quality |
| 8 | Global mutable singleton engine | Low | Architecture |
| 9 | Scrape error path sanitization | Low | Defense-in-depth |
| 10 | `parseBody()` without type guard in login route | Low | Type safety |
| 11 | Log file stream opened unnecessarily in non-debug mode | Low | Resource |
| 12 | `.env` loaded at import time | Low | Testability |
| 13 | SSE broadcast lacks backpressure handling | Low | Reliability |

**Overall Assessment**: The codebase is well-structured with clear port/adapter separation, proper input validation via Zod in API routes, and thoughtful error sanitization. The most actionable finding is the missing CSRF protection on the login endpoint (Issue 1). The hardcoded fallback secret (Issue 2) should be removed as a defense-in-depth measure even though it is not currently exploitable. The remainder are maintainability and robustness improvements appropriate for a mature production codebase.
