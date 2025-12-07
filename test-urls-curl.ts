import fs from 'fs';
import axios from 'axios';
import { getApiToken, initConfig } from './src/config.js';

// Initialize config to get the token
initConfig();
const API_TOKEN = getApiToken();
const BASE_URL = 'http://localhost:5555';

async function main() {
  if (!API_TOKEN) {
    console.error('Error: API_TOKEN not found in environment/config.');
    process.exit(1);
  }

  const urlsFile = 'testing/urls_for_testing.txt';
  if (!fs.existsSync(urlsFile)) {
    console.error(`File not found: ${urlsFile}`);
    process.exit(1);
  }

  const urls = fs.readFileSync(urlsFile, 'utf-8')
    .split('\n')
    .map(u => u.trim())
    .filter(u => u && !u.startsWith('#'));

  console.log(`Found ${urls.length} URLs to test against ${BASE_URL}.`);

  const results: { url: string; success: boolean; error?: string }[] = [];

  for (const url of urls) {
    console.log(`Testing: ${url}`);
    try {
      // Note: disableDiscovery param needs to be supported by the API endpoint.
      // Based on previous code, we added it to ScrapeOptions interface.
      // We assume the API route passes the body to the engine's scrapeUrl options.
      const response = await axios.post(`${BASE_URL}/api/scrape`, {
        url,
        outputType: 'metadata_only',
        disableDiscovery: true
      }, {
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000 // 2 minutes timeout
      });

      const result = response.data;
      const success = result.success;
      
      results.push({
        url,
        success,
        error: success ? undefined : result.error
      });

      console.log(`  -> ${success ? 'SUCCESS' : 'FAILED'} ${result.error ? `(${result.error})` : ''}`);
    } catch (error) {
      const msg = axios.isAxiosError(error) 
        ? (error.response?.data?.error || error.message) 
        : String(error);
      
      console.error(`  -> ERROR: ${msg}`);
      results.push({ url, success: false, error: msg });
    }
  }

  console.log('\n--- SUMMARY ---');
  const succeeded = results.filter(r => r.success);
  console.log(`Total: ${results.length}, Succeeded: ${succeeded.length}, Failed: ${results.length - succeeded.length}`);
  
  if (succeeded.length > 0) {
    console.log('\nSucceeded Sites:');
    succeeded.forEach(r => console.log(`- ${r.url}`));
  }
  
  if (results.length > succeeded.length) {
     console.log('\nFailed Sites:');
     results.filter(r => !r.success).forEach(r => console.log(`- ${r.url}: ${r.error}`));
  }
}

main().catch(console.error);
