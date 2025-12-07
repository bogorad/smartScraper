import fs from 'fs';
import path from 'path';
import { initConfig, getLogDir } from './src/config.js';
import { initializeEngine, scrapeUrl } from './src/core/engine.js';
import { PuppeteerBrowserAdapter } from './src/adapters/puppeteer-browser.js';
import { OpenRouterLlmAdapter } from './src/adapters/openrouter-llm.js';
import { TwoCaptchaAdapter } from './src/adapters/twocaptcha.js';
import { FsKnownSitesAdapter } from './src/adapters/fs-known-sites.js';
import { logger } from './src/utils/logger.js';
import { OUTPUT_TYPES } from './src/constants.js';

async function main() {
  console.log('Initializing...');
  initConfig();
  
  // Set up logs to go to testing dir if not already set (though user request implies they handle env)
  // But let's verify we are using the requested behavior.
  // The user said "run tests on all websites... no discovery... simply report".
  
  const browserPort = new PuppeteerBrowserAdapter();
  const llmPort = new OpenRouterLlmAdapter(); // Won't be used for discovery
  const captchaPort = new TwoCaptchaAdapter();
  const knownSitesPort = new FsKnownSitesAdapter();
  
  await browserPort.init();
  initializeEngine(browserPort, llmPort, captchaPort, knownSitesPort);

  const urlsFile = 'testing/urls_for_testing.txt';
  if (!fs.existsSync(urlsFile)) {
    console.error(`File not found: ${urlsFile}`);
    process.exit(1);
  }

  const urls = fs.readFileSync(urlsFile, 'utf-8')
    .split('\n')
    .map(u => u.trim())
    .filter(u => u && !u.startsWith('#'));

  console.log(`Found ${urls.length} URLs to test.`);

  const results: { url: string; success: boolean; error?: string }[] = [];

  for (const url of urls) {
    console.log(`Testing: ${url}`);
    try {
      const result = await scrapeUrl(url, {
        disableDiscovery: true,
        outputType: OUTPUT_TYPES.METADATA_ONLY // We just want to check success
      });

      results.push({
        url,
        success: result.success,
        error: result.error
      });

      console.log(`  -> ${result.success ? 'SUCCESS' : 'FAILED'} ${result.error ? `(${result.error})` : ''}`);
    } catch (error) {
      console.error(`  -> ERROR: ${error}`);
      results.push({ url, success: false, error: String(error) });
    }
  }

  await browserPort.close();

  console.log('\n--- SUMMARY ---');
  const succeeded = results.filter(r => r.success);
  console.log(`Total: ${results.length}, Succeeded: ${succeeded.length}, Failed: ${results.length - succeeded.length}`);
  
  if (succeeded.length > 0) {
    console.log('\nSucceeded Sites:');
    succeeded.forEach(r => console.log(`- ${r.url}`));
  }
}

main().catch(console.error);
