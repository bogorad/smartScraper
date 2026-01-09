# ADR-011: Backend Architecture (Hono + HTMX)

- Status: Accepted
- Date: 2025-12-05

## Context

SmartScraper needs a web backend for:
- API endpoint for external scraping requests (Node-RED orchestration)
- Dashboard for managing known sites, viewing stats, testing configurations
- Persistent storage for configs, logs, and statistics

## Decision

### Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 24 |
| Framework | Hono |
| Templating | JSX (server-rendered) |
| Interactivity | HTMX (no client framework) |
| Client JS | **Zero** (completely removed in favor of HTMX + SSE) |

### Directory Structure

```
src/
  index.ts                    # Hono app entry point
  routes/
    api/
      scrape/
        index.ts              # POST /api/scrape
    dashboard/
      index.tsx               # GET / (redirect or overview)
      sites/
        index.tsx             # GET /dashboard/sites
        [domain]/
          index.tsx           # GET/POST/DELETE /dashboard/sites/:domain
          test.tsx            # POST /dashboard/sites/:domain/test
      stats/
        index.tsx             # GET /dashboard/stats
  middleware/
    auth.ts                   # UUID7 bearer token validation
  components/
    layout.tsx                # Base HTML layout with HTMX
    site-row.tsx              # Table row for site list
    site-form.tsx             # Edit form for SiteConfig
    stats-card.tsx            # Stat display card
    confirm-dialog.tsx        # Delete confirmation
  services/
    log-storage.ts            # JSON Lines logging
    stats-storage.ts          # Stats persistence
  adapters/
    fs-known-sites.ts         # JSONC read/write with comment preservation
  utils/
    jsonc.ts                  # JSONC parser/serializer
    date.ts                   # UTC date helpers
```

### Data Directory

```
data/
  sites.jsonc                 # SiteConfig[] with comments preserved
  stats.json                  # Persistent totals
  logs/
    2025-12-05.jsonl          # Daily log (JSON Lines)
    2025-12-04.jsonl
    ...                       # Auto-cleanup after 7 days
```

---

## API Endpoints

### GET /health

Health check endpoint for monitoring and load balancers:

```typescript
app.get('/health', (c) => {
  return c.json({ 
    status: 'alive', 
    timestamp: Date.now() 
  });
});
```

**Response:**
```json
{
  "status": "alive",
  "timestamp": 1733400000000
}
```

### POST /api/scrape

**Request:**
```http
POST /api/scrape
Authorization: Bearer <uuid7>
Content-Type: application/json

{
  "url": "https://nypost.com/2025/12/05/some-article/",
  "outputType": "content_only"
}
```

**Response (success):**
```json
{
  "success": true,
  "method": "puppeteer_stealth",
  "xpath": "//article[@class='post-content']",
  "data": "Article content text..."
}
```

**Response (failure):**
```json
{
  "success": false,
  "errorType": "CAPTCHA",
  "error": "DataDome challenge detected, solving failed"
}
```

---

## Authentication

### Mechanism
- Single shared token stored in `API_TOKEN` environment variable
- Token format: UUID7 (time-sortable, unique)
- Header: `Authorization: Bearer <token>`

### API Requests
```typescript
// middleware/auth.ts
export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  
  if (token !== process.env.API_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  await next();
});
```

### Dashboard Sessions
- First authenticated request sets httpOnly cookie
- Cookie contains signed token hash
- Subsequent dashboard requests validate cookie
- Cookie expires after 24 hours

```typescript
// POST /dashboard/login
if (formToken === process.env.API_TOKEN) {
  setCookie(c, 'session', signedHash, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 86400
  });
}
```

---

## Dashboard Routes

### Sites List: GET /dashboard/sites

**Features:**
- Table with columns: Domain, XPath (truncated), Last Success, Failures, Actions
- Server-side filtering by domain search
- Server-side sorting by any column
- HTMX-powered without page reload

**HTMX Pattern:**
```html
<input 
  type="search" 
  name="q" 
  hx-get="/dashboard/sites" 
  hx-trigger="keyup changed delay:300ms"
  hx-target="#sites-table"
  hx-swap="innerHTML"
/>

<table id="sites-table">
  <thead>
    <tr>
      <th hx-get="/dashboard/sites?sort=domain" hx-target="#sites-table">Domain</th>
      ...
    </tr>
  </thead>
  <tbody>
    {sites.map(site => <SiteRow site={site} />)}
  </tbody>
</table>
```

### Site Detail: GET /dashboard/sites/:domain

**Editable Fields:**
- `xpathMainContent` (textarea)
- `siteCleanupClasses` (tag input or textarea, one per line)
- `siteSpecificHeaders` (key-value pairs)
- `userAgent` (text input, optional override)

**Form:**
```html
<form hx-post="/dashboard/sites/{domain}" hx-swap="outerHTML">
  <label>XPath Main Content</label>
  <textarea name="xpathMainContent">{site.xpathMainContent}</textarea>
  
  <label>Cleanup Classes (one per line)</label>
  <textarea name="siteCleanupClasses">{site.siteCleanupClasses?.join('\n')}</textarea>
  
  <label>Custom Headers</label>
  <div id="headers">
    {Object.entries(site.siteSpecificHeaders || {}).map(([k, v]) => (
      <div>
        <input name="headerKey[]" value={k} />
        <input name="headerValue[]" value={v} />
      </div>
    ))}
  </div>
  
  <label>User-Agent (leave empty for default)</label>
  <input type="text" name="userAgent" value={site.userAgent || ''} 
         placeholder="Mozilla/5.0 (Windows NT 10.0; Win64; x64)..." />
  
  <button type="submit">Save</button>
</form>
```

### Test Scrape: POST /dashboard/sites/:domain/test

**Request:**
```html
<form hx-post="/dashboard/sites/{domain}/test" hx-target="#test-result">
  <input type="url" name="testUrl" placeholder="https://..." required />
  <button type="submit">Test Scrape</button>
</form>

<div id="test-result"></div>
```

**Response (HTMX partial):**
```html
<!-- Success -->
<div class="alert success">
  Success - extracted 4,250 characters in 1.2s
</div>

<!-- Failure -->
<div class="alert error">
  Failed: CAPTCHA - DataDome challenge detected
</div>
```

### Delete Site: DELETE /dashboard/sites/:domain

**Confirmation (minimal JS):**
```html
<button 
  hx-delete="/dashboard/sites/{domain}" 
  hx-confirm="Delete configuration for {domain}? This cannot be undone."
  hx-target="closest tr"
  hx-swap="outerHTML swap:1s"
>
  Delete
</button>
```

### Stats: GET /dashboard/stats

**Display:**
```html
<div class="stats-grid">
  <StatsCard title="Scraped Total" value={stats.scrapeTotal} />
  <StatsCard title="Scraped Today" value={stats.scrapeToday} />
  <StatsCard title="Failed Total" value={stats.failTotal} />
  <StatsCard title="Failed Today" value={stats.failToday} />
</div>

<h3>Top 5 Domains</h3>
<ol>
  {stats.topDomains.slice(0, 5).map(d => (
    <li>{d.domain}: {d.count} scrapes</li>
  ))}
</ol>
```

---

## Storage

### sites.jsonc

JSONC format with comment preservation:

```jsonc
[
  // News sites
  {
    "domainPattern": "nypost.com",
    "xpathMainContent": "//article[@class='post-content']",
    "lastSuccessfulScrapeTimestamp": "2025-12-05T10:30:00Z",
    "failureCountSinceLastSuccess": 0,
    "siteCleanupClasses": ["ad-wrapper", "social-share"],
    "siteSpecificHeaders": {}
  },
  // Tech blogs
  {
    "domainPattern": "techcrunch.com",
    // TODO: xpath needs testing after site redesign
    "xpathMainContent": "//div[@class='article-content']",
    "failureCountSinceLastSuccess": 2
  }
]
```

**Comment Preservation:**
```typescript
// src/adapters/fs-known-sites.ts
import { parse, stringify } from 'comment-json';

export class FsKnownSitesAdapter implements KnownSitesPort {
  private async load(): Promise<SiteConfig[]> {
    await this.ensureFile();
    const content = await fs.readFile(SITES_FILE, 'utf-8');
    this.cache = parse(content) as unknown as SiteConfig[];
    return this.cache;
  }

  private async save(configs: SiteConfig[]): Promise<void> {
    await this.ensureFile();
    const content = stringify(configs, null, 2);
    await fs.writeFile(SITES_FILE, content);
    this.cache = configs;
  }
}
```

### stats.json

```json
{
  "scrapeTotal": 15420,
  "failTotal": 342,
  "todayDate": "2025-12-05",
  "scrapeToday": 87,
  "failToday": 3,
  "domainCounts": {
    "nypost.com": 2341,
    "cnn.com": 1892,
    "techcrunch.com": 1456,
    "bbc.com": 1203,
    "reuters.com": 998
  }
}
```

**UTC Midnight Reset:**
```typescript
// services/stats-storage.ts
export function recordScrape(domain: string, success: boolean): void {
  const stats = loadStats();
  const today = new Date().toISOString().slice(0, 10); // UTC date
  
  // Reset daily counters if new day
  if (stats.todayDate !== today) {
    stats.todayDate = today;
    stats.scrapeToday = 0;
    stats.failToday = 0;
  }
  
  stats.scrapeTotal++;
  stats.scrapeToday++;
  stats.domainCounts[domain] = (stats.domainCounts[domain] || 0) + 1;
  
  if (!success) {
    stats.failTotal++;
    stats.failToday++;
  }
  
  saveStats(stats);
}
```

### logs/*.jsonl

**Format (JSON Lines):**
```
{"ts":"2025-12-05T10:30:00.123Z","domain":"nypost.com","url":"https://nypost.com/...","success":true,"method":"puppeteer_stealth","xpath":"//article","ms":1250}
{"ts":"2025-12-05T10:31:15.456Z","domain":"cnn.com","url":"https://cnn.com/...","success":false,"errorType":"CAPTCHA","error":"DataDome detected","ms":5400}
```

**Writing:**
```typescript
// services/log-storage.ts
export async function logScrape(entry: LogEntry): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const logFile = `./data/logs/${today}.jsonl`;
  
  const line = JSON.stringify(entry) + '\n';
  await fs.appendFile(logFile, line);
}
```

**Cleanup (>7 days):**
```typescript
export async function cleanupOldLogs(): Promise<void> {
  const files = await fs.readdir('./data/logs');
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  
  for (const file of files) {
    const date = file.replace('.jsonl', '');
    if (date < cutoffStr) {
      await fs.unlink(`./data/logs/${file}`);
    }
  }
}
```

Run cleanup on server startup and daily via `setInterval`.

---

## Process Error Handling

Global handlers for uncaught exceptions and unhandled rejections:

```typescript
// index.ts
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'Reason:', reason);
  process.exit(1);
});
```

These ensure the process fails fast on unexpected errors rather than continuing in a broken state.

---

## Server Startup

```typescript
const PORT = process.env.PORT || 5555;

// Ensure data directories exist
await fs.mkdir('./data/logs', { recursive: true });

// Validate Chromium executable exists
const execPath = process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium';
if (!fs.existsSync(execPath)) {
  console.warn(`[WARNING] Chromium executable not found at: ${execPath}`);
}

// Log extension configuration
if (process.env.EXTENSION_PATHS) {
  console.log(`[CHROMIUM] Loading extensions from: ${process.env.EXTENSION_PATHS}`);
}

// Run initial log cleanup
await cleanupOldLogs();

// Schedule daily cleanup
setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log(`[SERVER] Running on port ${PORT}`);
});
```

---

## Consequences

### Benefits
- Server-rendered, minimal client complexity
- HTMX provides SPA-like UX without framework overhead
- **Real-time updates via SSE** for highly dynamic views (e.g., workers status)
- JSONC allows annotating configs with comments
- JSON Lines logs are append-safe and easy to process
- Clear separation: routes/, services/, components/

### Trade-offs
- JSONC library adds dependency for comment preservation
- File-based storage limits concurrent write throughput
- SSE requires persistent connections (resource overhead on server)

### Implementation Requirements
- Use `comment-json` package for JSONC handling
- Ensure `data/` and `data/logs/` directories exist on startup
- Run log cleanup on startup and schedule daily
- All timestamps in UTC
