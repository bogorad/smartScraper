// src/browser/plugin-manager.ts
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import { logger } from '../utils/logger.js';
import { PuppeteerLaunchOptions, Page } from 'puppeteer'; // Corrected import for LaunchOptions

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PLUGINS_DIR = path.resolve(__dirname, '..', '..', 'plugins');

export interface PluginConfig {
  name: string;
  path?: string;
  plugin?: any;
  enabled: boolean;
  args?: string[];
  applyAfterNavigation?: (page: Page) => Promise<void>;
}

class PluginManager {
  private plugins: PluginConfig[];

  constructor(customPluginPaths: string[] = []) {
    this.plugins = this._loadPlugins(customPluginPaths);
    if (logger.isDebugging()) {
        logger.debug(`[PluginManager constructor] Loaded ${this.plugins.length} plugins.`);
        this.plugins.forEach(p => logger.debug(`  - Plugin: ${p.name}, Path: ${p.path || 'N/A (built-in)'}`));
    }
  }

  private _loadPlugins(customPluginPaths: string[]): PluginConfig[] {
    const loadedPlugins: PluginConfig[] = [];
    const defaultPluginConfigs = this._useDefaultPlugins();
    let allPluginConfigs: PluginConfig[] = [...defaultPluginConfigs];

    if (Array.isArray(customPluginPaths)) {
      customPluginPaths.forEach(customPath => {
        if (typeof customPath === 'string' && customPath.trim() !== '') {
          allPluginConfigs.push({
            name: path.basename(customPath, '.js'),
            path: customPath,
            enabled: true,
          });
        }
      });
    }

    allPluginConfigs.forEach(pluginConfig => {
      if (pluginConfig.enabled) {
        if (pluginConfig.plugin) {
          loadedPlugins.push(pluginConfig);
        } else if (pluginConfig.path) {
          loadedPlugins.push({
            ...pluginConfig,
            name: pluginConfig.name || path.basename(pluginConfig.path)
          });
        }
      }
    });
    return loadedPlugins;
  }

  private _useDefaultPlugins(customPluginConfigs: PluginConfig[] = []): PluginConfig[] {
    const defaultPlugins: PluginConfig[] = [
      { name: 'adblocker', plugin: AdblockerPlugin({ blockTrackers: true }), enabled: true, args: [] },
    ];
    return defaultPlugins.filter(dp => !customPluginConfigs.some(cp => cp.name === dp.name));
  }

  async configureLaunchOptions(launchOptions: PuppeteerLaunchOptions): Promise<void> {
    if (logger.isDebugging()) {
        logger.debug('[PluginManager configureLaunchOptions] Original launchOptions.args:', launchOptions.args);
    }
    const extensionPathsToLoad: string[] = [];
    launchOptions.args = launchOptions.args || []; 

    for (const plugin of this.plugins) {
      if (plugin.enabled && plugin.path) {
        try {
            const absolutePath = path.isAbsolute(plugin.path) ? plugin.path : path.resolve(plugin.path);
            const stats = await fs.stat(absolutePath);
            if (stats.isDirectory() || stats.isFile()) {
                extensionPathsToLoad.push(absolutePath);
            } else {
                logger.warn(`Plugin path for "${plugin.name}" (Path: ${absolutePath}) is not a file or directory. Skipping.`);
            }
        } catch (error: any) {
            logger.warn(`Plugin path for "${plugin.name}" (Path: ${plugin.path}) not found or inaccessible. Error: ${error.message}`);
            if (logger.isDebugging()) {
                logger.debug(`[DEBUG_MODE] Full error for plugin path ${plugin.path}:`, error);
            }
        }
      }
      if (plugin.enabled && plugin.args && plugin.path) {
        const absolutePath = path.isAbsolute(plugin.path) ? plugin.path : path.resolve(plugin.path);
        (launchOptions.args as string[]).push(...plugin.args.map(arg => `${arg}=${absolutePath}`));
      } else if (plugin.enabled && plugin.args && !plugin.path) {
        (launchOptions.args as string[]).push(...plugin.args);
      }
    }

    if (extensionPathsToLoad.length > 0) {
      const loadExtensionArg = `--load-extension=${extensionPathsToLoad.join(',')}`;
      launchOptions.args = (launchOptions.args as string[]).filter((arg: string) => 
        !arg.startsWith('--load-extension=') &&
        !arg.startsWith('--disable-extensions-except=')
      );
      (launchOptions.args as string[]).push(loadExtensionArg);
      if (logger.isDebugging()) {
        logger.debug(`[PluginManager configureLaunchOptions] Added --load-extension: ${loadExtensionArg}`);
      }
    }
    if (logger.isDebugging()) {
        logger.debug('[PluginManager configureLaunchOptions] Modified launchOptions.args:', launchOptions.args);
    }
  }

  async applyToPageAfterNavigation(page: Page): Promise<void> {
    if (logger.isDebugging()) {
        logger.debug('[PluginManager applyToPageAfterNavigation] Called, but internal logic is disabled by user request.');
    }
    // All internal logic is commented out or removed to disable it.
    // Your custom browser extension should handle these interactions.

    /*
    // Original logic (now disabled):
    for (const plugin of this.plugins) {
      if (plugin.enabled && typeof plugin.applyAfterNavigation === 'function') {
        try {
          await plugin.applyAfterNavigation(page);
        } catch (error: any) {
          logger.warn(`Error applying post-navigation action for plugin ${plugin.name}: ${error.message}`);
        }
      }
    }
    
    const gdprSelectors = [
        'button[id*="consent"]', 'button[class*="consent"]',
        'button[id*="accept"]', 'button[class*="accept"]',
        'div[role="dialog"] button:first-of-type'
    ];
    for (const selector of gdprSelectors) {
        try {
            const element = await page.$(selector);
            if (element) {
                logger.info(`[PluginManager] Found potential GDPR accept button with selector: ${selector}. Attempting click.`);
                await element.click();
                await new Promise(resolve => setTimeout(resolve, 500)); 
                break; 
            }
        } catch (error: any) {
            logger.warn(`Error during generic GDPR click attempt: ${error.message}`);
        }
    }
    */
    return Promise.resolve(); // Explicitly return a resolved promise
  }
}

export { PluginManager };
