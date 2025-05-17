// src/browser/plugin-manager.js
import path from 'path';
import fs from 'fs/promises'; // To check if plugin paths exist
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { ConfigurationError, NetworkError } from '../utils/error-handler.js';

// ES Module equivalent of __dirname for resolving paths relative to project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRootDir = path.resolve(__dirname, '..', '..'); // Assuming src/browser/ is two levels down from root

class PluginManager {
  constructor(customPluginConfigs = []) {
    // Define default plugins with paths relative to the project root
    // These can serve as fallbacks if EXTENSION_PATHS is not set or if paths there are invalid
    this.defaultPlugins = [
      {
        name: 'I Still Dont Care About Cookies',
        relativePath: 'plugins/I-Still-Dont-Care-About-Cookies/src', // Path relative to project root
        enabled: true,
        isAbsolutePath: false,
      },
      {
        name: 'Bypass Paywalls Chrome Clean',
        relativePath: 'plugins/bypass-paywalls-chrome-clean-master', // Path relative to project root
        enabled: true,
        isAbsolutePath: false,
      },
      // Add more default plugins here
    ];

    this.activePlugins = [];
    const extensionPathsEnv = process.env.EXTENSION_PATHS;

    if (extensionPathsEnv) {
      const paths = extensionPathsEnv.split(',').map(p => p.trim()).filter(p => p); // Trim and filter empty paths
      if (paths.length > 0) {
        this.activePlugins = paths.map(p_str => {
          // Basic name derivation, can be improved
          const name = p_str.substring(p_str.lastIndexOf(path.sep) + 1) || `env_ext_${Date.now()}`;
          return {
            name: name,
            relativePath: p_str, // For EXTENSION_PATHS, this is treated as an absolute or directly resolvable path
            isAbsolutePath: true, // Flag to indicate it's from env and likely absolute
            enabled: true
          };
        });
        logger.info(`PluginManager: Loaded ${this.activePlugins.length} extensions from EXTENSION_PATHS environment variable: ${paths.join(', ')}`);
      } else {
         logger.warn('PluginManager: EXTENSION_PATHS was set but no valid paths were parsed. Check formatting. Falling back to defaults.');
         this._useDefaultPlugins(customPluginConfigs);
      }
    } else {
      logger.info('PluginManager: EXTENSION_PATHS not set. Using default/custom plugin configurations.');
      this._useDefaultPlugins(customPluginConfigs);
    }
    
    if (this.activePlugins.length > 0) {
      logger.info('PluginManager initialized.');
      logger.info('Active plugins:', this.activePlugins.map(p => `${p.name} (Path: ${p.relativePath})`).join('; '));
    } else {
      logger.info('PluginManager initialized with no active plugins configured.');
    }
  }

  _useDefaultPlugins(customPluginConfigs = []) {
     this.activePlugins = this.defaultPlugins
        .map(defaultConfig => {
          const customConfig = customPluginConfigs.find(c => c.name === defaultConfig.name);
          return { ...defaultConfig, ...(customConfig || {}) };
        })
        .filter(plugin => plugin.enabled);
  }

  async configureLaunchOptions(launchOptions) {
    if (!this.activePlugins || this.activePlugins.length === 0) {
      logger.info('No active plugins to load.');
      return;
    }

    const extensionPathsToLoad = [];
    for (const plugin of this.activePlugins) {
      if (!plugin.relativePath) {
        logger.warn(`Plugin "${plugin.name}" is missing 'relativePath'. Skipping.`);
        continue;
      }

      let absolutePath = plugin.relativePath;
      if (!plugin.isAbsolutePath) { // If from default config, resolve relative to project root
        absolutePath = path.resolve(projectRootDir, plugin.relativePath);
      }
      // For paths from EXTENSION_PATHS, we assume they are absolute or resolvable as is.

      try {
        const stats = await fs.stat(absolutePath);
        if (stats.isDirectory()) {
          extensionPathsToLoad.push(absolutePath);
        } else {
          logger.warn(`Plugin path for "${plugin.name}" (Path: ${absolutePath}) is not a directory.`);
        }
      } catch (error) {
        logger.warn(`Plugin path for "${plugin.name}" (Path: ${absolutePath}) not found or inaccessible. Error: ${error.message}`);
        // If a path from EXTENSION_PATHS is invalid, we log a warning and skip it.
        // If it's critical, an error could be thrown here.
        // if (plugin.isAbsolutePath) {
        //   throw new ConfigurationError(`Invalid extension path from EXTENSION_PATHS: ${absolutePath}`, {
        //     pluginName: plugin.name, path: absolutePath, originalError: error.message
        //   });
        // }
      }
    }

    if (extensionPathsToLoad.length > 0) {
      const disableExtensionsExceptArg = `--disable-extensions-except=${extensionPathsToLoad.join(',')}`;
      const loadExtensionArg = `--load-extension=${extensionPathsToLoad.join(',')}`;

      const existingArgs = launchOptions.args || [];
      launchOptions.args = [
        ...existingArgs.filter(arg => !arg.startsWith('--disable-extensions-except=') && !arg.startsWith('--load-extension=')),
        disableExtensionsExceptArg,
        loadExtensionArg,
      ];
      logger.info(`Configured Puppeteer to load extensions: ${extensionPathsToLoad.join(', ')}`);
    } else {
      logger.info('No valid extension paths found to load from EXTENSION_PATHS or defaults.');
    }
  }

  async applyToPageAfterNavigation(page) {
    logger.debug('PluginManager: applyToPageAfterNavigation called.');
    // Generic GDPR clicker logic (can be expanded or made configurable)
    const gdprKeywords = ['accept', 'agree', 'consent', 'got it', 'allow all', 'ok', 'continue', 'i understand'];
    const gdprSelectors = [
      "//button[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '{keyword}')]",
      "//a[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '{keyword}')]",
      "//*[contains(@id, 'cookie') or contains(@class, 'cookie') or contains(@id, 'gdpr') or contains(@class, 'gdpr') or contains(@id, 'consent') or contains(@class, 'consent')]//button[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '{keyword}')]",
      "//*[contains(@id, 'cookie') or contains(@class, 'cookie') or contains(@id, 'gdpr') or contains(@class, 'gdpr') or contains(@id, 'consent') or contains(@class, 'consent')]//a[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '{keyword}')]",
      "//div[contains(@role, 'dialog')]//button[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '{keyword}')]"
    ];
    let clicked = false;

    try {
      for (const keyword of gdprKeywords) {
        if (clicked) break;
        for (const selectorTemplate of gdprSelectors) {
          if (clicked) break;
          const selector = selectorTemplate.replace('{keyword}', keyword);
          const elementHandles = await page.$x(selector);

          for (const elementHandle of elementHandles) {
            try {
              const isVisible = await elementHandle.isIntersectingViewport();
              if (isVisible) {
                logger.info(`Attempting to click GDPR element matching keyword: "${keyword}" with selector: ${selector.substring(0, 100)}`);
                await elementHandle.click({ delay: Math.random() * 100 + 50 });
                await page.waitForTimeout(750 + Math.random() * 500); // Wait for potential overlay/page reaction
                logger.info(`Clicked GDPR element for keyword: "${keyword}"`);
                clicked = true;
                break; 
              }
            } catch (clickError) {
              logger.warn(`Failed to click element for keyword "${keyword}" with selector ${selector.substring(0,100)}: ${clickError.message.substring(0,100)}`);
            } finally {
              if (elementHandle) await elementHandle.dispose();
            }
          }
        }
      }
      if (clicked) {
        logger.info("GDPR interaction attempted and an element was clicked.");
      } else {
        logger.debug("No GDPR elements found/clicked based on keywords.");
      }
    } catch (error) {
      logger.warn(`Error during generic GDPR click attempt: ${error.message}`);
      // Don't throw, as this is a best-effort enhancement.
      // Log it as a NetworkError for consistency if needed for broader error tracking.
      const networkError = new NetworkError('Error during generic GDPR click attempt', {
        url: await page.url().catch(() => 'unknown_url'), // page.url() might fail if page is closed/crashed
        originalError: error.message
      });
      logger.debug(`NetworkError details during GDPR click: ${JSON.stringify(networkError.details)}`);
    }
  }
}

export { PluginManager };
