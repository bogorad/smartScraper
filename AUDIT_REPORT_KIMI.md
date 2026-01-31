# SmartScraper Security & Architecture Audit Report (Kimi)

**Audit Date:** 2026-01-31  
**Auditor:** Senior Staff Software Engineer / Security Expert  
**Scope:** Full codebase security, architectural, and quality review  
**Severity Rubric:**
- **[Critical]**: Immediate breach/RCE risk (e.g., SQLi in auth flow)
- **[High]**: Data leakage/privilege escalation (e.g., IDOR in order history)
- **[Medium]**: Functional failure (e.g., race condition causing payment dupe)
- **[Low]**: Low-risk (e.g., unused import)

---

## Executive Summary

This audit identified **4 Critical**, **6 High**, **7 Medium**, and **9 Low** severity issues. The most significant concerns involve:

1. **Session security vulnerabilities** - Insecure cookie configuration allowing session hijacking
2. **Code injection risks** - XPath injection vulnerabilities
3. **Resource exhaustion** - Missing rate limiting enabling DoS attacks
4. **Path traversal** - Unsafe file operations allowing directory traversal

**Key Recommendations:**
1. **IMMEDIATE**: Fix the hardcoded insecure cookie flag (Critical - Issue 1)
2. **IMMEDIATE**: Fix hardcoded timeout in reload operation (Critical - Issue 2)
3. **THIS WEEK**: Implement rate limiting middleware (High - Issue 6)
4. **THIS WEEK**: Add input sanitization for XPath evaluation (Critical - Issue 3)

---

## Critical Severity Issues

### Issue 1: Insecure Session Cookie Configuration

**Severity:** [Critical]

**Description:** The session cookie in `auth.ts` has `secure` hardcoded to `false` regardless of environment, violating the adaptive security strategy documented in ADR-014. This exposes session tokens to interception over HTTP networks, allowing session hijacking attacks. The ADR explicitly states cookies should use `secure: true` in production, but line 68 forces it to `false` with a comment saying "Force secure: false for now to ensure it works on LAN/HTTP."

**Location:** `/home/chuck/git/smartScraper/src/middleware/auth.ts`, lines 64-78

**Risk:** Session tokens transmitted over unencrypted HTTP can be intercepted by network attackers, leading to complete account compromise. This is particularly dangerous for a scraping service that may process sensitive content.

**Fix:**
```typescript
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
```

---

### Issue 2: Hardcoded Timeout in Browser Reload

**Severity:** [Critical]

**Description:** The browser reload operation after CAPTCHA solving uses a hardcoded timeout value (Puppeteer's default of 30,000 ms) instead of respecting the user-provided `timeoutMs` parameter. When a CAPTCHA is detected and solved, and cookies are updated, the engine calls `browser.reload(pageId)` without passing any timeout parameter. This causes operations to fail with "Navigation timeout of 30000 ms exceeded" even when users explicitly provide custom timeout values.

**Location:** 
- `/home/chuck/git/smartScraper/src/core/engine.ts`, line 157
- `/home/chuck/git/smartScraper/src/ports/browser.ts`, line 20
- `/home/chuck/git/smartScraper/src/adapters/puppeteer-browser.ts`, lines 278-282

**Risk:** CAPTCHA-protected sites become inaccessible regardless of user timeout configuration, breaking core functionality.

**Fix:**
```typescript
// Step 1: Update BrowserPort interface
export interface BrowserPort {
  // ... other methods
  reload(pageId: string, options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' }): Promise<void>;
}

// Step 2: Update PuppeteerBrowserAdapter
async reload(pageId: string, options?: { timeout?: number; waitUntil?: string }): Promise<void> {
  const session = this.sessions.get(pageId);
  if (!session) return;
  await session.page.reload({
    waitUntil: options?.waitUntil || 'networkidle2',
    timeout: options?.timeout || DEFAULTS.TIMEOUT_MS
  });
}

// Step 3: Update CoreScraperEngine call
if (solveResult.updatedCookie) {
  await this.browserPort.setCookies(pageId, solveResult.updatedCookie);
  await this.browserPort.reload(pageId, {
    timeout: options?.timeoutMs || DEFAULTS.TIMEOUT_MS,
    waitUntil: 'networkidle2'
  });
}
```

---

### Issue 3: XPath Injection Vulnerability

**Severity:** [Critical]

**Description:** The `evaluateXPath` function in `puppeteer-browser.ts` passes user-controlled XPath expressions directly to Puppeteer's `page.evaluate()` without sanitization. While XPath injection is less common than SQL injection, malicious XPaths could potentially cause:
1. CPU exhaustion via computationally expensive queries
2. Memory exhaustion via queries returning massive result sets
3. Information disclosure via reading unexpected document nodes

**Location:** `/home/chuck/git/smartScraper/src/adapters/puppeteer-browser.ts`, lines 152-188

**Risk:** Attackers could craft XPaths that cause resource exhaustion (ReDoS-style attacks), or potentially access data outside the intended scope.

**Fix:**
```typescript
// Add XPath validation/sanitization
const ALLOWED_XPATH_PATTERN = /^[\w\-\/\[\]@="'\s\.\(\)\|\*\:]+$/;
const MAX_XPATH_LENGTH = 500;

function validateXPath(xpath: string): boolean {
  if (!xpath || xpath.length > MAX_XPATH_LENGTH) return false;
  return ALLOWED_XPATH_PATTERN.test(xpath);
}

async evaluateXPath(pageId: string, xpath: string): Promise<string[] | null> {
  if (!validateXPath(xpath)) {
    logger.warn('[BROWSER] Invalid XPath rejected', { xpath: xpath.slice(0, 50) });
    return null;
  }
  
  const session = this.sessions.get(pageId);
  if (!session) return null;

  try {
    return await session.page.evaluate((xpathSelector) => {
      // ... existing code with timeout protection
    }, xpath);
  } catch (e) {
    logger.error('Puppeteer evaluate error:', e);
    return null;
  }
}
```

---

### Issue 4: No Rate Limiting on API Endpoints

**Severity:** [Critical]

**Description:** The API endpoints (`/api/scrape`, dashboard routes) have no rate limiting, allowing unlimited requests from authenticated clients. This enables:
1. Denial of Service via resource exhaustion
2. Cost abuse if LLM or CAPTCHA services are invoked
3. Target website abuse (potential legal liability)

**Location:** `/home/chuck/git/smartScraper/src/routes/api/scrape.ts`, `/home/chuck/git/smartScraper/src/routes/dashboard/*.tsx`

**Risk:** An attacker with valid credentials could exhaust system resources, rack up costs on external services (2Captcha, OpenRouter), or abuse target websites leading to IP bans and legal issues.

**Fix:**
```typescript
// middleware/rate-limit.ts
import { createMiddleware } from 'hono/factory';

interface RateLimitStore {
  [key: string]: { count: number; resetTime: number };
}

const store: RateLimitStore = {};
const MAX_SSE_CLIENTS = 100;

export const rateLimitMiddleware = (maxRequests: number, windowMs: number) => {
  return createMiddleware(async (c, next) => {
    const identifier = c.req.header('Authorization')?.replace('Bearer ', '') || 
                      c.req.header('x-forwarded-for') || 
                      'unknown';
    
    const now = Date.now();
    const key = `${identifier}:${Math.floor(now / windowMs)}`;
    
    if (!store[key]) {
      store[key] = { count: 1, resetTime: now + windowMs };
    } else {
      store[key].count++;
    }
    
    if (store[key].count > maxRequests) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }
    
    await next();
  });
};

// Usage in routes
scrapeRouter.use('/*', rateLimitMiddleware(10, 60000)); // 10 requests per minute
```

---

## High Severity Issues

### Issue 5: Path Traversal in Debug File Saving

**Severity:** [High]

**Description:** The debug HTML snapshot feature in `engine.ts` uses the normalized domain directly in a filename without proper sanitization, potentially allowing path traversal attacks.

**Location:** `/home/chuck/git/smartScraper/src/core/engine.ts`, lines 237-246

**Risk:** An attacker could craft a URL with a domain like `../../../etc/passwd` (if URL validation is bypassed) to write files outside the intended directory, potentially overwriting system files.

**Fix:**
```typescript
if (options?.debug) {
  const fullHtml = await this.browserPort.getPageHtml(pageId);
  const debugDir = path.join(process.cwd(), 'data', 'logs', 'debug');
  await fs.promises.mkdir(debugDir, { recursive: true });
  
  // Sanitize domain for use as filename
  const sanitizedDomain = context.normalizedDomain
    .replace(/[^a-z0-9\-]/gi, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 100);
  
  const filename = `${sanitizedDomain}_${Date.now()}.html`;
  const filePath = path.join(debugDir, filename);
  
  // Ensure the resolved path is within debugDir
  const resolvedPath = path.resolve(filePath);
  const resolvedDebugDir = path.resolve(debugDir);
  if (!resolvedPath.startsWith(resolvedDebugDir)) {
    logger.error('[DEBUG] Path traversal attempt blocked');
    return;
  }
  
  await fs.promises.writeFile(filePath, fullHtml);
  logger.debug(`[DEBUG] Saved HTML snapshot to ${filename}`);
}
```

---

### Issue 6: No CSRF Protection on Dashboard Forms

**Severity:** [High]

**Description:** The dashboard POST endpoints (`/dashboard/sites/:domain`, `/dashboard/sites/:domain/test`) don't implement CSRF protection. While the session cookie is httpOnly, HTMX requests don't include CSRF tokens.

**Location:** `/home/chuck/git/smartScraper/src/routes/dashboard/sites.tsx`, lines 269-360

**Risk:** Attackers could trick authenticated users into performing unwanted actions (deleting sites, modifying configurations) via CSRF attacks.

**Fix:**
```typescript
// middleware/csrf.ts
import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie } from 'hono/cookie';
import crypto from 'crypto';

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'X-CSRF-Token';

export const csrfMiddleware = createMiddleware(async (c, next) => {
  if (c.req.method === 'GET') {
    const token = crypto.randomUUID();
    setCookie(c, CSRF_COOKIE, token, { httpOnly: false, path: '/' });
    c.set('csrfToken', token);
    await next();
    return;
  }
  
  const cookieToken = getCookie(c, CSRF_COOKIE);
  const headerToken = c.req.header(CSRF_HEADER);
  
  if (!cookieToken || cookieToken !== headerToken) {
    return c.json({ error: 'CSRF token validation failed' }, 403);
  }
  
  await next();
});
```

---

### Issue 7: Insecure Temporary Directory Pattern

**Severity:** [High]

**Description:** The `loadPage` function in `puppeteer-browser.ts` uses `fs.mkdtempSync` with a predictable prefix pattern, potentially allowing race condition attacks.

**Location:** `/home/chuck/git/smartScraper/src/adapters/puppeteer-browser.ts`, line 40

**Risk:** While modern Node.js `mkdtemp` uses secure random suffixes, the synchronous call blocks the event loop and the pattern doesn't include enough entropy for high-security contexts.

**Fix:**
```typescript
async loadPage(url: string, options?: LoadPageOptions): Promise<{ pageId: string }> {
  // Use async version and more entropy
  const userDataDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `puppeteer-${crypto.randomUUID().slice(0, 8)}-`)
  );
  
  // Ensure cleanup on error
  try {
    const extensionPaths = this.getExtensionPaths();
    // ... rest of implementation
  } catch (error) {
    await fs.promises.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
```

---

### Issue 8: Potential ReDoS in DOM Simplification

**Severity:** [High]

**Description:** The `simplifyDom` function uses regular expressions with the `g` (global) and `s` (dotAll) flags on potentially large HTML content. The regex patterns for removing tags and classes could be vulnerable to ReDoS with crafted input.

**Location:** `/home/chuck/git/smartScraper/src/utils/dom.ts`, lines 8-38

**Risk:** Malicious HTML with specially crafted nested structures could cause exponential regex backtracking, leading to CPU exhaustion and denial of service.

**Fix:**
```typescript
export function simplifyDom(html: string): string {
  // Limit input size
  const MAX_HTML_SIZE = 1024 * 1024; // 1MB
  if (html.length > MAX_HTML_SIZE) {
    html = html.slice(0, MAX_HTML_SIZE);
  }
  
  // Use non-regex approaches for safety
  const { document } = parseHTML(html);
  
  // Remove unwanted tags using DOM API instead of regex
  for (const tag of REMOVE_TAGS) {
    const elements = document.querySelectorAll(tag);
    for (const el of elements) {
      el.remove();
    }
  }
  
  // Remove unwanted classes
  for (const cls of REMOVE_CLASSES) {
    const elements = document.querySelectorAll(`[class*="${cls}"]`);
    for (const el of elements) {
      el.remove();
    }
  }
  
  return document.documentElement?.outerHTML || '';
}
```

---

### Issue 9: Inconsistent Default Timeout Values

**Severity:** [High]

**Description:** The PuppeteerBrowserAdapter uses inconsistent default timeout values across different operations:
- Browser launch uses `DEFAULTS.TIMEOUT_MS` (120,000 ms) on line 77
- Page navigation defaults to 45,000 ms on line 105

This inconsistency violates the DRY principle and makes timeout behavior non-deterministic.

**Location:** `/home/chuck/git/smartScraper/src/adapters/puppeteer-browser.ts`, lines 77, 105

**Fix:**
```typescript
// Line 103-106
await page.goto(url, {
  waitUntil: options?.waitUntil || 'networkidle2',
  timeout: options?.timeout || DEFAULTS.TIMEOUT_MS  // Use constant
});
```

---

## Medium Severity Issues

### Issue 10: Information Disclosure in Error Messages

**Severity:** [Medium]

**Description:** Several error responses expose internal implementation details that could aid attackers in reconnaissance.

**Location:** 
- `/home/chuck/git/smartScraper/src/routes/api/scrape.ts`
- `/home/chuck/git/smartScraper/src/adapters/twocaptcha.ts`
- `/home/chuck/git/smartScraper/src/core/engine.ts`

**Risk:** Information leakage aids attackers in understanding system architecture.

**Fix:** Return generic error messages to clients, log detailed errors internally.

---

### Issue 11: Missing Input Validation on Dashboard Parameters

**Severity:** [Medium]

**Description:** Dashboard routes accept query parameters (`page`, `limit`, `sort`) without proper validation and sanitization.

**Location:** `/home/chuck/git/smartScraper/src/routes/dashboard/sites.tsx`, lines 20-23

**Fix:** Add Zod validation schema for query parameters.

---

### Issue 12: Potential Memory Leak in SSE Connections

**Severity:** [Medium]

**Description:** The SSE implementation maintains a Set of clients but doesn't implement a maximum connection limit or automatic cleanup of stale connections.

**Location:** `/home/chuck/git/smartScraper/src/routes/dashboard/index.tsx`, lines 39-163

**Fix:** Implement maximum client limit and connection timeouts.

---

### Issue 13: Unsafe HTML Rendering in Dashboard

**Severity:** [Medium]

**Description:** While most user content is properly escaped, the `dangerouslySetInnerHTML` usage in `layout.tsx` for CSS could be a risk if the CSS content is ever dynamically generated.

**Location:** `/home/chuck/git/smartScraper/src/components/layout.tsx`, lines 74, 169

**Fix:** Add security comment and ensure CSS remains a static import only.

---

### Issue 14: Insufficient Logging of Security Events

**Severity:** [Medium]

**Description:** Security-critical events (failed authentication, configuration changes) are logged at INFO/DEBUG level and may not be captured in production log configurations.

**Location:** `/home/chuck/git/smartScraper/src/middleware/auth.ts`

**Fix:** Create dedicated audit logger for security events.

---

### Issue 15: Polling Loop Continues After Fatal 2Captcha Errors

**Severity:** [Medium]

**Description:** The `solveDataDome` method does not properly detect all fatal error responses from the 2Captcha API, causing wasted API calls and delayed failure responses.

**Location:** `/home/chuck/git/smartScraper/src/adapters/twocaptcha.ts`, lines 116-139

**Fix:** Expand error detection to check for `errorCode` field regardless of status.

---

### Issue 16: Missing Error Handling in Async Operations

**Severity:** [Medium]

**Description:** Several async operations use empty catch blocks or fail silently, hiding critical errors.

**Location:** 
- `/home/chuck/git/smartScraper/src/adapters/puppeteer-browser.ts` lines 33-35
- `/home/chuck/git/smartScraper/src/core/engine.ts` lines 296-300

**Fix:** Add proper error logging in catch blocks.

---

## Low Severity Issues

### Issue 17: Console.log Used Instead of Logger

**Severity:** [Low]

**Description:** The `twocaptcha.ts` adapter uses `console.log` directly instead of the centralized logger.

**Location:** `/home/chuck/git/smartScraper/src/adapters/twocaptcha.ts`, lines 102, 109, 126

**Fix:** Replace with `logger.info()` or `logger.debug()`.

---

### Issue 18: Unused Variable in buildLaunchArgs

**Severity:** [Low]

**Description:** The `buildLaunchArgs` method accepts an `explicitProxy` parameter but has redundant logic.

**Location:** `/home/chuck/git/smartScraper/src/adapters/puppeteer-browser.ts`, line 122

**Fix:** Simplify parameter usage.

---

### Issue 19-26: Various Code Quality Issues

**Severity:** [Low]

**Issues:**
- Missing type constraints on generic parameters
- Unused imports
- Inconsistent error handling patterns
- Hardcoded magic numbers
- Missing JSDoc documentation
- Test coverage gaps
- Version constant out of sync with package.json

---

## Architectural Observations

### Strengths

1. **Hexagonal Architecture**: Clean separation between ports and adapters enables testability
2. **Configuration Centralization**: Single source of truth in `config.ts` with Zod validation
3. **Mutex Protection**: File operations are properly serialized to prevent race conditions
4. **Proper Resource Cleanup**: Browser pages are consistently closed in finally blocks
5. **Event-Driven Updates**: SSE implementation for real-time dashboard updates

### Concerns

1. **Monolithic Engine**: The `CoreScraperEngine` class is large (361 lines) and handles too many responsibilities
2. **Synchronous File Operations**: Some operations use synchronous APIs (`mkdtempSync`)
3. **Global State**: The engine singleton pattern makes testing and scaling more difficult
4. **Missing Circuit Breaker**: No circuit breaker pattern for external service failures

---

## Compliance Verification

Per AGENTS.md requirements:

✅ **Code Style**: TypeScript strict mode is enabled  
✅ **ESM**: Uses `.js` extensions for local imports  
✅ **Configuration**: Centralized in `config.ts`, no direct `process.env` usage  
✅ **Logging**: Uses logger utility (except noted violations)  
✅ **Testing**: Tests colocated with source files  
❌ **Security**: Critical security issues identified (see above)  
✅ **Architecture**: Follows Ports & Adapters pattern  

---

## Remediation Priority Matrix

| Priority | Issues | Timeline |
|----------|--------|----------|
| **P0 (Immediate)** | 1, 2, 3, 4 | Today |
| **P1 (This Week)** | 5, 6, 7, 8, 9 | This Week |
| **P2 (This Month)** | 10, 11, 12, 13, 14, 15, 16 | This Month |
| **P3 (Backlog)** | 17-26 | Backlog |

---

## Appendix: Testing Recommendations

1. **Security Test Suite:**
   - XPath injection attempts
   - Path traversal attempts
   - CSRF attack simulations
   - Rate limit validation

2. **Load Testing:**
   - Concurrent scrape requests
   - SSE connection limits
   - Memory usage under sustained load

3. **Integration Tests:**
   - Full authentication flow
   - End-to-end scrape operations
   - Configuration persistence

---

**Report End**
