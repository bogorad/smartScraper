// config/index.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });


import scraperSettingsDefault from './scraper-settings.js';
import captchaSolverConfigDefault from './captcha-solver-config.js'; // This now correctly imports a default

// Construct llmConfig here from environment variables
const llmConfig = {
  apiKey: process.env.OPENROUTER_API_KEY,
  model: process.env.LLM_MODEL || 'meta-llama/llama-4-maverick:free',
  temperature: process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : 0,
  chatCompletionsEndpoint: process.env.LLM_CHAT_COMPLETIONS_ENDPOINT || 'https://openrouter.ai/api/v1/chat/completions'
};

export {
  scraperSettingsDefault as scraperSettings,
  llmConfig,
  captchaSolverConfigDefault as captchaSolverConfig
};
