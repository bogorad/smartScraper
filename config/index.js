// config/index.js
// This file serves as a central point for exporting all configurations.

// Import individual configuration modules
import { llmConfig } from './llm-config.js';
import { scraperSettings } from './scraper-settings.js';
import { captchaSolverConfig } from './captcha-solver-config.js';
// You can add more specific config imports here if needed

// Combine all configurations into a single object or export them individually

// Option 1: Exporting a single combined object (useful if you want to pass all configs around easily)
// const allConfigs = {
//   llm: llmConfig,
//   scraper: scraperSettings,
//   captchaSolver: captchaSolverConfig,
//   // Add other top-level config groups here
// };

// Option 2: Exporting individual config objects (more common and often preferred for clarity)
// This is generally the recommended approach for ES modules.
export {
  llmConfig,
  scraperSettings,
  captchaSolverConfig,
};
// Export other config objects directly if you add more

// You could also choose to export the combined object if that fits your style:
// export default allConfigs;
// However, named exports (as above) are usually more flexible for consumers.
