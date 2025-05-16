// config/llm-config.js

// Load environment variables if you're using a .env file
// import dotenv from 'dotenv';
// dotenv.config(); // Make sure to call this early in your application entry point

const llmConfig = {
  // Prefer environment variables for sensitive data like API keys
  apiKey: process.env.OPENROUTER_API_KEY || 'YOUR_FALLBACK_OPENROUTER_API_KEY',
  model: process.env.LLM_MODEL || 'openai/gpt-3.5-turbo', // Default model
  chatCompletionsEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
  // Add other LLM related settings, like temperature, max_tokens, if needed
  defaultTemperature: 0.7,
  defaultMaxTokens: 1024, // Max tokens for LLM response (for XPath suggestions)
};

export default llmConfig;
