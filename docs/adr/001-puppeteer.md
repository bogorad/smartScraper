# ADR-001: Puppeteer Browser Configuration

- Status: Accepted
- Date: 2025-12-05
- Updated: 2026-02-05

## Context

SmartScraper requires a headless browser for scraping JavaScript-heavy sites and bypassing anti-bot measures. The browser must:

- Maintain session isolation between scrapes
- Support extensibility via Chrome extensions for ad blocking and paywall bypass
- Present a realistic fingerprint to avoid detection
- Extract content via XPath or return full body HTML

## Decision

### Runtime Configuration

**Environment Variables:**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EXECUTABLE_PATH` | No | `/usr/lib/chromium/chromium` | Path to Chromium/Chrome binary |
| `EXTENSION_PATHS` | No | - | Comma-separated paths to unpacked extensions |
| `PROXY_SERVER` | No | - | Proxy server (e.g., `socks5://host:port`) |

### Session Management

Each scrape gets a **fresh browser instance** with a unique temporary profile directory via `userDataDir`. The browser is launched in **headless** mode with extension support via Puppeteer's `enableExtensions` option.

**Execution Model:** Scrapes are processed with **configurable concurrency** (via `CONCURRENCY` env var, default: 1). Multiple scrapes can run in parallel, each with its own browser instance. Each scrape follows this lifecycle:

1. Launch new browser instance with fresh profile
2. Navigate to target URL
3. Extract content
4. Close browser and delete profile directory

There is **no browser reuse** between scrapes. This ensures complete isolation and prevents state leakage between requests.

```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';

const userDataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'puppeteer-user-data-')
);

const browser = await puppeteer.launch({
  executablePath: process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium',
  headless: true,
  pipe: true,
  userDataDir,
  args: launchArgs,
  timeout: 60000,
  ...(hasExtensions && { enableExtensions: extensionPaths })
});
```

On session close, the browser page is closed and the profile directory is deleted:

```typescript
async closePage(pageId: string) {
  const session = this.sessions.get(pageId);
  if (!session) return;
  
  await session.page.close();
  await session.browser.close();
  await fs.promises.rm(session.userDataDir, { recursive: true, force: true });
  this.sessions.delete(pageId);
}
```

### Extension Architecture

Extensions are loaded via Puppeteer's `enableExtensions` option:

```typescript
// extensionPaths from this.getExtensionPaths() (parses EXTENSION_PATHS env var)
const hasExtensions = extensionPaths.length > 0;

const browser = await puppeteer.launch({
  // ... other options
  ...(hasExtensions && { enableExtensions: extensionPaths })
});

// Wait for extensions to initialize (if any)
if (hasExtensions) {
  await new Promise(resolve => setTimeout(resolve, 2000));
}
```

**Required Extensions:**

| Extension | Purpose |
|-----------|---------|
| Ad blocker (uBlock Origin) | Block ads, trackers, annoyances |
| Paywall bypass | Remove overlay paywalls, clear cookies for article limits |
| Tab duplicator | Site-specific workarounds (e.g., WSJ.com) |

**Extension Communication:**

Extensions with service workers can be communicated with via `chrome.runtime.sendMessage`:

```typescript
async function findExtensionByIdentity(browser: Browser, identity: string) {
  const targets = await browser.targets();
  const serviceWorkers = targets.filter(
    t => t.type() === 'service_worker' && t.url().includes('chrome-extension://')
  );

  for (const worker of serviceWorkers) {
    const workerContext = await worker.worker();
    const response = await workerContext.evaluate(() => {
      return new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'identify' }, resolve);
      });
    });
    if (response?.identity === identity) {
      return worker;
    }
  }
  return null;
}
```

### User-Agent Configuration

Set a fixed Windows Chrome User-Agent to avoid headless detection:

```typescript
await page.setUserAgent(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
);
```

### Viewport Configuration

```typescript
await page.setViewport({ width: 1280, height: 720 });
```

### Content Extraction

**XPath Extraction:**

We primarily use `XPathResult.ORDERED_NODE_SNAPSHOT_TYPE` (7) to capture a static snapshot of matching nodes. This allows iterating over results safely even if the DOM changes.

```typescript
async function extractByXPath(page: Page, xpath: string): Promise<any[]> {
  return await page.evaluate((xpathSelector) => {
    // XPathResult.ORDERED_NODE_SNAPSHOT_TYPE = 7
    const result = document.evaluate(
      xpathSelector,
      document,
      null,
      7,
      null
    );
    
    const results: string[] = [];
    
    for (let i = 0; i < result.snapshotLength; i++) {
      const node = result.snapshotItem(i);
      if (!node) continue;
      
      let val: string | null = null;
      if (node.nodeType === 1) val = (node as Element).outerHTML;
      else if (node.nodeType === 2 || node.nodeType === 3) val = node.nodeValue;

      if (val) results.push(val);
    }
    return results;
  }, xpath);
}
```

### Launch Arguments

Complete launch configuration:

```typescript
const launchArgs = [
  // Security/sandbox
  '--no-sandbox',
  '--disable-setuid-sandbox',
  
  // Performance
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--disable-gpu',
  '--use-gl=swiftshader',
  
  // Display
  '--window-size=1280,720',
  '--font-render-hinting=none',
  
  // Proxy (if configured)
  ...(process.env.PROXY_SERVER ? [`--proxy-server=${process.env.PROXY_SERVER}`] : []),
];

const browser = await puppeteer.launch({
  executablePath: process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium',
  headless: true, 
  pipe: true,
  userDataDir,
  args: launchArgs,
  timeout: 60000,
  ...(hasExtensions && { enableExtensions: extensionPaths })
});
```

### Navigation Strategy

```typescript
// Pre-navigation delay for extensions (if loaded)
if (hasExtensions) {
  await new Promise(resolve => setTimeout(resolve, 2000));
}

// Navigate with networkidle2
await page.goto(url, {
  waitUntil: 'networkidle2',
  timeout: 45000
});

// Simulate user interaction (helps bypass bot detection)
await page.mouse.move(100, 100);
await page.evaluate(() => window.scrollBy(0, 200));

// Post-navigation delay (allow dynamic content to load)
const postNavDelay = method === 'xpath' ? 5000 : 2000;
await new Promise(resolve => setTimeout(resolve, postNavDelay));
```

### Site-Specific Handlers

Some sites require special handling. Example for WSJ.com tab duplication:

```typescript
if (url.includes('wsj.com/')) {
  try {
    const tabDuplicator = await findExtensionByIdentity(browser, 'tab-duplicator');
    if (tabDuplicator) {
      const workerContext = await tabDuplicator.worker();
      await workerContext.evaluate(() => {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ action: 'duplicateTab' }, response => {
            if (response?.success) resolve(response);
            else reject(new Error(response?.error || 'Failed'));
          });
        });
      });
    }
  } catch (e) {
    // Non-fatal, continue scraping
  }
}
```

### Error Handling and Status Codes

Map errors to appropriate HTTP status codes:

| Error Type | Status Code |
|------------|-------------|
| Timeout | 504 Gateway Timeout |
| Selector not found | 404 Not Found |
| Navigation failed (`net::ERR_*`) | 502 Bad Gateway |
| XPath evaluation failed | 400 Bad Request |
| Other | 500 Internal Server Error |

```typescript
let statusCode = 500;

if (error.name === 'TimeoutError' || 
    error.message.includes('timeout') || 
    error.message.includes('exceeded')) {
  statusCode = 504;
} else if (error.message.includes('selector') && 
           (error.message.includes('not found') || 
            error.message.includes('failed to find'))) {
  statusCode = 404;
} else if (error.message.includes('Navigation failed') || 
           error.message.includes('net::ERR_')) {
  statusCode = 502;
} else if (error.message.includes('XPath evaluation failed')) {
  statusCode = 400;
}
```

## Consequences

### Benefits

- **Complete isolation**: Fresh browser instance per scrape prevents any state leakage
- **Configurable concurrency**: Adjust throughput via `CONCURRENCY` env var
- **Real Chrome extensions**: Use battle-tested extensions like uBlock Origin instead of maintaining custom plugins
- **Realistic fingerprint**: Windows UA + viewport + mouse movement avoids headless detection
- **Flexible extraction**: XPath with full result type support
- **Site-specific handlers**: Extension communication enables workarounds for difficult sites

### Trade-offs

- **Memory usage**: Each browser uses ~200-400MB; plan for N×400MB at concurrency N
- **Browser startup overhead**: ~15-20 seconds per scrape with extensions (acceptable for quality over speed)
- **Extension support**: Uses Puppeteer's `enableExtensions` option with `headless: true`
- **Profile cleanup overhead**: Directory deletion adds ~50-100ms per session
- **Extension maintenance**: Extensions may need updates for browser compatibility

### Implementation Requirements

- Profile cleanup must be in a `finally` block to handle errors
- Extensions must be unpacked (not CRX files)
- Use `puppeteer-core` with system Chromium for extension support
- Run with Xvfb on headless servers (`xvfb-run` or `DISPLAY=:99`)
- Validate `EXECUTABLE_PATH` exists on startup
