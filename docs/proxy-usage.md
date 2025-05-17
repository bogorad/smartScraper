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

1. **Parsing the Proxy URL**: The proxy URL is parsed to extract the hostname, port, username, and password.

2. **Puppeteer Configuration**: The proxy server is added to Puppeteer's launch arguments:

```javascript
const parsedProxyUrl = new URL(proxyUrl);
const proxyHostPort = `${parsedProxyUrl.hostname}:${parsedProxyUrl.port || 80}`;

const browser = await puppeteer.launch({
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    `--proxy-server=${proxyHostPort}`
  ]
});
```

3. **Authentication**: Proxy authentication is handled using the `page.authenticate()` method:

```javascript
const page = await browser.newPage();

// Set proxy authentication
await page.authenticate({
  username: parsedProxyUrl.username,
  password: parsedProxyUrl.password
});
```

## Recommended Proxy Providers

SmartScraper has been tested with the following proxy providers:

- [WebShare](https://www.webshare.io/) - Rotating proxies with good success rates
- [BrightData](https://brightdata.com/) - Enterprise-grade proxies with advanced features
- [Oxylabs](https://oxylabs.io/) - High-quality proxies with good documentation

## Handling CAPTCHA Challenges

Many websites use anti-bot protection services like DataDome, which present CAPTCHA challenges to suspected bots. SmartScraper includes functionality to detect and handle these challenges.

### Detecting DataDome CAPTCHA

DataDome CAPTCHA challenges can be identified by the presence of specific elements in the HTML:

```html
<iframe src="https://geo.captcha-delivery.com/captcha/..." title="DataDome CAPTCHA"></iframe>
```

Or by looking for references to "captcha-delivery.com" in the HTML:

```html
<script data-cfasync="false">var dd={'rt':'c','cid':'AHrlqAAAAAMAI6TA5niVCvQAkBjBlA==','hsh':'499AE34129FA4E4FABC31582C3075D','t':'fe','qp':'','s':17439,'e':'0dd474425aa3d11ab2f94080c8cbf62eefe9a186f1a3b31c3c3f350def1f823b','host':'geo.captcha-delivery.com','cookie':'waY4hEkC8j0U3tA~UcdILH3FgO3pXin9PjEJ1j7PLjwSf~xiNlG0b5jFha92WAjn9Q30uWB4h78qnSIhzJN1fqgwM2ZCcrLILwP7WK8T8Gyn~mW9Yz30Id4N8oqwm~Vw'}</script>
```

### Detecting Banned IPs

When using DataDome CAPTCHA, it's important to check if your IP is banned. DataDome uses the `t` parameter in the CAPTCHA URL to indicate the status:

- `t=fe`: This is the normal CAPTCHA challenge that can be solved.
- `t=bv`: This means your IP is banned by DataDome and you need to use a different proxy.

Example of a CAPTCHA URL with a banned IP:

```
https://geo.captcha-delivery.com/captcha/?initialCid=AHrlqAAAAAMAdBO7Eje0FJUAaOkPLw%3D%3D&hash=499AE34129FA4E4FABC31582C3075D&cid=UEOZf0pKjT64auxcVs1mtdoGpKspejH7sDQBcx6~GRpi9qRTkHl39eJQJgAx4HnUecy8Oev86KuRYhc3qwHI7KX6dMLNluBygjfOTdzgVS_BJmpaddDpZKZf5iZGS_ra&t=bv&referer=https%3A%2F%2Fwww.nytimes.com%2F2025%2F05%2F15%2Fhealth%2Fgene-editing-personalized-rare-disorders.html&s=17439&e=0810af974b49596e8b14b381c7b816cfef85aac994d0fff923eb95f30fc7cb30&dm=cd
```

If you encounter a `t=bv` parameter, you should:

1. Rotate to a different proxy
2. Use a residential proxy instead of a datacenter proxy
3. Consider using a proxy from a different provider

### Solving CAPTCHA Challenges

SmartScraper supports integration with CAPTCHA solving services like 2Captcha. To use this feature:

1. Set up a 2Captcha account and get an API key.
2. Add your API key to the `.env` file:

```dotenv
TWOCAPTCHA_API_KEY=your_2captcha_api_key_here
```

3. Configure the domains that require CAPTCHA solving:

```javascript
const DADADOME_DOMAINS = ["nytimes.com", "wsj.com"];
```

4. The system will automatically detect and solve DataDome CAPTCHA challenges for these domains.

#### DataDome CAPTCHA Detection

DataDome CAPTCHA challenges are detected by:

1. Looking for an iframe with a source containing "captcha-delivery.com":
   ```javascript
   const iframeSelector = 'iframe[src*="captcha-delivery.com"], iframe[src*="geo.captcha-delivery.com"]';
   ```

2. Checking for blocked indicators in the page title and body text:
   ```javascript
   const blockedIndicators = ["blocked", "enable javascript", "checking browser", "access denied", "verify human"];
   ```

#### CAPTCHA Solving Process

1. When a DataDome CAPTCHA is detected, the system creates a task with the 2Captcha API:
   ```javascript
   const taskPayload = {
     type: "DataDomeSliderTask",
     websiteURL,
     captchaUrl,
     userAgent,
     proxyType: PROXY_INFO_FOR_2CAPTCHA.type,
     proxyAddress: PROXY_INFO_FOR_2CAPTCHA.address,
     proxyPort: PROXY_INFO_FOR_2CAPTCHA.port,
     proxyLogin: PROXY_INFO_FOR_2CAPTCHA.login,
     proxyPassword: PROXY_INFO_FOR_2CAPTCHA.password
   };
   ```

2. The system polls the 2Captcha API for the result at regular intervals.

3. When the CAPTCHA is solved, the system gets a cookie from the 2Captcha API.

4. The cookie is properly formatted for Puppeteer:
   ```javascript
   function formatDataDomeCookie(cookieString, targetUrl) {
     // Parse the cookie string
     const parts = cookieString.split(";").map(p => p.trim());
     const [name, ...valueParts] = parts[0].split("=");
     const value = valueParts.join("=");

     // Create a simple cookie object with just the name and value
     const cookie = {
       name: name.trim(),
       value: value.trim(),
       url: targetUrl
     };

     // Parse cookie attributes (domain, path, etc.)
     for (let i = 1; i < parts.length; i++) {
       const part = parts[i].trim();

       if (part.toLowerCase() === 'secure') {
         cookie.secure = true;
         continue;
       }

       if (part.toLowerCase() === 'httponly') {
         cookie.httpOnly = true;
         continue;
       }

       const [attrName, ...attrValueParts] = part.split("=");
       if (!attrName) continue;

       const attrNameLower = attrName.trim().toLowerCase();
       const attrValue = attrValueParts.join("=").trim();

       switch (attrNameLower) {
         case "domain":
           cookie.domain = attrValue;
           break;
         case "path":
           cookie.path = attrValue || "/";
           break;
         // Handle other attributes...
       }
     }

     return cookie;
   }
   ```

5. The cookie is set in the browser and the page is reloaded:
   ```javascript
   // Set the cookie
   await page.setCookie(formattedCookie);

   // Reload the page
   await page.goto(url, {
     waitUntil: 'networkidle2',
     timeout: 60000
   });
   ```

6. The system verifies that the CAPTCHA is no longer present and proceeds with scraping the content:
   ```javascript
   // Check if CAPTCHA is still present or if we have article content
   const contentCheck = await page.evaluate(() => {
     // Check for CAPTCHA iframe
     const iframe = document.querySelector('iframe[src*="captcha-delivery.com"]');

     // Check for article content indicators
     const mainContent = document.querySelector('main#site-content');
     const title = document.title;
     const h1 = document.querySelector('h1')?.textContent;

     return {
       captchaIframe: iframe ? true : false,
       hasMainContent: !!mainContent,
       title: title || '',
       h1: h1 || ''
     };
   });

   // Even if the CAPTCHA iframe is still present, check if we have article content
   if (contentCheck.hasMainContent || contentCheck.title.includes('New York Times')) {
     console.log('CAPTCHA bypass successful! Article content found.');
   }
   ```

#### Optimal Flow for CAPTCHA Handling

SmartScraper uses an efficient approach to handle CAPTCHA challenges:

1. **Try curl first** (faster, less resource-intensive)
   ```javascript
   // Attempt to fetch the page with curl
   const curlResponse = await fetchWithCurl(url);
   ```

2. **Check for CAPTCHA indicators** in the curl response
   ```javascript
   // Check if the response contains CAPTCHA indicators
   const hasCaptcha = curlResponse.includes('captcha-delivery.com');
   ```

3. **If CAPTCHA is detected in curl response:**
   - Skip the puppeteer-stealth attempt (which would also hit the CAPTCHA)
   - Go directly to puppeteer-captcha with 2Captcha integration
   ```javascript
   if (hasCaptcha) {
     // Skip puppeteer-stealth and go directly to puppeteer-captcha
     return await fetchWithPuppeteerCaptcha(url);
   }
   ```

4. **If no CAPTCHA in curl response:**
   - Proceed with normal flow (curl or puppeteer-stealth depending on content needs)
   ```javascript
   if (curlResponse.includes('<article')) {
     // If curl response contains what we need, use it
     return extractContentFromCurl(curlResponse);
   } else {
     // Otherwise, try puppeteer-stealth
     return await fetchWithPuppeteerStealth(url);
   }
   ```

This approach is more efficient because:
- It avoids wasting resources on intermediate steps that would fail
- It reduces the time needed to successfully scrape the content
- It minimizes the number of requests to the target site
- It potentially reduces costs by only using 2Captcha when absolutely necessary

#### Integration with Navigation

The CAPTCHA handling is integrated with the navigation process:

```javascript
// Navigate to a URL with DataDome CAPTCHA handling
const navigationSuccessful = await navigateAndPreparePage(page, url, debug, true);
if (!navigationSuccessful) {
  console.error("Navigation failed");
  return null;
}
```

The `navigateAndPreparePage` function handles navigation, proxy authentication, and DataDome CAPTCHA detection and solving.

## Troubleshooting

If you encounter issues with proxies or CAPTCHA solving, try the following:

1. **Verify Proxy Credentials**: Make sure your proxy username and password are correct.

2. **Check Proxy Format**: Ensure the proxy URL is in the correct format.

3. **Test Proxy Connection**: Use a tool like `curl` to test the proxy connection:

```bash
curl -x http://username:password@hostname:port https://httpbin.org/ip
```

4. **Enable Debug Logging**: Set `LOG_LEVEL=DEBUG` in your `.env` file to see detailed logs.

5. **Try Different Proxy**: If one proxy doesn't work, try another one.

6. **Check CAPTCHA Service**: Verify that your CAPTCHA solving service is working correctly.

7. **Inspect HTML Content**: Save and inspect the HTML content to check for CAPTCHA challenges or other blocking mechanisms.

## Example Code

Here's a complete example of using a proxy with Puppeteer:

```javascript
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

puppeteer.use(StealthPlugin());

async function scrapeWithProxy(url) {
  // Proxy configuration
  const proxyUrl = process.env.HTTP_PROXY;
  if (!proxyUrl) {
    console.error('HTTP_PROXY environment variable not set');
    return null;
  }

  // Parse the proxy URL
  const parsedProxyUrl = new URL(proxyUrl);
  const proxyHostPort = `${parsedProxyUrl.hostname}:${parsedProxyUrl.port || 80}`;

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--proxy-server=${proxyHostPort}`
    ]
  });

  try {
    const page = await browser.newPage();

    // Set proxy authentication
    await page.authenticate({
      username: parsedProxyUrl.username,
      password: parsedProxyUrl.password
    });

    // Navigate to the URL
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Get the HTML content
    const content = await page.content();
    return content;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return null;
  } finally {
    await browser.close();
  }
}
```
