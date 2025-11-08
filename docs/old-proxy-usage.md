# Using HTTP Proxies with SmartScraper

SmartScraper supports using HTTP proxies to bypass website restrictions and improve scraping success rates. This document explains how to configure and use proxies with SmartScraper.

## Configuration

### Environment Variables

Set the `HTTP_PROXY` environment variable in your `.env` file:

```dotenv
# HTTP proxy for web scraping (format: http://username:password@hostname:port)
HTTP_PROXY=http://username:password@hostname:port
```

For example:

```dotenv
HTTP_PROXY=http://......
```

### Proxy Format

The proxy URL should be in the following format:

```
http://username:password@hostname:port
```

- `username`: Your proxy username
- `password`: Your proxy password
- `hostname`: The proxy server hostname
- `port`: The proxy server port (default: 80 for HTTP, 443 for HTTPS)

## Implementation Details

SmartScraper uses the following approach to handle HTTP proxies:

1. **Parsing the Proxy URL**: The proxy URL is parsed to extract the hostname, port, username, and password. This happens in `curl-handler.ts` for cURL-like requests (using `axios` proxy config) and in `puppeteer-controller.ts` for Puppeteer.


2. **Puppeteer Configuration**: The proxy server is added to Puppeteer's launch arguments:

```typescript
// In puppeteer-controller.ts (simplified)
const parsedProxyUrl = new URL(proxyDetails.server); // Assuming proxyDetails.server is the full proxy URL
const proxyHostPort = `${parsedProxyUrl.hostname}:${parsedProxyUrl.port || (parsedProxyUrl.protocol === 'https:' ? '443' : '80')}`;

const browser = await puppeteer.launch({
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    `--proxy-server=${proxyHostPort}`
  ]
});
```

3. **Authentication (Puppeteer)**: Proxy authentication is handled using the `page.authenticate()` method:

```typescript
// In puppeteer-controller.ts (simplified)
const page = await browser.newPage();
if (parsedProxyUrl.username || parsedProxyUrl.password) {
    await page.authenticate({
      username: decodeURIComponent(parsedProxyUrl.username),
      password: decodeURIComponent(parsedProxyUrl.password)
    });
}
```

4. **Axios (cURL-like) Configuration**: For `curl-handler.ts` (which uses `axios`), the proxy is configured in the `axios.get` request options.


## Recommended Proxy Providers

SmartScraper can work with various proxy providers. Some popular ones include:

- [WebShare](https://www.webshare.io/)
- [BrightData](https://brightdata.com/)
- [Oxylabs](https://oxylabs.io/)

## Handling CAPTCHA Challenges

Many websites use anti-bot protection services like DataDome, which present CAPTCHA challenges. SmartScraper includes functionality to detect and handle these challenges, primarily via the `CaptchaSolver` and `DataDomeSolver` services.

### Detecting DataDome CAPTCHA

DataDome CAPTCHA challenges can be identified by specific elements or scripts in the HTML (e.g., iframes sourcing from `captcha-delivery.com` or `geo.captcha-delivery.com`). `HtmlAnalyserFixed.detectCaptchaMarkers` helps with this.


### Detecting Banned IPs (DataDome)

When using DataDome CAPTCHA, it's important to check if your IP is banned. DataDome uses the `t` parameter in the CAPTCHA URL:
- `t=fe`: Normal CAPTCHA challenge.
- `t=bv`: Indicates the IP is likely banned by DataDome.

The `DataDomeSolver` (or the logic within `CaptchaSolver` that handles DataDome) should check for `t=bv` in the CAPTCHA URL. If found, it's advisable to rotate to a different proxy.

### Solving CAPTCHA Challenges

SmartScraper supports integration with CAPTCHA solving services like 2Captcha.

1.  Set up a 2Captcha account and get an API key.
2.  Add your API key to the `.env` file using `TWOCAPTCHA_API_KEY`:

```dotenv
TWOCAPTCHA_API_KEY=your_2captcha_api_key_here
```

3.  Ensure `CAPTCHA_SERVICE_NAME` is set (defaults to `2captcha` if not specified).

The system, particularly `DataDomeSolver` and `CaptchaSolver`, will use this key to interact with the 2Captcha API for solving detected CAPTCHAs.

#### DataDome CAPTCHA Solving Process (Conceptual)

1.  When a DataDome CAPTCHA is detected (e.g., by `HtmlAnalyserFixed` or directly by `DataDomeSolver`).
2.  The `DataDomeSolver` (or `CaptchaSolver`) prepares a task for the 2Captcha API (e.g., `DataDomeSliderTask`). This includes the `websiteURL`, `captchaUrl` (from the iframe), `userAgent`, and `proxy` details.
3.  The system polls the 2Captcha API for the result.
4.  If successful, 2Captcha returns a solution, typically a cookie string.
5.  This cookie string is formatted (e.g., by a function like `_formatDataDomeCookie` in `DataDomeSolver`) into a Puppeteer-compatible cookie object.
6.  The cookie is set in the browser using `page.setCookie(formattedCookie)`.
7.  The page is reloaded to apply the cookie and bypass the CAPTCHA.
8.  The system verifies that the CAPTCHA is no longer present.


#### Optimal Flow for CAPTCHA Handling

SmartScraper's `CoreScraperEngine` aims for an efficient flow:

1.  **Try cURL first.**
2.  **Check cURL response for CAPTCHA indicators.**
3.  **If CAPTCHA detected in cURL response (especially DataDome):**
    *   Skip `puppeteer-stealth` attempt.
    *   Go directly to `puppeteer-captcha` (Puppeteer with CAPTCHA solving via `CaptchaSolver`/`DataDomeSolver`).
4.  **If no CAPTCHA in cURL response:**
    *   Proceed with normal flow (use cURL if content is sufficient, otherwise try `puppeteer-stealth`).

This approach minimizes resource usage and time by only invoking full browser and CAPTCHA solving when necessary.

## Troubleshooting

If you encounter issues with proxies or CAPTCHA solving:

1.  **Verify Proxy Credentials and Format**: Ensure `HTTP_PROXY` in your `.env` is correct.
2.  **Test Proxy Connection**: Use `curl -x YOUR_PROXY_URL https://httpbin.org/ip` to test.
3.  **Enable Debug Logging**: Set `LOG_LEVEL=DEBUG` in your `.env` file.
4.  **Enable HTML Dumps**: Set `DEBUG=true` in your `.env` to save HTML content of pages, which can help diagnose issues. If `SAVE_HTML_ON_SUCCESS_NAV=true` is also set, successful pages will be saved too.
5.  **Check CAPTCHA Service Account**: Ensure your 2Captcha account has funds and your API key (`TWOCAPTCHA_API_KEY`) is correct.
6.  **Inspect HTML Content**: Review saved HTML dumps for CAPTCHA elements or blocking messages.
