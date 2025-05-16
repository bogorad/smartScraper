// src/browser/plugin-manager.js
import path from 'path';
import fs from 'fs/promises'; // To check if plugin paths exist
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';

// ES Module equivalent of __dirname for resolving paths relative to project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRootDir = path.resolve(__dirname, '..', '..'); // Assuming src/browser/ is two levels down from root

class PluginManager {
    constructor(customPluginConfigs = []) {
        // Define default plugins with paths relative to the project root
        this.defaultPluginConfigs = [
            {
                name: 'I-Still-Dont-Care-About-Cookies',
                relativePath: 'plugins/I-Still-Dont-Care-About-Cookies/src', // Path relative to project root
                enabled: true, // You can enable/disable plugins via config
            },
            {
                name: 'Bypass-Paywalls-Chrome-Clean',
                relativePath: 'plugins/bypass-paywalls-chrome-clean-master', // Path relative to project root
                enabled: true,
            },
            // Add more default plugins here
        ];

        // Merge custom configs with defaults, allowing overrides
        this.activePlugins = this.defaultPluginConfigs
            .map(defaultConfig => {
                const customConfig = customPluginConfigs.find(c => c.name === defaultConfig.name);
                return { ...defaultConfig, ...(customConfig || {}) };
            })
            .filter(plugin => plugin.enabled); // Only consider enabled plugins

        logger.info('PluginManager initialized.');
        if (this.activePlugins.length > 0) {
            logger.info('Active plugins:', this.activePlugins.map(p => p.name).join(', '));
        } else {
            logger.info('No active plugins configured.');
        }
    }

    /**
     * Modifies Puppeteer launch options to load enabled unpacked extensions.
     * This is called by PuppeteerController before launching the browser.
     * @param {object} launchOptions - The Puppeteer launch options object.
     */
    async configureLaunchOptions(launchOptions) {
        if (this.activePlugins.length === 0) {
            return; // No plugins to load
        }

        const extensionPathsToLoad = [];
        for (const plugin of this.activePlugins) {
            if (plugin.relativePath) {
                const absolutePath = path.resolve(projectRootDir, plugin.relativePath);
                try {
                    // Check if the path exists and is a directory
                    const stats = await fs.stat(absolutePath);
                    if (stats.isDirectory()) {
                        extensionPathsToLoad.push(absolutePath);
                    } else {
                        logger.warn(`Plugin path for "${plugin.name}" is not a directory: ${absolutePath}`);
                    }
                } catch (error) {
                    logger.warn(`Plugin path for "${plugin.name}" not found or inaccessible: ${absolutePath}. Error: ${error.message}`);
                }
            }
        }

        if (extensionPathsToLoad.length > 0) {
            const existingArgs = launchOptions.args || [];
            // Important: Using string concatenation for these arguments
            const disableExtensionsExceptArg = `--disable-extensions-except=${extensionPathsToLoad.join(',')}`;
            const loadExtensionArg = `--load-extension=${extensionPathsToLoad.join(',')}`;

            launchOptions.args = [
                ...existingArgs.filter(arg => !arg.startsWith('--disable-extensions-except=') && !arg.startsWith('--load-extension=')), // Remove old ones if any
                disableExtensionsExceptArg,
                loadExtensionArg,
            ];
            logger.info(`Configured Puppeteer to load extensions: ${extensionPathsToLoad.join(', ')}`);
        } else {
            logger.info('No valid extension paths found to load.');
        }
    }

    /**
     * Applies actions to a page after navigation.
     * Currently, this is a placeholder for any specific interactions your plugins might need
     * or for generic actions like the GDPR clicker.
     * Most well-behaved extensions should work automatically once loaded.
     * @param {object} page - The Puppeteer page object.
     */
    async applyToPageAfterNavigation(page) {
        logger.debug('PluginManager: applyToPageAfterNavigation called.');

        // The "I Still Don't Care About Cookies" and "Bypass Paywalls" extensions
        // generally work by modifying page content or network requests automatically.
        // Explicit actions here might only be needed for very specific scenarios
        // or for plugins that require manual triggering via content scripts.

        // Example: Generic GDPR clicker (kept from previous version, can be refined or removed)
        // This is independent of the loaded extensions but can be considered a "plugin-like" action.
        try {
            const gdprKeywords = ['accept', 'agree', 'consent', 'got it', 'ok', 'allow all', 'i understand'];
            let clicked = false;
            for (const keyword of gdprKeywords) {
                if (clicked) break;
                const selectors = [
                    `//button[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${keyword}')]`,
                    `//a[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${keyword}')]`,
                    `//div[@role='button' and contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${keyword}')]`
                ];

                for (const selector of selectors) {
                    if (clicked) break;
                    const elementHandles = await page.$x(selector); // Get all matching elements
                    for (const elementHandle of elementHandles) {
                         try {
                            const isVisible = await elementHandle.isIntersectingViewport();
                            if (isVisible) {
                                logger.info(`Attempting to click GDPR element matching keyword: "${keyword}" with selector: ${selector.substring(0, 100)}`);
                                await elementHandle.click({ delay: Math.random() * 100 + 50 });
                                await page.waitForTimeout(750 + Math.random() * 500); // Wait for potential overlay
                                logger.info(`Clicked GDPR element for keyword: "${keyword}"`);
                                clicked = true; // Assume one click is enough
                                break; // Break from inner loop (selectors for this keyword)
                            }
                        } catch(clickError) {
                            logger.warn(`Failed to click element for keyword "${keyword}": ${clickError.message.substring(0,100)}`);
                        } finally {
                            if (elementHandle) await elementHandle.dispose();
                        }
                    }
                }
            }
            if (clicked) {
                logger.info("GDPR interaction attempted.");
            } else {
                logger.debug("No GDPR elements found/clicked based on keywords.");
            }
        } catch (error) {
            logger.warn(`Error during generic GDPR click attempt: ${error.message}`);
        }
    }
}

export { PluginManager };
