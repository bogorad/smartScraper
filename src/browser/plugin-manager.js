// src/browser/plugin-manager.js
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import { logger } from '../utils/logger.js';
// Corrected import for a default export:
import scraperSettingsInstance from '../../config/scraper-settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PLUGINS_DIR = path.resolve(__dirname, '..', '..', 'plugins');

class PluginManager {
  constructor(customPluginPaths = []) {
    this.plugins = this._loadPlugins(customPluginPaths);
    if (scraperSettingsInstance && scraperSettingsInstance.debug) {
        logger.debug(`[PluginManager constructor] Loaded ${this.plugins.length} plugins.`);
        this.plugins.forEach(p => logger.debug(`  - Plugin: ${p.name}, Path: ${p.path || 'N/A (built-in)'}`));
    }
  }

  _loadPlugins(customPluginPaths) {
    const loadedPlugins = [];
    const defaultPluginConfigs = this._useDefaultPlugins();

    const allPluginConfigs = [...defaultPluginConfigs];

    if (Array.isArray(customPluginPaths)) {
      customPluginPaths.forEach(customPath => {
        if (typeof customPath === 'string' && customPath.trim() !== '') {
          allPluginConfigs.push({
            name: path.basename(customPath, '.js'), 
            path: customPath, 
            enabled: true, 
            args: []
          });
        }
      });
    }

    allPluginConfigs.forEach(pluginConfig => {
      if (pluginConfig.enabled) {
        if (pluginConfig.plugin) { 
          loadedPlugins.push(pluginConfig.plugin);
        } else if (pluginConfig.path) { 
          loadedPlugins.push({
            name: pluginConfig.name,
            path: pluginConfig.path, 
            args: pluginConfig.args || []
          });
        }
      }
    });
    return loadedPlugins;
  }

  _useDefaultPlugins(customPluginConfigs = []) {
    const defaultPlugins = [
      { name: 'adblocker', plugin: AdblockerPlugin({ blockTrackers: true }), enabled: true, args: [] },
    ];
    return defaultPlugins;
  }


  async configureLaunchOptions(launchOptions) {
    if (scraperSettingsInstance && scraperSettingsInstance.debug) {
        logger.debug('[PluginManager configureLaunchOptions] Original launchOptions.args:', launchOptions.args);
    }
    const extensionPathsToLoad = [];

    for (const plugin of this.plugins) {
      if (plugin.path) { 
        const absolutePath = path.isAbsolute(plugin.path) ? plugin.path : path.resolve(plugin.path);
        try {
          const stats = await fs.stat(absolutePath);
          if (stats.isDirectory() || stats.isFile()) { 
            extensionPathsToLoad.push(absolutePath);
            if (plugin.args && plugin.args.length > 0) {
              launchOptions.args.push(...plugin.args.map(arg => `${arg}=${absolutePath}`)); 
            }
          } else {
            logger.warn(`Plugin path for "${plugin.name}" (Path: ${absolutePath}) is not a file or directory. Skipping.`);
          }
        } catch (error) {
          logger.warn(`Plugin path for "${plugin.name}" (Path: ${absolutePath}) not found or inaccessible. Error: ${error.message}`);
          if (scraperSettingsInstance && scraperSettingsInstance.debug) {
            logger.debug(`[DEBUG_MODE] Full error for plugin path ${absolutePath}:`, error);
          }
        }
      }
    }

    if (extensionPathsToLoad.length > 0) {
      const loadExtensionArg = `--load-extension=${extensionPathsToLoad.join(',')}`;
      
      launchOptions.args = launchOptions.args.filter(arg => 
        !arg.startsWith('--load-extension=') && 
        !arg.startsWith('--disable-extensions-except=')
      );
      
      launchOptions.args.push(loadExtensionArg);
      if (scraperSettingsInstance && scraperSettingsInstance.debug) {
        logger.debug(`[PluginManager configureLaunchOptions] Added --load-extension: ${loadExtensionArg}`);
      }
    }
    if (scraperSettingsInstance && scraperSettingsInstance.debug) {
        logger.debug('[PluginManager configureLaunchOptions] Modified launchOptions.args:', launchOptions.args);
    }
    return launchOptions;
  }

  async applyToPageAfterNavigation(page) {
    if (scraperSettingsInstance && scraperSettingsInstance.debug) {
        logger.debug('[PluginManager applyToPageAfterNavigation] Applying post-navigation actions.');
    }
    try {
      const commonAcceptSelectors = [
        'button[id*="accept"]', 'button[class*="accept"]',
        'button[id*="consent"]', 'button[class*="consent"]',
        'button[aria-label*="Accept"]', 'button[aria-label*="Consent"]',
        'a[id*="accept"]', 'a[class*="accept"]',
      ];

      for (const selector of commonAcceptSelectors) {
        const element = await page.$(selector);
        if (element) {
          logger.info(`[PluginManager] Found potential GDPR accept button with selector: ${selector}. Attempting click.`);
          await element.click();
          await page.waitForTimeout(500); 
          break; 
        }
      }
    } catch (error) {
      logger.warn(`Error during generic GDPR click attempt: ${error.message}`);
    }
  }
}

export { PluginManager };
