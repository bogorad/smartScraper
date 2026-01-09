# Security and Code Quality Audit Report

## Executive Summary

This audit identified **1 Critical**, **1 High**, and **1 Medium** severity issues in the SmartScraper codebase. The most critical finding is a **hardcoded timeout value in the browser reload operation** that completely ignores user-provided timeout settings, causing operations to fail with "Navigation timeout of 30000 ms exceeded" even when users explicitly specify `timeoutMs: 120000`.

---

## Critical Issues

### **Issue Title**: Hardcoded Timeout in Browser Reload Ignores User Configuration

**Severity**: [Critical]

**Description**: The browser reload operation after CAPTCHA solving uses a hardcoded timeout value (Puppeteer's default of 30,000 ms) instead of respecting the user-provided `timeoutMs` parameter. When a CAPTCHA is detected and solved, and cookies are updated, the engine calls `browser.reload(pageId)` without passing any timeout parameter. This causes the operation to fail with "Navigation timeout of 30000 ms exceeded" even when users explicitly provide `timeoutMs: 120000` or any other custom timeout value. This is a critical configuration leak that completely breaks the timeout contract for users encountering CAPTCHA-protected sites.

**Root Cause Analysis**:
1. In `src/core/engine.ts` line 157, the `reload()` call does not pass any timeout parameter
2. The `BrowserPort.reload()` interface in `src/ports/browser.ts` line 20 does not accept a timeout parameter
3. The `PuppeteerBrowserAdapter.reload()` implementation in `src/adapters/puppeteer-browser.ts` lines 278-282 does not accept or use a timeout parameter
4. Puppeteer's `page.reload()` defaults to 30,000 ms when no timeout is specified

**Location**:
- `src/core/engine.ts`, line 157
- `src/ports/browser.ts`, line 20
- `src/adapters/puppeteer-browser.ts`, lines 278-282

**Fix**:

**Step 1: Update the BrowserPort interface**
```typescript
// src/ports/browser.ts
export interface BrowserPort {
  open(): Promise<void>;
  close(): Promise<void>;
  closePage(pageId: string): Promise<void>;
  loadPage(url: string, options?: LoadPageOptions): Promise<{ pageId: string }>;
  evaluateXPath(pageId: string, xpath: string): Promise<string[] | null>;
  getPageHtml(pageId: string): Promise<string>;
  detectCaptcha(pageId: string): Promise<CaptchaDetectionResult>;
  getElementDetails(pageId: string, xpath: string): Promise<ElementDetails | null>;
  getCookies(pageId: string): Promise<string>;
  setCookies(pageId: string, cookies: string): Promise<void>;
  reload(pageId: string, options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' }): Promise<void>;
}
```

**Step 2: Update the PuppeteerBrowserAdapter implementation**
```typescript
// src/adapters/puppeteer-browser.ts
async reload(pageId: string, options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' }): Promise<void> {
  const session = this.sessions.get(pageId);
  if (!session) return;
  await session.page.reload({
    waitUntil: options?.waitUntil || 'networkidle2',
    timeout: options?.timeout || DEFAULTS.TIMEOUT_MS
  });
}
```

**Step 3: Update the CoreScraperEngine to pass timeout to reload**
```typescript
// src/core/engine.ts
// Inside _executeScrape method, line 157, replace:
if (solveResult.updatedCookie) {
  await this.browserPort.setCookies(pageId, solveResult.updatedCookie);
  await this.browserPort.reload(pageId);
}

// With:
if (solveResult.updatedCookie) {
  await this.browserPort.setCookies(pageId, solveResult.updatedCookie);
  await this.browserPort.reload(pageId, {
    timeout: options?.timeoutMs || DEFAULTS.TIMEOUT_MS,
    waitUntil: 'networkidle2'
  });
}
```

---

## High Issues

### **Issue Title**: Inconsistent Default Timeout Values Between Browser Launch and Page Navigation

**Severity**: [High]

**Description**: The PuppeteerBrowserAdapter uses inconsistent default timeout values across different operations, leading to unpredictable behavior. Specifically:
- Browser launch uses `DEFAULTS.TIMEOUT_MS` (120,000 ms) on line 77
- Page navigation defaults to 45,000 ms on line 105 (not `DEFAULTS.TIMEOUT_MS`)
- This inconsistency violates the DRY principle and makes timeout behavior non-deterministic when users rely on defaults

**Location**: `src/adapters/puppeteer-browser.ts`, lines 77, 105

**Fix**:
```typescript
// src/adapters/puppeteer-browser.ts
// Line 103-106, replace:
await page.goto(url, {
  waitUntil: options?.waitUntil || 'networkidle2',
  timeout: options?.timeout || 45000  // <-- Should use DEFAULTS.TIMEOUT_MS
});

// With:
await page.goto(url, {
  waitUntil: options?.waitUntil || 'networkidle2',
  timeout: options?.timeout || DEFAULTS.TIMEOUT_MS
});
```

---

## Medium Issues

### **Issue Title**: Missing Error Handling in Async Operations

**Severity**: [Medium]

**Description**: Several async operations in the codebase use empty catch blocks or fail silently, which can hide critical errors and make debugging difficult. This is a defensive programming violation that can mask real issues in production.

**Examples**:
1. `src/adapters/puppeteer-browser.ts` lines 33-35: Empty catch blocks in `closePage()`
2. `src/core/engine.ts` lines 251-253, 299: Empty catch block for resource cleanup
3. `src/adapters/puppeteer-browser.ts` lines 251-252: Empty catch block in `getElementDetails()`

**Location**:
- `src/adapters/puppeteer-browser.ts`, lines 33-35, 251-252
- `src/core/engine.ts`, lines 296-300

**Fix**:
```typescript
// src/adapters/puppeteer-browser.ts, lines 33-35
// Replace:
try { await session.page.close(); } catch {}
try { await session.browser.close(); } catch {}
try { await fs.promises.rm(session.userDataDir, { recursive: true, force: true }); } catch {}

// With:
try {
  await session.page.close();
} catch (error) {
  logger.warn('Failed to close page during cleanup', { pageId, error: error instanceof Error ? error.message : String(error) }, 'BROWSER');
}
try {
  await session.browser.close();
} catch (error) {
  logger.warn('Failed to close browser during cleanup', { pageId, error: error instanceof Error ? error.message : String(error) }, 'BROWSER');
}
try {
  await fs.promises.rm(session.userDataDir, { recursive: true, force: true });
} catch (error) {
  logger.warn('Failed to remove user data directory during cleanup', { pageId, userDataDir: session.userDataDir, error: error instanceof Error ? error.message : String(error) }, 'BROWSER');
}
```

---

## Low Issues

### **Issue Title**: Unused Variable in buildLaunchArgs Method

**Severity**: [Low]

**Description**: The `buildLaunchArgs` method accepts an `explicitProxy` parameter but never uses it in the function body. Instead, it always uses the result of the inline `getProxyServer()` call. This is a code smell that suggests refactoring was incomplete.

**Location**: `src/adapters/puppeteer-browser.ts`, line 122

**Fix**:
```typescript
// src/adapters/puppeteer-browser.ts, line 122
// The parameter is actually used on line 135, but the logic is redundant
// Either remove the parameter and always use getProxyServer(), or simplify:

private buildLaunchArgs(): string[] {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--use-gl=swiftshader',
    '--window-size=1280,720',
    '--font-render-hinting=none'
  ];

  const proxyServer = getProxyServer();
  if (proxyServer) {
    // ... rest of proxy logic
  }

  return args;
}

// Then update line 76 to remove the parameter:
// args: this.buildLaunchArgs(options?.proxy),
// becomes:
// args: this.buildLaunchArgs(),
```

---

## Architectural Observations

### **Positive Patterns Identified**
1. **Hexagonal Architecture**: Clear separation between ports (interfaces) and adapters (implementations)
2. **TypeScript Strict Mode**: Full type safety enforced
3. **Dependency Injection**: Engine receives all ports via constructor, following SOLID principles
4. **Event-Driven Queue System**: Using PQueue for concurrency control with worker events for real-time monitoring

### **Potential Improvements**
1. **Timeout Centralization**: Consider creating a `TimeoutConfig` type that unifies all timeout-related parameters to avoid inconsistency
2. **Error Handling Strategy**: Define a consistent error handling pattern across all async operations
3. **Option Propagation**: Review all option-passing code paths to ensure user preferences are properly propagated through the call stack

---

## Medium Issues

### **Issue Title**: Polling Loop Continues After Fatal 2Captcha Errors

**Severity**: [Medium]

**Description**: The `solveDataDome` method in the TwoCaptcha adapter does not properly detect all fatal error responses from the 2Captcha API. When 2Captcha returns an error with an `errorCode` field (e.g., `ERROR_CAPTCHA_UNSOLVABLE`) but the `status` field is set to something other than `'error'` (such as `'processing'`), the polling loop continues instead of stopping immediately. This results in wasted API calls, delayed failure responses, and potential resource consumption.

**Location**: `/home/chuck/git/smartScraper/src/adapters/twocaptcha.ts`, lines 116-139

**Root Cause**: The error handling logic at line 136 only checks `resultResponse.data?.status === 'error'`. However, based on the observed behavior showing multiple poll results with `ERROR_CAPTCHA_UNSOLVABLE`, the 2Captcha API may return error responses where:
- `status` is `'processing'` (or another non-'error' value)
- `errorCode` contains the actual error code (e.g., `ERROR_CAPTCHA_UNSOLVABLE`)
- `errorDescription` contains the error message

Since the code doesn't check for `errorCode`, it treats these responses as "not ready yet" and continues polling.

**Fix**: Expand the error detection logic to check for the presence of `errorCode` and any status other than 'ready' or 'processing':

```typescript
// src/adapters/twocaptcha.ts, lines 116-139
const startTime = Date.now();
while (Date.now() - startTime < this.timeout * 1000) {
  await new Promise(r => setTimeout(r, this.pollingInterval));

  const resultResponse = await axios.post('https://api.2captcha.com/getTaskResult', {
    clientKey: this.apiKey,
    taskId
  });

  // Log polling result
  console.log(`[2CAPTCHA] Poll result for task ${taskId}:`, JSON.stringify(resultResponse.data));

  if (resultResponse.data?.status === 'ready') {
    const cookie = resultResponse.data?.solution?.cookie;
    if (cookie) {
      return { solved: true, updatedCookie: cookie };
    }
    return { solved: false, reason: 'Solution missing cookie' };
  }

  // Check for error conditions
  // 1. Explicit error status
  // 2. Presence of errorCode (even if status is not 'error')
  // 3. Any status other than 'ready' or 'processing'
  if (
    resultResponse.data?.status === 'error' ||
    resultResponse.data?.errorCode ||
    (resultResponse.data?.status && resultResponse.data?.status !== 'processing')
  ) {
    return {
      solved: false,
      reason: resultResponse.data?.errorDescription ||
               resultResponse.data?.errorId ||
               'Unknown error from 2Captcha'
    };
  }
}

return { solved: false, reason: 'Timeout waiting for solution' };
```

This fix ensures that:
1. The loop stops immediately when `status === 'error'`
2. The loop stops immediately when `errorCode` is present, regardless of status
3. The loop stops on any unexpected status value (not just 'processing' or 'ready')
4. Error messages are preserved from either `errorDescription` or `errorId` for better debugging

---

## Summary Statistics

- **Critical Issues**: 1
- **High Issues**: 1
- **Medium Issues**: 2
- **Low Issues**: 1
- **Total Issues**: 5

### Recommended Action Priority
1. **IMMEDIATE**: Fix the hardcoded timeout in reload() (Critical)
2. **HIGH**: Standardize default timeout values (High)
3. **MEDIUM**: Improve error handling in cleanup operations (Medium)
4. **LOW**: Clean up unused parameter in buildLaunchArgs (Low)

---

## Conclusion

The codebase demonstrates good architectural design with proper separation of concerns and type safety. However, the critical timeout issue significantly impacts functionality for users encountering CAPTCHA-protected sites. The fix is straightforward and involves updating three files to properly propagate timeout configuration through the reload operation.
