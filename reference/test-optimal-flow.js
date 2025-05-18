// reference/test-optimal-flow.js
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import axios from 'axios';
import { execSync } from 'child_process';
import { URL } from 'url';

// Load environment variables
dotenv.config();

// Add stealth plugin
puppeteer.use(StealthPlugin());

// Constants
const CAPTCHA_INDICATORS = [
  'captcha-delivery.com',
  'geo.captcha-delivery.com',
  'Please enable JS and disable any ad blocker',
  'checking browser'
];

// 2Captcha Configuration
const CAPTCHA_API_KEY = process.env.CAPTCHA_API_KEY;
const CAPTCHA_SERVICE_NAME = process.env.CAPTCHA_SERVICE_NAME || '2captcha';
const CAPTCHA_POLL_INTERVAL = 5000; // 5 seconds
const CAPTCHA_SOLVE_TIMEOUT = 60000; // 1 minute

console.log(`Using ${CAPTCHA_SERVICE_NAME} with API key: ${CAPTCHA_API_KEY ? 'Provided' : 'Not provided'}`);

/**
 * Format a DataDome cookie for use with Puppeteer
 * @param {string} cookieString - The cookie string from 2Captcha
 * @param {string} targetUrl - The URL the cookie is for
 * @returns {Object|null} - The formatted cookie object or null if parsing fails
 */
function formatDataDomeCookie(cookieString, targetUrl) {
  console.log(`Formatting cookie: ${cookieString.substring(0, 50)}...`);

  if (!cookieString?.includes("=")) {
    console.error("Cookie string format error");
    return null;
  }

  try {
    // Parse the cookie string
    const parts = cookieString.split(";").map(p => p.trim());
    const [name, ...valueParts] = parts[0].split("=");
    const value = valueParts.join("=");

    if (!name || !value) {
      console.error("Bad name/value in cookie");
      return null;
    }

    // Create a simple cookie object with just the name and value
    const cookie = {
      name: name.trim(),
      value: value.trim(),
      url: targetUrl
    };

    // Parse cookie attributes
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
        case "max-age":
          try {
            const maxAgeSec = parseInt(attrValue, 10);
            if (!isNaN(maxAgeSec)) {
              cookie.expires = Math.floor(Date.now() / 1000) + maxAgeSec;
            }
          } catch (e) {
            console.warn(`Error parsing max-age: ${e.message}`);
          }
          break;
        case "samesite":
          if (attrValue.toLowerCase() === 'lax') {
            cookie.sameSite = 'Lax';
          } else if (attrValue.toLowerCase() === 'strict') {
            cookie.sameSite = 'Strict';
          } else if (attrValue.toLowerCase() === 'none') {
            cookie.sameSite = 'None';
            // SameSite=None requires Secure
            cookie.secure = true;
          }
          break;
      }
    }

    console.log(`Formatted cookie: ${JSON.stringify(cookie)}`);
    return cookie;
  } catch (error) {
    console.error(`Cookie parsing error: ${error.message}`);
    return null;
  }
}

/**
 * Solve a DataDome CAPTCHA using 2Captcha
 * @param {string} websiteURL - The URL of the website with the CAPTCHA
 * @param {string} captchaUrl - The URL of the CAPTCHA iframe
 * @param {string} userAgent - The user agent to use
 * @param {Object} proxyInfo - Proxy information for 2Captcha
 * @returns {Promise<{success: boolean, cookie?: string, reason?: string, details?: string}>}
 */
async function solveDataDomeWith2Captcha(websiteURL, captchaUrl, userAgent, proxyInfo) {
  if (!CAPTCHA_API_KEY) {
    console.error("Missing 2Captcha API key");
    return { success: false, reason: 'CONFIG_ERROR' };
  }

  if (!proxyInfo) {
    console.error("Missing proxy information");
    return { success: false, reason: 'CONFIG_ERROR' };
  }

  // Check if captchaUrl contains t=fe (required for DataDome)
  if (captchaUrl.includes('t=bv')) {
    console.error("CaptchaUrl contains t=bv parameter. This means your IP is banned by DataDome.");
    console.error("You need to use a different proxy. Current proxy might be in a blocklist.");
    return { success: false, reason: 'BANNED_IP' };
  }

  if (!captchaUrl.includes('t=fe')) {
    console.warn("CaptchaUrl does not contain t=fe parameter. This might cause issues with solving the CAPTCHA.");
    console.warn("Continuing anyway, but success is not guaranteed.");
  }

  console.log(`Solving CAPTCHA for ${websiteURL}`);

  // Create the task according to the documentation
  const taskPayload = {
    type: "DataDomeSliderTask",
    websiteURL,
    captchaUrl,
    userAgent,
    proxyType: proxyInfo.type,
    proxyAddress: proxyInfo.address,
    proxyPort: proxyInfo.port,
    ...(proxyInfo.login && { proxyLogin: proxyInfo.login }),
    ...(proxyInfo.password && { proxyPassword: proxyInfo.password })
  };

  const requestBody = {
    clientKey: CAPTCHA_API_KEY,
    task: taskPayload
  };

  console.log(`Sending task to 2Captcha API: ${JSON.stringify({
    ...requestBody,
    task: {
      ...requestBody.task,
      proxyPassword: requestBody.task.proxyPassword ? '***' : undefined
    }
  }, null, 2)}`);

  let taskId;
  try {
    // Create the task
    const createTaskResponse = await axios.post('https://api.2captcha.com/createTask', requestBody, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`2Captcha create task response: ${JSON.stringify(createTaskResponse.data)}`);

    if (createTaskResponse.data.errorId !== 0) {
      console.error(`2Captcha create task failed: ${createTaskResponse.data.errorCode} - ${createTaskResponse.data.errorDescription}`);
      return { success: false, reason: 'API_ERROR', details: createTaskResponse.data.errorCode };
    }

    taskId = createTaskResponse.data.taskId;
    console.log(`2Captcha task ID: ${taskId}`);
  } catch (error) {
    console.error(`2Captcha create task request error: ${error.message}`);
    return { success: false, reason: 'API_ERROR', details: error.message };
  }

  // Poll for the result
  const startTime = Date.now();
  while (Date.now() - startTime < CAPTCHA_SOLVE_TIMEOUT) {
    console.log(`Polling 2Captcha for task ID: ${taskId}...`);

    try {
      await new Promise(resolve => setTimeout(resolve, CAPTCHA_POLL_INTERVAL));

      // Get the task result
      const getResultResponse = await axios.post('https://api.2captcha.com/getTaskResult', {
        clientKey: CAPTCHA_API_KEY,
        taskId
      }, {
        timeout: 20000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log(`2Captcha get result response: ${JSON.stringify(getResultResponse.data)}`);

      if (getResultResponse.data.errorId !== 0) {
        const errorCode = getResultResponse.data.errorCode;
        console.error(`2Captcha get result failed: ${errorCode} - ${getResultResponse.data.errorDescription}`);

        if (errorCode === 'ERROR_CAPTCHA_UNSOLVABLE') {
          return { success: false, reason: 'UNSOLVABLE' };
        } else if (errorCode === 'ERR_PROXY_CONNECTION_FAILED') {
          return { success: false, reason: 'PROXY_ERROR' };
        } else {
          return { success: false, reason: 'API_ERROR', details: errorCode };
        }
      }

      const status = getResultResponse.data.status;

      if (status === "ready") {
        console.log(`2Captcha solved task ID: ${taskId}`);

        // Get the cookie from the solution
        const solutionCookie = getResultResponse.data.solution?.cookie;

        if (!solutionCookie) {
          console.error("2Captcha solution missing cookie");
          return { success: false, reason: 'API_ERROR', details: 'Missing cookie' };
        }

        console.log(`2Captcha cookie: ${solutionCookie.substring(0, 50)}...`);
        return { success: true, cookie: solutionCookie };
      } else if (status === "processing") {
        console.log("2Captcha still processing...");
      } else {
        console.warn(`2Captcha unknown status: ${status}`);
      }
    } catch (error) {
      console.error(`2Captcha poll error for task ID ${taskId}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, CAPTCHA_POLL_INTERVAL / 2));
    }
  }

  console.error(`2Captcha timeout for task ID: ${taskId}`);
  return { success: false, reason: 'TIMEOUT' };
}

/**
 * Parse a proxy string for 2Captcha
 * @param {string} proxyString - The proxy string in the format http://username:password@hostname:port
 * @returns {Object|null} - The parsed proxy object or null if parsing fails
 */
function parseProxyStringFor2Captcha(proxyString) {
  console.log(`Parsing proxy string for 2Captcha: ${proxyString}`);

  if (!proxyString) {
    console.error("Proxy string is empty or null");
    return null;
  }

  try {
    const url = new URL(proxyString);
    const type = url.protocol.replace(":", "").toLowerCase();

    if (type !== "http" && type !== "https") {
      console.error(`Unsupported protocol: ${type}`);
      return null;
    }

    const address = url.hostname;

    if (!address) {
      console.error(`Missing host in proxy string: ${proxyString}`);
      return null;
    }

    const defaultPort = type === "https" ? 443 : 80;
    let port = parseInt(url.port, 10) || defaultPort;

    if (isNaN(port) || port <= 0 || port > 65535) {
      console.warn(`Invalid port "${url.port}", using ${defaultPort}`);
      port = defaultPort;
    }

    const login = url.username ? decodeURIComponent(url.username) : undefined;
    const password = url.password ? decodeURIComponent(url.password || "") : undefined;

    const result = {
      type: type.toUpperCase(),
      address,
      port,
      login,
      password
    };

    console.log(`Successfully parsed proxy: ${JSON.stringify({
      ...result,
      password: result.password ? '***' : undefined
    })}`);

    return result;
  } catch (error) {
    console.error(`Error parsing proxy string: ${error.message}`);
    return null;
  }
}

/**
 * Try to fetch the URL using curl
 * @param {string} url - The URL to fetch
 * @returns {Promise<{success: boolean, content: string, hasCaptcha: boolean}>}
 */
async function tryCurl(url) {
  console.log(`Trying curl for: ${url}`);

  try {
    // Set up curl command with appropriate headers
    const curlCommand = `curl -s -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" "${url}"`;

    // Execute curl command
    const response = execSync(curlCommand).toString();

    // Check for CAPTCHA indicators
    const hasCaptcha = CAPTCHA_INDICATORS.some(indicator => response.includes(indicator));

    if (hasCaptcha) {
      console.log('CAPTCHA detected in curl response');
      await fs.writeFile('curl-captcha-response.html', response);
      console.log('Saved CAPTCHA response to curl-captcha-response.html');
    } else {
      console.log('No CAPTCHA detected in curl response');
      await fs.writeFile('curl-response.html', response);
      console.log('Saved response to curl-response.html');
    }

    return {
      success: true,
      content: response,
      hasCaptcha
    };
  } catch (error) {
    console.error(`Curl error: ${error.message}`);
    return {
      success: false,
      content: null,
      hasCaptcha: false
    };
  }
}

/**
 * Try to fetch the URL using puppeteer with stealth
 * @param {string} url - The URL to fetch
 * @returns {Promise<{success: boolean, content: string}>}
 */
async function tryPuppeteerStealth(url) {
  console.log(`Trying puppeteer-stealth for: ${url}`);

  // Get the Chromium executable path from environment variables
  const executablePath = process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium';
  console.log(`Using Chromium executable path: ${executablePath}`);

  // Proxy configuration
  const proxyUrl = process.env.HTTP_PROXY || 'http://otnlqxce-rotate:pgg7cco5d94z@p.webshare.io:80';
  console.log(`Using proxy: ${proxyUrl}`);

  // Parse the proxy URL
  const parsedProxyUrl = new URL(proxyUrl);
  const proxyHostPort = `${parsedProxyUrl.hostname}:${parsedProxyUrl.port || 80}`;
  console.log(`Proxy server: ${proxyHostPort}`);

  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--proxy-server=${proxyHostPort}`
      ]
    });

    const page = await browser.newPage();

    // Set proxy authentication
    await page.authenticate({
      username: parsedProxyUrl.username,
      password: parsedProxyUrl.password
    });

    // Set a more realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    // Set extra HTTP headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Referer': 'https://www.google.com/'
    });

    console.log(`Navigating to ${url}...`);

    // Navigate to the URL
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for the content to load
    console.log('Waiting for content to load...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Get the HTML content
    console.log('Getting page content...');
    const content = await page.content();
    console.log(`Successfully fetched HTML content (${content.length} bytes)`);

    // Save the HTML content to a file
    await fs.writeFile('puppeteer-stealth-response.html', content);
    console.log('Saved HTML content to puppeteer-stealth-response.html');

    return {
      success: true,
      content
    };
  } catch (error) {
    console.error(`Puppeteer-stealth error: ${error.message}`);
    return {
      success: false,
      content: null
    };
  } finally {
    if (browser) {
      await browser.close();
      console.log('Browser closed');
    }
  }
}

/**
 * Try to fetch the URL using puppeteer with CAPTCHA handling
 * @param {string} url - The URL to fetch
 * @returns {Promise<{success: boolean, content: string}>}
 */
async function tryPuppeteerCaptcha(url) {
  console.log(`Trying puppeteer-captcha for: ${url}`);

  if (!CAPTCHA_API_KEY) {
    console.error("Missing CAPTCHA API key. Set CAPTCHA_API_KEY in your .env file.");
    return {
      success: false,
      content: null
    };
  }

  // Get the Chromium executable path from environment variables
  const executablePath = process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium';
  console.log(`Using Chromium executable path: ${executablePath}`);

  // Proxy configuration
  const proxyUrl = process.env.HTTP_PROXY || 'http://otnlqxce-rotate:pgg7cco5d94z@p.webshare.io:80';
  console.log(`Using proxy: ${proxyUrl}`);

  // Parse the proxy URL
  const parsedProxyUrl = new URL(proxyUrl);
  const proxyHostPort = `${parsedProxyUrl.hostname}:${parsedProxyUrl.port || 80}`;
  console.log(`Proxy server: ${proxyHostPort}`);

  // Parse proxy for 2Captcha
  const proxyInfoFor2Captcha = parseProxyStringFor2Captcha(proxyUrl);
  if (!proxyInfoFor2Captcha) {
    console.error("Failed to parse proxy for 2Captcha");
    return {
      success: false,
      content: null
    };
  }

  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--proxy-server=${proxyHostPort}`
      ]
    });

    const page = await browser.newPage();

    // Set proxy authentication
    await page.authenticate({
      username: parsedProxyUrl.username,
      password: parsedProxyUrl.password
    });

    // Set a more realistic user agent
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
    await page.setUserAgent(userAgent);

    // Set extra HTTP headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Referer': 'https://www.google.com/'
    });

    console.log(`Navigating to ${url}...`);

    // Navigate to the URL
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for the content to load
    console.log('Waiting for content to load...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check for DataDome CAPTCHA
    const dataDomeCaptchaInfo = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[src*="captcha-delivery.com"], iframe[src*="geo.captcha-delivery.com"]');
      if (!iframe) return { detected: false };

      return {
        detected: true,
        captchaUrl: iframe.src
      };
    });

    console.log(`DataDome CAPTCHA detected: ${dataDomeCaptchaInfo.detected}`);

    if (dataDomeCaptchaInfo.detected) {
      console.log(`CAPTCHA URL: ${dataDomeCaptchaInfo.captchaUrl}`);
      console.log('Solving DataDome CAPTCHA with 2Captcha...');

      // Solve the CAPTCHA
      const captchaSolution = await solveDataDomeWith2Captcha(
        url,
        dataDomeCaptchaInfo.captchaUrl,
        userAgent,
        proxyInfoFor2Captcha
      );

      if (!captchaSolution.success) {
        console.error(`Failed to solve CAPTCHA: ${captchaSolution.reason}`);
        return {
          success: false,
          content: null
        };
      }

      console.log('CAPTCHA solved successfully!');

      // Format the cookie
      const formattedCookie = formatDataDomeCookie(captchaSolution.cookie, url);
      if (!formattedCookie) {
        console.error('Failed to format cookie');
        return {
          success: false,
          content: null
        };
      }

      // Set the cookie
      console.log('Setting cookie...');

      // Log the full cookie object
      console.log('Cookie object to be set:', JSON.stringify(formattedCookie, null, 2));

      try {
        // Set the cookie
        await page.setCookie(formattedCookie);

        // Log all cookies after setting
        const cookies = await page.cookies(url);
        console.log('All cookies after setting:', JSON.stringify(cookies, null, 2));

        // Reload the page
        console.log('Reloading page...');
        await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: 60000
        });

        // Log cookies again after reload
        const cookiesAfterReload = await page.cookies(url);
        console.log('Cookies after reload:', JSON.stringify(cookiesAfterReload, null, 2));
      } catch (error) {
        console.error('Error setting cookie or reloading page:', error.message);
        return {
          success: false,
          content: null
        };
      }

      // Wait for the content to load
      console.log('Waiting for content to load after CAPTCHA...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check if CAPTCHA is still present or if we have article content
      const contentCheck = await page.evaluate(() => {
        // Check for CAPTCHA iframe
        const iframe = document.querySelector('iframe[src*="captcha-delivery.com"], iframe[src*="geo.captcha-delivery.com"]');

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

      console.log('Content check after CAPTCHA solving:', JSON.stringify(contentCheck, null, 2));

      // Even if the CAPTCHA iframe is still present, check if we have article content
      if (contentCheck.hasMainContent || contentCheck.title.includes('New York Times')) {
        console.log('CAPTCHA bypass successful! Article content found.');
        console.log(`Article title: ${contentCheck.title}`);
        if (contentCheck.h1) {
          console.log(`Article headline: ${contentCheck.h1}`);
        }
      } else if (contentCheck.captchaIframe) {
        console.error('CAPTCHA is still present after solving and no article content found');
        return {
          success: false,
          content: null
        };
      } else {
        console.log('CAPTCHA iframe not found, but no clear article content either. Proceeding anyway.');
      }

      console.log('CAPTCHA bypass successful!');
    }

    // Get the HTML content
    console.log('Getting page content...');
    const content = await page.content();
    console.log(`Successfully fetched HTML content (${content.length} bytes)`);

    // Save the HTML content to a file
    await fs.writeFile('puppeteer-captcha-response.html', content);
    console.log('Saved HTML content to puppeteer-captcha-response.html');

    // Check if we got the article content
    const contentCheck = await page.evaluate(() => {
      // Check for various content indicators
      const mainContent = document.querySelector('main#site-content');
      const articleBody = document.querySelector('article[name="articleBody"]');
      const sectionArticleBody = document.querySelector('section[name="articleBody"]');
      const title = document.title;
      const h1 = document.querySelector('h1')?.textContent;

      // Check for CAPTCHA indicators
      const captchaIframe = document.querySelector('iframe[src*="captcha-delivery.com"]');

      return {
        hasMainContent: !!mainContent,
        hasArticleBody: !!articleBody,
        hasSectionArticleBody: !!sectionArticleBody,
        title: title || 'No title found',
        h1: h1 || 'No h1 found',
        hasCaptchaIframe: !!captchaIframe
      };
    });

    console.log('Content check results:', JSON.stringify(contentCheck, null, 2));

    if (!contentCheck.hasCaptchaIframe && (contentCheck.hasMainContent || contentCheck.title.includes('New York Times'))) {
      console.log('CAPTCHA bypass successful! Article content found.');
      console.log(`Article title: ${contentCheck.title}`);
      if (contentCheck.h1) {
        console.log(`Article headline: ${contentCheck.h1}`);
      }
    } else if (contentCheck.hasCaptchaIframe) {
      console.log('CAPTCHA bypass failed. CAPTCHA iframe still present.');
    } else {
      console.log('CAPTCHA bypass may have failed. No article content found.');
    }

    return {
      success: true,
      content
    };
  } catch (error) {
    console.error(`Puppeteer-captcha error: ${error.message}`);
    return {
      success: false,
      content: null
    };
  } finally {
    if (browser) {
      await browser.close();
      console.log('Browser closed');
    }
  }
}

/**
 * Main function to demonstrate the optimal flow
 * @param {string} url - The URL to fetch
 */
async function optimalFlow(url) {
  console.log(`Starting optimal flow for: ${url}`);

  // Step 1: Try curl first
  const curlResult = await tryCurl(url);

  if (!curlResult.success) {
    console.log('Curl failed, trying puppeteer-stealth...');
    const puppeteerStealthResult = await tryPuppeteerStealth(url);

    if (!puppeteerStealthResult.success) {
      console.log('Puppeteer-stealth failed, trying puppeteer-captcha...');
      const puppeteerCaptchaResult = await tryPuppeteerCaptcha(url);

      if (!puppeteerCaptchaResult.success) {
        console.error('All methods failed');
        return;
      }
    }

    return;
  }

  // Step 2: Check for CAPTCHA indicators
  if (curlResult.hasCaptcha) {
    console.log('CAPTCHA detected in curl response, skipping puppeteer-stealth and trying puppeteer-captcha...');
    const puppeteerCaptchaResult = await tryPuppeteerCaptcha(url);

    if (!puppeteerCaptchaResult.success) {
      console.error('Puppeteer-captcha failed');
    }

    return;
  }

  // Step 3: If no CAPTCHA, check if curl response has what we need
  console.log('No CAPTCHA detected in curl response, checking if it has what we need...');

  // This is a simplified check - in a real implementation, you would use more sophisticated
  // content detection based on your specific needs
  if (curlResult.content.includes('<article') || curlResult.content.includes('<main')) {
    console.log('Curl response contains what we need, using it');

    // Log what was found
    if (curlResult.content.includes('<article')) {
      console.log('Found <article> tag in curl response');
    }
    if (curlResult.content.includes('<main')) {
      console.log('Found <main> tag in curl response');
    }

    // In a real implementation, you would extract the content here
    return;
  }

  // Step 4: If curl doesn't have what we need, try puppeteer-stealth
  console.log('Curl response does not have what we need, trying puppeteer-stealth...');
  const puppeteerStealthResult = await tryPuppeteerStealth(url);

  if (!puppeteerStealthResult.success) {
    console.log('Puppeteer-stealth failed, trying puppeteer-captcha...');
    const puppeteerCaptchaResult = await tryPuppeteerCaptcha(url);

    if (!puppeteerCaptchaResult.success) {
      console.error('All methods failed');
    }
  }
}

// Function to log to both console and file
async function log(message) {
  console.log(message);
  await fs.appendFile('captcha-solving.log', message + '\n');
}

// Override console.log, console.error, and console.warn
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = function() {
  const args = Array.from(arguments).join(' ');
  originalConsoleLog.apply(console, arguments);
  fs.appendFile('captcha-solving.log', args + '\n').catch(() => {});
};

console.error = function() {
  const args = Array.from(arguments).join(' ');
  originalConsoleError.apply(console, arguments);
  fs.appendFile('captcha-solving.log', 'ERROR: ' + args + '\n').catch(() => {});
};

console.warn = function() {
  const args = Array.from(arguments).join(' ');
  originalConsoleWarn.apply(console, arguments);
  fs.appendFile('captcha-solving.log', 'WARN: ' + args + '\n').catch(() => {});
};

// Clear the log file
await fs.writeFile('captcha-solving.log', '');

// Run the optimal flow with the provided URL
const url = process.argv[2] || 'https://www.nytimes.com/2025/05/15/health/gene-editing-personalized-rare-disorders.html';
optimalFlow(url).catch(error => {
  console.error(error);
  process.exit(1);
});
