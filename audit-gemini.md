**Issue Title**: Remote Code Execution via Puppeteer Sandbox Disablement
**Severity**: [Critical]
**Description**: The application uses Puppeteer to scrape external, untrusted websites but globally disables Chromium's security sandbox by passing `--no-sandbox` and `--disable-setuid-sandbox`. The sandbox is a critical security boundary that prevents malicious websites from executing code outside the browser tab. By disabling it, any zero-day or unpatched vulnerability in the Chromium renderer process (such as a V8 JavaScript engine exploit) allows an attacker to achieve full Remote Code Execution (RCE) on the host server.
**Location**: `/src/adapters/puppeteer-browser.ts`, lines 170-173
**Fix**: Remove the sandbox-disabling arguments. If the application is running inside a Docker container, configure the container with the necessary security profile (e.g., using a custom seccomp profile or `--cap-add=SYS_ADMIN`) rather than disabling the sandbox completely.

```typescript
    // Remove these lines from buildLaunchArgs
    // '--no-sandbox',
    // '--disable-setuid-sandbox',
```

**Issue Title**: Server-Side Request Forgery (SSRF) in Scraping Endpoints
**Severity**: [High]
**Description**: The `/api/scrape` and dashboard test endpoints validate that a target URL uses the `http:` or `https:` protocol, but they do not restrict the destination IP address or hostname. An authenticated attacker can supply URLs pointing to internal network infrastructure, localhost (`http://127.0.0.1`), or cloud metadata services (e.g., `http://169.254.169.254/latest/meta-data/`). The server will fetch and return the contents of these protected internal resources.
**Location**: `/src/routes/api/scrape.ts`, lines 24-34
**Fix**: Implement strict URL validation that resolves the hostname to an IP address and blocks requests to private CIDR ranges, loopback addresses, and local domains before passing the URL to Puppeteer or Curl.

```typescript
import dns from 'dns/promises';

async function isSafeHttpUrl(value: string): Promise<boolean> {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    
    const addresses = await dns.resolve(parsed.hostname);
    const ip = addresses[0];
    
    // Block local and private IPv4 ranges
    if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(ip)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
```

**Issue Title**: CSRF Token Overwrite on GET Requests Disrupts UI
**Severity**: [High]
**Description**: The CSRF middleware unconditionally generates a new token and overwrites the `csrf_token` cookie on every single `GET` request. In an HTMX-driven application, background partial page reloads (such as clicking a pagination link) issue `GET` requests that replace the cookie with a new token. However, the DOM retains the old token in its headers. Subsequent `POST` requests fail with a "CSRF token validation failed" error, persistently breaking the application's core functionality for active users.
**Location**: `/src/middleware/csrf.ts`, lines 12-21
**Fix**: Only generate and set a new CSRF token if one does not already exist in the incoming request cookies.

```typescript
export const csrfMiddleware = createMiddleware(async (c, next) => {
  if (c.req.method === 'GET') {
    let token = getCookie(c, CSRF_COOKIE);
    if (!token) {
      token = crypto.randomUUID();
      setCookie(c, CSRF_COOKIE, token, {
        httpOnly: false,
        path: '/',
        sameSite: 'Strict',
        maxAge: 3600
      });
    }
    c.set('csrfToken', token);
    await next();
    return;
  }
  // ... existing validation logic
});
```

**Issue Title**: Timing Attack Vulnerability in Authentication
**Severity**: [Medium]
**Description**: The authentication middleware compares the user-provided API token and session cookie against the configured secrets using standard string equality operators (`!==` and `===`). Standard comparison operators return `false` as soon as a character mismatch is encountered. This varying execution time leaks information about the length of the matching prefix, potentially allowing a determined attacker to brute-force the API token or session hashes character by character.
**Location**: `/src/middleware/auth.ts`, lines 28, 48, and 76
**Fix**: Use Node.js's `crypto.timingSafeEqual` to perform constant-time string comparisons.

```typescript
import { timingSafeEqual } from 'crypto';

function secureCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Replace standard comparisons with secureCompare:
// if (!secureCompare(token, apiToken)) { ... }
```

**Issue Title**: IP-Based Rate Limiting Evasion via X-Forwarded-For
**Severity**: [Medium]
**Description**: The rate-limiting middleware identifies unauthenticated clients by parsing the `x-forwarded-for` HTTP header. If the application is exposed directly to the internet or isn't running behind a trusted reverse proxy configured to strictly override this header, an attacker can easily spoof the `X-Forwarded-For` header in their requests. This allows them to trivially bypass all rate limits by passing a different forged IP address per request.
**Location**: `/src/middleware/rate-limit.ts`, lines 33-35, 49
**Fix**: Use the direct client IP address provided by the socket (`c.env.incoming.socket.remoteAddress` or Hono's equivalent `c.req.header('x-real-ip')` if behind a trusted proxy). Do not trust `x-forwarded-for` unless the application explicitly ensures requests traverse a secure proxy.

```typescript
function getRateLimitIdentifier(c: Context): string {
  const bearerToken = getBearerToken(c.req.header("Authorization"));
  if (bearerToken) return hashIdentifier("auth", bearerToken);

  // Fallback to a trusted IP source or direct socket IP
  // Ensure the reverse proxy configuration is trusted before using headers
  const ip = c.req.header("x-real-ip") || "unknown"; 
  return hashIdentifier("ip", ip);
}
```

**Issue Title**: XPath Injection in HTML Cleaner
**Severity**: [Low]
**Description**: The `cleanHtml` utility parses and removes unwanted classes from the DOM using XPath queries. User-supplied class names from the site configuration (`siteCleanupClasses`) are directly interpolated into the XPath string literal: `//*[contains(@class, "${cls}")]`. If an authenticated user supplies a class name containing a closing quote and bracket (e.g., `")] | //* | //*[contains(@class, "`), they can manipulate the XPath query. While this does not compromise underlying data, it can cause the HTML cleaner to crash or inappropriately drop necessary content nodes.
**Location**: `/src/utils/html-cleaner.ts`, line 56
**Fix**: Strip out or escape double quotes from the user-provided class names before injecting them into the XPath string.

```typescript
  const classSelectors = classesToRemove.map(cls => {
    const safeCls = cls.replace(/"/g, '');
    return `//*[contains(@class, "${safeCls}")]`;
  });
```