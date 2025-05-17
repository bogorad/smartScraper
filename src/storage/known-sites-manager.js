// src/storage/known-sites-manager.js
// Enhanced debug logging for success paths and key operations.
// Corrected import for scraperSettings.
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { ConfigurationError } from '../utils/error-handler.js';

// Corrected import for a default export:
import scraperSettingsInstance from '../../config/scraper-settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class KnownSitesManager {
  constructor(storagePath) {
    // storagePath is expected to be provided by CoreScraperEngine.
    // Fallback to scraperSettingsInstance only if storagePath is not given,
    // which might happen if KnownSitesManager is instantiated directly for tests or other utilities.
    this.storageFilePath = storagePath || 
        (scraperSettingsInstance ? scraperSettingsInstance.knownSitesStoragePath : path.resolve(__dirname, '..', '..', 'data', 'known_sites_storage.json'));

    this.storageData = {};
    this.isInitialized = false; // Flag to track initialization status
    this._initPromise = null;    // Promise for ongoing initialization
    this._writeLock = Promise.resolve(); // Mutex for write operations

    // Ensure this.storageFilePath is an absolute path
    if (!path.isAbsolute(this.storageFilePath)) {
        // This assumes that if a relative path is given, it's relative to the project root.
        // This might need adjustment if storagePath can come from other contexts.
        // For now, let's assume CoreScraperEngine resolves it or it's from scraperSettingsInstance.
        // If scraperSettingsInstance was the source, its path should already be resolved or resolvable.
        // If storagePath is relative and scraperSettingsInstance wasn't used, this is a potential issue.
        // However, CoreScraperEngine passes an absolute path derived from scraperSettings.
        const projectRootDir = path.resolve(__dirname, '..', '..'); // A common way to get project root
        this.storageFilePath = path.resolve(projectRootDir, this.storageFilePath);
        logger.debug(`[KnownSitesManager constructor] Resolved relative storagePath to: ${this.storageFilePath}`);
    }
    
    logger.debug(`[KnownSitesManager constructor] Initialized with storage path: ${this.storageFilePath}`);
    this._initPromise = this._initialize(); // Start initialization
  }

  async _initialize() {
    if (this.isInitialized) {
      logger.debug('[KnownSitesManager _initialize] Already initialized.');
      return;
    }
    if (this._initPromise) {
      logger.debug('[KnownSitesManager _initialize] Initialization already in progress, awaiting existing promise.');
      return this._initPromise;
    }

    // Actual initialization logic
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
      this.isInitialized = true;
    } catch (error) {
      logger.error(`[KnownSitesManager _initialize] Failed to initialize or load known sites storage: ${error.message}`);
      this.storageData = {}; // Default to empty storage on error
      this.isInitialized = true; // Mark as initialized to prevent re-attempts that would also fail
      // Optionally, re-throw or handle as a critical error if loading is essential for startup
      // For now, it defaults to an empty in-memory store if file ops fail.
      // throw new ConfigurationError('Failed to initialize known sites storage', { originalError: error.message, path: this.storageFilePath });
    } finally {
        this._initPromise = null; // Clear the promise once done
    }
  }

  async _ensureInitialized() {
    if (!this.isInitialized && !this._initPromise) {
      // This case should ideally not be hit if constructor calls _initialize
      logger.warn('[KnownSitesManager _ensureInitialized] Initialization not started, starting now.');
      this._initPromise = this._initialize();
    }
    if (this._initPromise) {
      await this._initPromise;
    }
    // If after awaiting, it's still not initialized, there was a critical error during _initialize
    if (!this.isInitialized) {
        const errorMsg = "KnownSitesManager could not be initialized. Storage operations will likely fail or use empty data.";
        logger.error(`[KnownSitesManager _ensureInitialized] ${errorMsg}`);
        // This is a critical state. Depending on application requirements, might need to throw.
        // For now, it will proceed with potentially empty this.storageData.
        // throw new ConfigurationError(errorMsg);
    }
  }

  async _acquireWriteLock() {
    let release;
    const newLockPromise = new Promise(resolve => {
      release = resolve;
    });
    // Chain the new lock promise to the existing one
    const previousLock = this._writeLock;
    this._writeLock = previousLock.then(() => newLockPromise);
    // Wait for the previous lock to be released before this one is acquired
    await previousLock;
    return release; // Return the function to release the current lock
  }

  async _saveStorage() {
    await this._ensureInitialized(); // Ensure data is loaded before saving
    const releaseLock = await this._acquireWriteLock();
    try {
      logger.debug(`[KnownSitesManager _saveStorage] Attempting to save storage. Current entries: ${Object.keys(this.storageData).length}`);
      const jsonData = JSON.stringify(this.storageData, null, 2);
      await fs.writeFile(this.storageFilePath, jsonData, 'utf-8');
      logger.debug('[KnownSitesManager _saveStorage] Known sites storage saved successfully.');
    } catch (error) {
      logger.error(`[KnownSitesManager _saveStorage] Failed to save known sites storage: ${error.message}`);
      throw new ConfigurationError('Failed to save known sites storage', {
        originalErrorName: error.name,
        originalErrorMessage: error.message,
        path: this.storageFilePath
      });
    } finally {
      releaseLock();
    }
  }

  async getConfig(domain) {
    await this._ensureInitialized();
    if (this.storageData.hasOwnProperty(domain)) {
      if (scraperSettingsInstance && scraperSettingsInstance.debug) {
        logger.debug(`[KnownSitesManager getConfig] Config found for domain: ${domain}. Keys: ${Object.keys(this.storageData[domain]).join(', ')}`);
      }
      return { ...this.storageData[domain] }; // Return a copy
    }
    logger.debug(`[KnownSitesManager getConfig] No config found for domain: ${domain}`);
    return null;
  }

  async saveConfig(domain, config) {
    if (!domain || !config || typeof domain !== 'string' || typeof config !== 'object') {
        logger.warn('[KnownSitesManager saveConfig] Attempted to save invalid config or domain.');
        return;
    }
    await this._ensureInitialized();
    this.storageData[domain] = { ...config, domain_pattern: domain }; // Ensure domain_pattern is set
    await this._saveStorage();
    logger.info(`[KnownSitesManager saveConfig] Configuration saved/updated for domain: ${domain}`);
    if (scraperSettingsInstance && scraperSettingsInstance.debug) {
        logger.debug(`[KnownSitesManager saveConfig] Saved config for ${domain}:`, this.storageData[domain]);
    }
  }

  async incrementFailure(domain) {
    await this._ensureInitialized();
    if (this.storageData.hasOwnProperty(domain)) {
      this.storageData[domain].failure_count_since_last_success = (this.storageData[domain].failure_count_since_last_success || 0) + 1;
      await this._saveStorage();
      logger.info(`[KnownSitesManager incrementFailure] Incremented failure count for ${domain} to ${this.storageData[domain].failure_count_since_last_success}`);
    } else {
      logger.warn(`[KnownSitesManager incrementFailure] Attempted to increment failure count for unknown domain: ${domain}`);
    }
  }

  async updateSuccess(domain) {
    await this._ensureInitialized();
    if (this.storageData.hasOwnProperty(domain)) {
      this.storageData[domain].failure_count_since_last_success = 0;
      this.storageData[domain].last_successful_scrape_timestamp = new Date().toISOString();
      await this._saveStorage();
      logger.info(`[KnownSitesManager updateSuccess] Updated success metrics for ${domain}.`);
      if (scraperSettingsInstance && scraperSettingsInstance.debug) {
          logger.debug(`[KnownSitesManager updateSuccess] Success metrics for ${domain}:`, this.storageData[domain]);
      }
    } else {
      logger.warn(`[KnownSitesManager updateSuccess] Attempted to update success metrics for unknown domain: ${domain}`);
    }
  }

  async deleteConfig(domain) {
    await this._ensureInitialized();
    if (this.storageData.hasOwnProperty(domain)) {
      delete this.storageData[domain];
      await this._saveStorage();
      logger.info(`[KnownSitesManager deleteConfig] Configuration deleted for domain: ${domain}`);
      return true;
    }
    logger.warn(`[KnownSitesManager deleteConfig] Attempted to delete configuration for non-existent domain: ${domain}`);
    return false;
  }

  async getAllConfigs() {
    await this._ensureInitialized();
    logger.debug(`[KnownSitesManager getAllConfigs] Retrieving all configurations. Count: ${Object.keys(this.storageData).length}`);
    return { ...this.storageData }; // Return a copy
  }

  async storeCaptchaCookie(domain, cookieName, cookieValue) {
    if (!domain || !cookieName || !cookieValue) {
        logger.warn('[KnownSitesManager storeCaptchaCookie] Attempted to store invalid CAPTCHA cookie (missing domain, name, or value).');
        return;
    }
    await this._ensureInitialized();
    const config = this.storageData[domain] || { domain_pattern: domain }; // Get existing or create new
    config.captcha_cookie = { name: cookieName, value: cookieValue, timestamp: new Date().toISOString() };
    this.storageData[domain] = config; // Ensure the config is updated/added to storageData
    await this._saveStorage();
    logger.info(`[KnownSitesManager storeCaptchaCookie] CAPTCHA cookie stored for domain: ${domain}. Name: ${cookieName}`);
    if (scraperSettingsInstance && scraperSettingsInstance.debug) {
        logger.debug(`[KnownSitesManager storeCaptchaCookie] Stored cookie for ${domain}:`, config.captcha_cookie);
    }
  }

  async getCaptchaCookie(domain) {
    await this._ensureInitialized();
    const config = this.storageData[domain];
    if (config && config.captcha_cookie && config.captcha_cookie.value) {
      // Optional: Add cookie expiration logic here if needed
      // For now, just return it if it exists
      logger.debug(`[KnownSitesManager getCaptchaCookie] CAPTCHA cookie found for domain: ${domain}. Name: ${config.captcha_cookie.name}`);
      return config.captcha_cookie;
    }
    logger.debug(`[KnownSitesManager getCaptchaCookie] No CAPTCHA cookie found for domain: ${domain}`);
    return null;
  }
}

export { KnownSitesManager };
