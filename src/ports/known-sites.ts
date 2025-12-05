import type { SiteConfig } from '../domain/models.js';

export interface KnownSitesPort {
  getConfig(domain: string): Promise<SiteConfig | undefined>;
  saveConfig(config: SiteConfig): Promise<void>;
  incrementFailure(domain: string): Promise<void>;
  markSuccess(domain: string): Promise<void>;
  deleteConfig(domain: string): Promise<void>;
  getAllConfigs(): Promise<SiteConfig[]>;
}
