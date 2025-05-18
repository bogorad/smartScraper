// config/index.ts
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Import the actual settings and their types/interfaces
import scraperSettingsDefault, { 
    ScraperSettings as ScraperSettingsInterfaceFromModule, // Alias the imported interface
    ScoreWeights as ScoreWeightsInterfaceFromModule       // Alias the imported interface
} from './scraper-settings.js';
import captchaSolverConfigDefault, { 
    CaptchaSolverConfig as CaptchaConfigInterfaceFromModule // Alias the imported interface
} from './captcha-solver-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// Define local interface for LLMConfig if not already defined elsewhere and exported
export interface LLMConfig {
  apiKey?: string;
  chatCompletionsEndpoint: string;
  model: string;
  temperature: number;
}

// Construct llmConfig here from environment variables
const llmConfig: LLMConfig = {
  apiKey: process.env.OPENROUTER_API_KEY,
  chatCompletionsEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
  model: process.env.LLM_MODEL || 'meta-llama/llama-4-maverick:free',
  temperature: process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : 0,
};

// Instances of configurations
const scraperSettings: ScraperSettingsInterfaceFromModule = scraperSettingsDefault;
const captchaSolverConfig: CaptchaConfigInterfaceFromModule = captchaSolverConfigDefault;

// Explicitly re-export the INTERFACE types with the desired names for external use
export type ScraperSettings = ScraperSettingsInterfaceFromModule;
export type ScoreWeights = ScoreWeightsInterfaceFromModule;
export type CaptchaSolverConfig = CaptchaConfigInterfaceFromModule;

// Export the INSTANCES of configurations
export {
  scraperSettings,    // This is the instance
  llmConfig,          // This is the instance
  captchaSolverConfig // This is the instance
};
