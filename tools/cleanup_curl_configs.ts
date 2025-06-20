// tools/cleanup_curl_configs.ts
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SiteConfig {
  domain_pattern: string;
  method: string;
  xpath_main_content: string;
  last_successful_scrape_timestamp: string | null;
  failure_count_since_last_success: number;
  site_specific_headers: Record<string, string> | null;
  user_agent_to_use: string | null;
  needs_captcha_solver: boolean;
  puppeteer_wait_conditions: any | null;
  discovered_by_llm: boolean;
  captcha_cookie?: any;
}

async function cleanupCurlConfigs(): Promise<void> {
  const projectRootDir = path.resolve(__dirname, '..', '..');
  const storageFilePath = path.join(projectRootDir, 'dist', 'data', 'known_sites_storage.json');
  
  console.log(`Reading storage file: ${storageFilePath}`);
  
  try {
    // Read the current storage file
    const fileContent = await fs.readFile(storageFilePath, 'utf-8');
    const storageData: Record<string, SiteConfig> = JSON.parse(fileContent);
    
    console.log(`Total entries before cleanup: ${Object.keys(storageData).length}`);
    
    // Find and remove entries with curl method
    const curlDomains: string[] = [];
    const cleanedData: Record<string, SiteConfig> = {};
    
    for (const [domain, config] of Object.entries(storageData)) {
      if (config.method === 'curl') {
        curlDomains.push(domain);
        console.log(`Found cURL config for domain: ${domain}`);
      } else {
        cleanedData[domain] = config;
      }
    }
    
    console.log(`\nFound ${curlDomains.length} cURL configs to remove:`);
    curlDomains.forEach(domain => console.log(`  - ${domain}`));
    
    if (curlDomains.length === 0) {
      console.log('\nNo cURL configs found. Nothing to clean up.');
      return;
    }
    
    // Create backup of original file
    const backupPath = `${storageFilePath}.backup.${Date.now()}`;
    await fs.copyFile(storageFilePath, backupPath);
    console.log(`\nBackup created: ${backupPath}`);
    
    // Write cleaned data back to file
    const cleanedJson = JSON.stringify(cleanedData, null, 2);
    await fs.writeFile(storageFilePath, cleanedJson, 'utf-8');
    
    console.log(`\nCleanup completed!`);
    console.log(`Total entries after cleanup: ${Object.keys(cleanedData).length}`);
    console.log(`Removed ${curlDomains.length} cURL configs`);
    console.log(`\nRemoved domains:`);
    curlDomains.forEach(domain => console.log(`  ✓ ${domain}`));
    
  } catch (error: any) {
    console.error(`Error during cleanup: ${error.message}`);
    process.exit(1);
  }
}

// Run the cleanup
(async () => {
  try {
    await cleanupCurlConfigs();
    console.log('\n✅ Cleanup completed successfully!');
  } catch (error: any) {
    console.error(`❌ Cleanup failed: ${error.message}`);
    process.exit(1);
  }
})();
