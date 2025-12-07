import fs from 'fs/promises';
import path from 'path';
import { parse, stringify } from 'comment-json';
import type { KnownSitesPort } from '../ports/known-sites.js';
import type { SiteConfig } from '../domain/models.js';
import { utcNow } from '../utils/date.js';
import { Mutex } from '../utils/mutex.js';
import { getDataDir } from '../config.js';

const DATA_DIR = getDataDir();
const SITES_FILE = path.join(DATA_DIR, 'sites.jsonc');

export class FsKnownSitesAdapter implements KnownSitesPort {
  private cache: SiteConfig[] | null = null;
  private mutex = new Mutex();

  private async ensureFile(): Promise<void> {
    try {
      await fs.access(SITES_FILE);
    } catch {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(SITES_FILE, '[]');
    }
  }

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

  async getConfig(domain: string): Promise<SiteConfig | undefined> {
    return this.mutex.runExclusive(async () => {
      const configs = await this.load();
      return configs.find(c => c.domainPattern === domain);
    });
  }

  async saveConfig(config: SiteConfig): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const configs = await this.load();
      const index = configs.findIndex(c => c.domainPattern === config.domainPattern);
      
      if (index >= 0) {
        configs[index] = config;
      } else {
        configs.push(config);
      }
      
      await this.save(configs);
    });
  }

  async incrementFailure(domain: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const configs = await this.load();
      const config = configs.find(c => c.domainPattern === domain);
      
      if (config) {
        config.failureCountSinceLastSuccess++;
        await this.save(configs);
      }
    });
  }

  async markSuccess(domain: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const configs = await this.load();
      const config = configs.find(c => c.domainPattern === domain);
      
      if (config) {
        config.failureCountSinceLastSuccess = 0;
        config.lastSuccessfulScrapeTimestamp = utcNow();
        await this.save(configs);
      }
    });
  }

  async deleteConfig(domain: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const configs = await this.load();
      const filtered = configs.filter(c => c.domainPattern !== domain);
      await this.save(filtered);
    });
  }

  async getAllConfigs(): Promise<SiteConfig[]> {
    return this.mutex.runExclusive(async () => {
      return await this.load();
    });
  }
}

export const knownSitesAdapter = new FsKnownSitesAdapter();
