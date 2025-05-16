// src/storage/known-sites-manager.js

import fs from 'fs/promises'; // Using promises API for async file operations
import path from 'path';
import { logger } from '../utils/logger.js'; // Assuming a logger utility
import { fileURLToPath } from 'url'; // To handle __dirname in ES modules
import { ConfigurationError } from '../utils/error-handler.js';

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class KnownSitesManager {
    constructor(storagePath = null) {
        // Default storage path relative to this file's directory, then up to project root, then data/
        this.storageFilePath = storagePath || path.resolve(__dirname, '..', '..', 'data', 'known_sites_storage.json');
        this.storageData = {}; // In-memory cache of the storage data
        this.isInitialized = false;
        this._initPromise = this._initialize(); // Store the promise for initial load

        // Add a lock mechanism to prevent race conditions
        this._writeLock = Promise.resolve(); // Initially resolved promise (no lock)
    }

    async _initialize() {
        if (this.isInitialized) return;
        try {
            await fs.mkdir(path.dirname(this.storageFilePath), { recursive: true }); // Ensure directory exists
            const fileExists = await fs.access(this.storageFilePath).then(() => true).catch(() => false);
            if (fileExists) {
                const fileContent = await fs.readFile(this.storageFilePath, 'utf-8');
                this.storageData = JSON.parse(fileContent);
                logger.info(`Known sites storage loaded successfully from: ${this.storageFilePath}`);
            } else {
                this.storageData = {};
                await this._saveStorage(); // Create the file if it doesn't exist
                logger.info(`Known sites storage file not found. Created new empty storage at: ${this.storageFilePath}`);
            }
            this.isInitialized = true;
        } catch (error) {
            logger.error(`Failed to initialize or load known sites storage: ${error.message}`);
            // In case of read/parse error, start with an empty object to prevent app crash
            this.storageData = {};
            // Optionally, re-throw or handle more gracefully depending on requirements
        }
    }

    async _ensureInitialized() {
        if (!this.isInitialized) {
            await this._initPromise; // Wait for the initial load to complete
        }
    }

    /**
     * Acquires a write lock to prevent concurrent writes to the storage file.
     * @returns {Promise<Function>} A release function that must be called to release the lock.
     * @private
     */
    async _acquireWriteLock() {
        // Create a new promise that will be resolved when the lock is released
        let releaseLock;
        const newLockPromise = new Promise(resolve => {
            releaseLock = resolve;
        });

        // Wait for the current lock to be released
        const previousLock = this._writeLock;
        this._writeLock = newLockPromise;

        // Wait for any previous operations to complete
        await previousLock;

        // Return the release function
        return releaseLock;
    }

    /**
     * Saves the in-memory storage data to the file system.
     * Uses a write lock to prevent race conditions.
     * @private
     */
    async _saveStorage() {
        await this._ensureInitialized(); // Should already be initialized, but good practice

        // Acquire a write lock
        const releaseLock = await this._acquireWriteLock();

        try {
            const jsonData = JSON.stringify(this.storageData, null, 2); // Pretty print JSON
            await fs.writeFile(this.storageFilePath, jsonData, 'utf-8');
            logger.debug('Known sites storage saved successfully.');
        } catch (error) {
            logger.error(`Failed to save known sites storage: ${error.message}`);
            throw new ConfigurationError('Failed to save known sites storage', {
                path: this.storageFilePath,
                error: error.message
            }, error);
        } finally {
            // Always release the lock, even if an error occurred
            releaseLock();
        }
    }

    /**
     * Retrieves the configuration for a given domain.
     * @param {string} domain - The domain key (e.g., "example.com").
     * @returns {Promise<object|null>} The site configuration object or null if not found.
     */
    async getConfig(domain) {
        await this._ensureInitialized();
        if (this.storageData.hasOwnProperty(domain)) {
            logger.debug(`Config found for domain: ${domain}`);
            return { ...this.storageData[domain] }; // Return a copy to prevent direct modification
        }
        logger.debug(`No config found for domain: ${domain}`);
        return null;
    }

    /**
     * Saves or updates the configuration for a given domain.
     * @param {string} domain - The domain key.
     * @param {object} config - The configuration object to save.
     */
    async saveConfig(domain, config) {
        await this._ensureInitialized();
        if (!domain || typeof config !== 'object' || config === null) {
            logger.warn('Attempted to save invalid config or domain.');
            return;
        }
        this.storageData[domain] = { ...config, domain_pattern: domain }; // Ensure domain_pattern is consistent
        logger.info(`Configuration saved/updated for domain: ${domain}`);
        await this._saveStorage();
    }

    /**
     * Increments the failure count for a given domain.
     * @param {string} domain - The domain key.
     */
    async incrementFailure(domain) {
        await this._ensureInitialized();
        if (this.storageData.hasOwnProperty(domain)) {
            this.storageData[domain].failure_count_since_last_success = (this.storageData[domain].failure_count_since_last_success || 0) + 1;
            logger.info(`Incremented failure count for ${domain} to ${this.storageData[domain].failure_count_since_last_success}`);
            await this._saveStorage();
        } else {
            logger.warn(`Attempted to increment failure count for unknown domain: ${domain}`);
        }
    }

    /**
     * Updates the success metrics for a given domain (resets failure count, updates timestamp).
     * @param {string} domain - The domain key.
     */
    async updateSuccess(domain) {
        await this._ensureInitialized();
        if (this.storageData.hasOwnProperty(domain)) {
            this.storageData[domain].failure_count_since_last_success = 0;
            this.storageData[domain].last_successful_scrape_timestamp = new Date().toISOString();
            logger.info(`Updated success metrics for ${domain}.`);
            await this._saveStorage();
        } else {
            logger.warn(`Attempted to update success metrics for unknown domain: ${domain}`);
            // Potentially, if a scrape succeeds for a "new" site (though saveConfig should handle this first),
            // this could be an entry point to create a basic record. However, saveConfig is more explicit.
        }
    }

    /**
     * Deletes the configuration for a given domain.
     * @param {string} domain - The domain key.
     * @returns {Promise<boolean>} True if deletion was successful, false otherwise.
     */
    async deleteConfig(domain) {
        await this._ensureInitialized();
        if (this.storageData.hasOwnProperty(domain)) {
            delete this.storageData[domain];
            logger.info(`Configuration deleted for domain: ${domain}`);
            await this._saveStorage();
            return true;
        }
        logger.warn(`Attempted to delete configuration for non-existent domain: ${domain}`);
        return false;
    }

    /**
     * Retrieves all stored configurations.
     * @returns {Promise<object>} A copy of all stored configurations.
     */
    async getAllConfigs() {
        await this._ensureInitialized();
        return { ...this.storageData }; // Return a copy
    }
}

export { KnownSitesManager };
