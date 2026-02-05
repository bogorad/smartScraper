import fs from 'fs/promises';
import path from 'path';
import PQueue from 'p-queue';
import { parse, stringify } from 'comment-json';
import type { KnownSitesPort } from '../ports/known-sites.js';
import type { SiteConfig } from '../domain/models.js';
import { utcNow } from '../utils/date.js';
import { getDataDir } from '../config.js';
import { logger } from '../utils/logger.js';

function getSitesFile(): string {
  return path.join(getDataDir(), 'sites.jsonc');
}

export class FsKnownSitesAdapter implements KnownSitesPort {
  private cache: SiteConfig[] | null = null;
  private writeQueue = new PQueue({ concurrency: 1 });

  private async ensureFile(): Promise<void> {
    const sitesFile = getSitesFile();
    try {
      await fs.access(sitesFile);
    } catch {
      await fs.mkdir(getDataDir(), { recursive: true });
      await fs.writeFile(sitesFile, '[]');
    }
  }

  private async load(): Promise<SiteConfig[]> {
    if (this.cache) return [...this.cache]; // Return copy to prevent external mutation
    await this.ensureFile();
    const content = await fs.readFile(getSitesFile(), 'utf-8');
    this.cache = parse(content) as unknown as SiteConfig[];
    logger.debug(`[SITES] Loaded ${this.cache.length} site configs`);
    return [...this.cache];
  }

  private async flush(configs: SiteConfig[]): Promise<void> {
    await this.ensureFile();
    const tempFile = getSitesFile() + '.tmp';
    const content = stringify(configs, null, 2);
    await fs.writeFile(tempFile, content);
    await fs.rename(tempFile, getSitesFile());
    this.cache = configs; // Update cache only after successful write
  }

  // Reads use cache directly - no queue needed
  async getConfig(domain: string): Promise<SiteConfig | undefined> {
    const configs = await this.load();
    return configs.find(c => c.domainPattern === domain);
  }

  // Writes go through queue for serialization
  async saveConfig(config: SiteConfig): Promise<void> {
    return this.writeQueue.add(async () => {
      const configs = await this.load();
      const index = configs.findIndex(c => c.domainPattern === config.domainPattern);
      
      if (index >= 0) {
        configs[index] = config;
      } else {
        configs.push(config);
      }
      
      await this.flush(configs);
    });
  }

  async incrementFailure(domain: string): Promise<void> {
    return this.writeQueue.add(async () => {
      const configs = await this.load();
      const config = configs.find(c => c.domainPattern === domain);
      
      if (config) {
        config.failureCountSinceLastSuccess++;
        await this.flush(configs);
      }
    });
  }

  async markSuccess(domain: string): Promise<void> {
    return this.writeQueue.add(async () => {
      const configs = await this.load();
      const config = configs.find(c => c.domainPattern === domain);
      
      if (config) {
        config.failureCountSinceLastSuccess = 0;
        config.lastSuccessfulScrapeTimestamp = utcNow();
        await this.flush(configs);
      }
    });
  }

  async deleteConfig(domain: string): Promise<void> {
    return this.writeQueue.add(async () => {
      const configs = await this.load();
      const filtered = configs.filter(c => c.domainPattern !== domain);
      await this.flush(filtered);
    });
  }

  // Reads use cache directly
  async getAllConfigs(): Promise<SiteConfig[]> {
    return await this.load();
  }
}

export const knownSitesAdapter = new FsKnownSitesAdapter();
