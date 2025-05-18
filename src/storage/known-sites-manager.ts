// src/storage/known-sites-manager.ts
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { ConfigurationError } from '../utils/error-handler.js';
import { scraperSettings as scraperSettingsInstance } from '../../config/index.js'; // Corrected import for scraperSettings.
import { MethodValue } from '../constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CaptchaCookie {
  name: string;
  value: string;
  timestamp: string;
}

export interface SiteConfig {
  domain_pattern: string;
  method: MethodValue;
  xpath_main_content: string;
  last_successful_scrape_timestamp: string | null;
  failure_count_since_last_success: number;
  site_specific_headers: Record<string, string> | null;
  user_agent_to_use: string | null;
  needs_captcha_solver: boolean;
  puppeteer_wait_conditions: any | null; // Define more specific type if possible
  discovered_by_llm: boolean;
  captcha_cookie?: CaptchaCookie;
}

export class KnownSitesManager {
  private storageFilePath: string;
  private storageData: Record<string, SiteConfig> = {};
  private isInitialized: boolean = false;
  private _initPromise: Promise<void> | null = null;
  private _writeLock: Promise<void> = Promise.resolve();

  constructor(storagePath?: string) {
    this.storageFilePath = storagePath ||
      (scraperSettingsInstance ? scraperSettingsInstance.knownSitesStoragePath : path.resolve(__dirname, '..', '..', 'data', 'known_sites_storage.json'));

    if (!path.isAbsolute(this.storageFilePath)) {
      const projectRootDir = path.resolve(__dirname, '..', '..');
      this.storageFilePath = path.resolve(projectRootDir, this.storageFilePath);
      logger.debug(`[KnownSitesManager constructor] Resolved relative storagePath to: ${this.storageFilePath}`);
    }
    logger.debug(`[KnownSitesManager constructor] Initialized with storage path: ${this.storageFilePath}`);
    this._initPromise = this._initialize();
  }

  private async _initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('[KnownSitesManager _initialize] Already initialized.');
      return;
    }
    if (this._initPromise && this._initPromise !== Promise.resolve()) { // Check if it's not the initial resolved promise
        logger.debug('[KnownSitesManager _initialize] Initialization already in progress, awaiting existing promise.');
        return this._initPromise;
    }

    logger.debug(`[KnownSitesManager _initialize] Initializing storage from ${this.storageFilePath}`);
    try {
      await fs.mkdir(path.dirname(this.storageFilePath), { recursive: true });
      const fileExists = await fs.access(this.storageFilePath).then(() => true).catch(() => false);

      if (fileExists) {
        const fileContent = await fs.readFile(this.storageFilePath, 'utf-8');
        if (fileContent.trim() === '') {
            logger.warn(`[KnownSitesManager _initialize] Storage file is empty. Initializing with empty data.`);
            this.storageData = {};
        } else {
            this.storageData = JSON.parse(fileContent);
        }
        logger.info(`Known sites storage loaded successfully from: ${this.storageFilePath}. Entries: ${Object.keys(this.storageData).length}`);
      } else {
        this.storageData = {};
        await this._saveStorage(); // Save empty storage to create the file
        logger.info(`Known sites storage file not found. Created new empty storage at: ${this.storageFilePath}`);
      }
    } catch (error: any) {
      logger.error(`[KnownSitesManager _initialize] Failed to initialize or load known sites storage: ${error.message}`);
      this.storageData = {}; // Default to empty storage on error
      // throw new ConfigurationError('Failed to initialize known sites storage', { originalError: error.message, path: this.storageFilePath });
    } finally {
        this.isInitialized = true;
        this._initPromise = Promise.resolve(); // Mark initialization as complete (or failed but complete)
    }
  }

  private async _ensureInitialized(): Promise<void> {
    if (!this.isInitialized && !this._initPromise) {
        logger.warn('[KnownSitesManager _ensureInitialized] Initialization not started, starting now.');
        this._initPromise = this._initialize();
    }
    if (this._initPromise) {
        await this._initPromise;
    }
    if (!this.isInitialized) {
        const errorMsg = '[KnownSitesManager _ensureInitialized] CRITICAL: Initialization failed or did not complete.';
        logger.error(`[KnownSitesManager _ensureInitialized] ${errorMsg}`);
        // throw new ConfigurationError(errorMsg);
    }
  }

  private async _acquireWriteLock(): Promise<() => void> {
    let releaseFunction: () => void;
    const newLockPromise = new Promise<void>(resolve => {
        releaseFunction = resolve;
    });

    const previousLock = this._writeLock;
    this._writeLock = previousLock.then(() => newLockPromise);
    
    await previousLock; // Wait for the previous lock to be released
    // @ts-ignore If releaseFunction is not assigned before newLockPromise resolves, this is an issue.
    // However, the promise constructor runs synchronously, so releaseFunction will be assigned.
    return releaseFunction!; 
  }


  private async _saveStorage(): Promise<void> {
    await this._ensureInitialized();
    const releaseLock = await this._acquireWriteLock();
    try {
      logger.debug(`[KnownSitesManager _saveStorage] Attempting to save storage. Current entries: ${Object.keys(this.storageData).length}`);
      const jsonData = JSON.stringify(this.storageData, null, 2);
      await fs.writeFile(this.storageFilePath, jsonData, 'utf-8');
      logger.debug('[KnownSitesManager _saveStorage] Known sites storage saved successfully.');
    } catch (error: any) {
      logger.error(`[KnownSitesManager _saveStorage] Failed to save known sites storage: ${error.message}`);
      throw new ConfigurationError('Failed to save known sites storage', {
        originalErrorName: error.name,
        originalErrorMessage: error.message,
        path: this.storageFilePath,
      });
    } finally {
        releaseLock();
    }
  }

  async getConfig(domain: string): Promise<SiteConfig | null> {
    await this._ensureInitialized();
    if (Object.prototype.hasOwnProperty.call(this.storageData, domain)) {
      if (scraperSettingsInstance.debug) {
        logger.debug(`[KnownSitesManager getConfig] Config found for domain: ${domain}. Keys: ${Object.keys(this.storageData[domain]).join(', ')}`);
      }
      return { ...this.storageData[domain] }; // Return a copy
    }
    if (scraperSettingsInstance.debug) {
        logger.debug(`[KnownSitesManager getConfig] No config found for domain: ${domain}`);
    }
    return null;
  }

  async saveConfig(domain: string, config: Omit<SiteConfig, 'domain_pattern'>): Promise<void> {
    await this._ensureInitialized();
    if (!domain || !config) {
        logger.warn('[KnownSitesManager saveConfig] Attempted to save invalid config or domain.');
        return;
    }
    this.storageData[domain] = { ...config, domain_pattern: domain };
    await this._saveStorage();
    logger.info(`[KnownSitesManager saveConfig] Configuration saved/updated for domain: ${domain}`);
    if (scraperSettingsInstance.debug) {
        logger.debug(`[KnownSitesManager saveConfig] Saved config for ${domain}:`, this.storageData[domain]);
    }
  }

  async incrementFailure(domain: string): Promise<void> {
    await this._ensureInitialized();
    if (this.storageData[domain]) {
      this.storageData[domain].failure_count_since_last_success += 1;
      await this._saveStorage();
      logger.info(`[KnownSitesManager incrementFailure] Incremented failure count for ${domain} to ${this.storageData[domain].failure_count_since_last_success}`);
    } else {
      logger.warn(`[KnownSitesManager incrementFailure] Attempted to increment failure count for unknown domain: ${domain}`);
    }
  }

  async updateSuccess(domain: string): Promise<void> {
    await this._ensureInitialized();
    if (this.storageData[domain]) {
      this.storageData[domain].failure_count_since_last_success = 0;
      this.storageData[domain].last_successful_scrape_timestamp = new Date().toISOString();
      await this._saveStorage();
      logger.info(`[KnownSitesManager updateSuccess] Updated success metrics for ${domain}.`);
      if (scraperSettingsInstance.debug) {
        logger.debug(`[KnownSitesManager updateSuccess] Success metrics for ${domain}:`, this.storageData[domain]);
      }
    } else {
      logger.warn(`[KnownSitesManager updateSuccess] Attempted to update success metrics for unknown domain: ${domain}`);
    }
  }

  async deleteConfig(domain: string): Promise<boolean> {
    await this._ensureInitialized();
    if (this.storageData[domain]) {
      delete this.storageData[domain];
      await this._saveStorage();
      logger.info(`[KnownSitesManager deleteConfig] Configuration deleted for domain: ${domain}`);
      return true;
    }
    logger.warn(`[KnownSitesManager deleteConfig] Attempted to delete configuration for non-existent domain: ${domain}`);
    return false;
  }

  async getAllConfigs(): Promise<Record<string, SiteConfig>> {
    await this._ensureInitialized();
    if (scraperSettingsInstance.debug) {
        logger.debug(`[KnownSitesManager getAllConfigs] Retrieving all configurations. Count: ${Object.keys(this.storageData).length}`);
    }
    return { ...this.storageData }; // Return a copy
  }

  async storeCaptchaCookie(domain: string, cookieName: string, cookieValue: string): Promise<void> {
    await this._ensureInitialized();
    if (!domain || !cookieName || !cookieValue) {
        logger.warn('[KnownSitesManager storeCaptchaCookie] Attempted to store invalid CAPTCHA cookie (missing domain, name, or value).');
        return;
    }
    const config = this.storageData[domain] || {
        domain_pattern: domain,
        method: 'curl', // Provide a default or ensure it's set
        xpath_main_content: '', // Provide a default
        last_successful_scrape_timestamp: null,
        failure_count_since_last_success: 0,
        site_specific_headers: null,
        user_agent_to_use: null,
        needs_captcha_solver: true, // Assume true if storing cookie
        puppeteer_wait_conditions: null,
        discovered_by_llm: false,
    };
    config.captcha_cookie = { name: cookieName, value: cookieValue, timestamp: new Date().toISOString() };
    this.storageData[domain] = config;
    await this._saveStorage();
    logger.info(`[KnownSitesManager storeCaptchaCookie] CAPTCHA cookie stored for domain: ${domain}. Name: ${cookieName}`);
    if (scraperSettingsInstance.debug) {
        logger.debug(`[KnownSitesManager storeCaptchaCookie] Stored cookie for ${domain}:`, config.captcha_cookie);
    }
  }

  async getCaptchaCookie(domain: string): Promise<CaptchaCookie | null> {
    await this._ensureInitialized();
    const config = this.storageData[domain];
    if (config && config.captcha_cookie) {
      // Optional: Add cookie expiration logic here if needed
      logger.debug(`[KnownSitesManager getCaptchaCookie] CAPTCHA cookie found for domain: ${domain}. Name: ${config.captcha_cookie.name}`);
      return { ...config.captcha_cookie };
    }
    logger.debug(`[KnownSitesManager getCaptchaCookie] No CAPTCHA cookie found for domain: ${domain}`);
    return null;
  }
}
