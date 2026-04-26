# ADR-007: Network and Proxy Configuration

- Status: Accepted
- Date: 2025-12-05

## Context

SmartScraper must support HTTP proxies for bypassing restrictions and improving success rates. Proxy configuration must work consistently across HTTP fetches and browser-based scraping.

## Decision

### Environment Variables

```dotenv
PROXY_SERVER=http://username:password@hostname:port
# Default normal-scrape SOCKS5 proxy:
DEFAULT_SOCKS5_PROXY=socks5://username:password@hostname:port
# Fallback (also supported):
HTTP_PROXY=http://username:password@hostname:port
```

`default_socks5_proxy` may also be loaded from `secrets.yaml`, either as a
flat key or as `api_keys.default_socks5_proxy`.

Precedence for the default scrape proxy is:
`PROXY_SERVER` → `DEFAULT_SOCKS5_PROXY` / `default_socks5_proxy` →
`HTTP_PROXY`.

### Proxy URL Format

```
http://username:password@hostname:port
```

Components:
- `username`: Proxy authentication username
- `password`: Proxy authentication password
- `hostname`: Proxy server hostname
- `port`: Proxy server port (default: 80 HTTP, 443 HTTPS)

### Puppeteer Proxy Configuration

```typescript
const parsedUrl = new URL(proxyDetails.server);
const proxyHostPort = `${parsedUrl.hostname}:${parsedUrl.port || '80'}`;

const browser = await puppeteer.launch({
  args: [`--proxy-server=${proxyHostPort}`]
});

// Authentication
if (parsedUrl.username || parsedUrl.password) {
  await page.authenticate({
    username: decodeURIComponent(parsedUrl.username),
    password: decodeURIComponent(parsedUrl.password)
  });
}
```

### HTTP (Axios) Proxy Configuration

Proxy configured in axios request options with parsed credentials.

### Proxy Usage Scope

Proxies apply to:
- Target site HTTP requests
- Puppeteer browser connections
- 2Captcha DataDome tasks when DataDome-specific proxy credentials are present

Per-request proxy details override the default scrape proxy. Sites configured
with `needsProxy: "datadome"` use generated DataDome proxy sessions for browser
page loads and 2Captcha DataDome tasks.

Runtime DataDome CAPTCHA detection on a normal site uses DataDome proxy
credentials for the 2Captcha task. It does not send the default SOCKS5 proxy to
the DataDome solver path.

2Captcha proxy failures such as `ERROR_BAD_PROXY` are reported as DataDome
solver proxy configuration errors so the runtime failure is visible in scrape
results and logs.

### User-Agent Handling

- Default UA is set in code (Windows Chrome fingerprint)
- Can be overridden per-request via `userAgentString` option
- Same UA forwarded to CAPTCHA solving services
- Per-site overrides can be stored in `SiteConfig.userAgent`

## Consequences

- Consistent proxy behavior across fetch methods
- URL-encoded credentials properly decoded
- Proxy rotation for banned IPs requires external implementation
