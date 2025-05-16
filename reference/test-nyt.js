import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

puppeteer.use(StealthPlugin());

async function testNYT() {
  console.log('Starting Puppeteer test for NYT...');

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

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
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
      username: 'otnlqxce-rotate',
      password: 'pgg7cco5d94z'
    });

    // Set a more realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    // Set extra HTTP headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Referer': 'https://www.google.com/'
    });

    const url = 'https://www.nytimes.com/2025/05/15/health/gene-editing-personalized-rare-disorders.html';
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

    // Check for DataDome CAPTCHA
    const dataDomeCaptcha = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[src*="captcha-delivery.com"], iframe[src*="geo.captcha-delivery.com"]');
      return iframe ? true : false;
    });

    console.log(`DataDome CAPTCHA detected: ${dataDomeCaptcha}`);

    if (dataDomeCaptcha) {
      console.log('DataDome CAPTCHA detected. In a production environment, this would be handled by 2Captcha.');
      console.log('See docs/proxy-usage.md for details on how to handle DataDome CAPTCHA challenges.');
    }

    // Check if the article body exists
    const articleBody = await page.evaluate(() => {
      const article = document.querySelector('article[name="articleBody"]');
      return article ? true : false;
    });

    console.log(`Article body found: ${articleBody}`);

    // Save the HTML content to a file
    await fs.writeFile('nyt-article.html', content);
    console.log('Saved HTML content to nyt-article.html');

    // Print the HTML content to the console
    console.log('HTML Content:');
    console.log(content);

  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    await browser.close();
    console.log('Browser closed');
  }
}

testNYT().catch(console.error);
