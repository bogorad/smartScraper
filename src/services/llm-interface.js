// src/services/llm-interface.js
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { LLMError, ConfigurationError } from '../utils/error-handler.js';
import { llmConfig as globalLlmConfig } from '../../config/index.js'; 

class LLMInterface {
  constructor(llmConfig = {}) {
    this.apiKey = llmConfig.apiKey || globalLlmConfig.apiKey;
    this.endpoint = llmConfig.chatCompletionsEndpoint || globalLlmConfig.chatCompletionsEndpoint;
    this.model = llmConfig.model || globalLlmConfig.model;
    this.defaultTemperature = llmConfig.defaultTemperature !== undefined ? llmConfig.defaultTemperature : globalLlmConfig.defaultTemperature;
    this.defaultMaxTokens = llmConfig.defaultMaxTokens || globalLlmConfig.defaultMaxTokens;

    if (!this.apiKey || !this.endpoint || !this.model) {
      throw new ConfigurationError('LLMInterface: Missing required LLM configuration values (apiKey, chatCompletionsEndpoint, model)', {
        apiKeyProvided: !!this.apiKey,
        endpointProvided: !!this.endpoint,
        modelProvided: !!this.model
      });
    }
    
    this.axiosInstance = axios.create({
      baseURL: this.endpoint.substring(0, this.endpoint.lastIndexOf('/')),
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://smartscraper.dev', 
        'X-Title': 'SmartScraper Universal Scraper', 
      },
    });
    logger.info(`LLMInterface initialized for model: ${this.model}`);
  }

  _constructPrompt(htmlContentSummary, snippets, feedbackContext) {
    const maxHtmlLength = 15000; 
    let truncatedHtml = htmlContentSummary;
    if (htmlContentSummary.length > maxHtmlLength) {
      truncatedHtml = htmlContentSummary.substring(0, maxHtmlLength) + "\n... (HTML truncated) ...";
    }

    let prompt = `
Analyze the following HTML content summary and text snippets to identify the main article content.
Provide up to 5 candidate XPath expressions that point to the primary article container.
Return the XPaths as a JSON array of strings. Example: ["//div[@id='main-content']", "//article[contains(@class,'post-body')]"]

HTML Content Summary (first ${maxHtmlLength} chars if truncated):
\`\`\`html
${truncatedHtml}
\`\`\`
`;
    if (snippets && snippets.length > 0) {
      prompt += `
Key Text Snippets from the page:
${snippets.map(s => `- "${s.substring(0, 100)}${s.length > 100 ? '...' : ''}"`).join('\n')}
`;
    }

    if (feedbackContext && feedbackContext.length > 0) {
      prompt += `
Previous XPath attempts and feedback (use this to refine your suggestions):
${feedbackContext.map(f => `- ${f}`).join('\n')}
`;
    }
    prompt += "\nCandidate XPaths (JSON array of strings):";
    return prompt.trim();
  }

  async getCandidateXPaths(htmlContent, snippets, feedbackContext = []) {
    const prompt = this._constructPrompt(htmlContent, snippets, feedbackContext);
    const payload = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: this.defaultTemperature,
      max_tokens: this.defaultMaxTokens,
    };

    logger.info(`Sending request to LLM. Prompt length (approx): ${prompt.length} chars.`);
    try {
      const response = await this.axiosInstance.post(
        this.endpoint.substring(this.endpoint.lastIndexOf('/')), 
        payload,
        { timeout: 45000 } 
      );

      if (response.data && response.data.choices && response.data.choices.length > 0) {
        const messageContent = response.data.choices[0].message?.content;
        if (messageContent) {
          logger.debug(`LLM raw response content: ${messageContent}`);
          try {
            const cleanedContent = messageContent.replace(/^```json\s*|```\s*$/g, '').trim();
            const xpaths = JSON.parse(cleanedContent);
            if (Array.isArray(xpaths) && xpaths.every(item => typeof item === 'string' && item.startsWith('/'))) {
              logger.info(`LLM returned ${xpaths.length} candidate XPaths.`);
              return xpaths.filter((xpath, index, self) => self.indexOf(xpath) === index);
            }
            logger.warn('LLM response content was not a valid JSON array of valid XPath strings:', cleanedContent);
            throw new LLMError('LLM response content was not a valid JSON array of valid XPath strings', { rawContent: cleanedContent });
          } catch (parseError) {
            logger.error(`Failed to parse LLM response as JSON: ${parseError.message}. Raw content: ${messageContent}`);
            const xpathRegex = /(\/\/[a-zA-Z0-9\-_:\*\[\]\(\)@=\.'"\s]+)/g;
            const extracted = messageContent.match(xpathRegex);
            if (extracted && extracted.length > 0) {
              logger.warn(`Fallback: Extracted ${extracted.length} XPaths using regex.`);
              return extracted.filter((xpath, index, self) => self.indexOf(xpath) === index);
            }
            throw new LLMError('Failed to parse LLM response and fallback regex extraction failed.', {
                originalError: parseError.message,
                rawContent: messageContent.substring(0, 500) + (messageContent.length > 500 ? '...' : '')
            });
          }
        }
      }
      logger.warn('LLM response did not contain expected message content or choices.', { responseData: response.data });
      throw new LLMError('LLM response did not contain expected message content or choices', { responseData: response.data });
    } catch (error) {
      if (error instanceof LLMError) throw error; 

      if (error.response) {
        logger.error(`LLM API request failed with status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
        throw new LLMError(`LLM API request failed with status ${error.response.status}`, {
          statusCode: error.response.status,
          responseData: error.response.data,
          originalError: error.message
        });
      } else if (error.request) {
        logger.error(`LLM API request failed: No response received. ${error.message}`);
        throw new LLMError('LLM API request failed: No response received', { originalError: error.message });
      } else {
        logger.error(`Error setting up LLM API request: ${error.message}`);
        throw new LLMError(`Error setting up LLM API request: ${error.message}`, { originalError: error.message });
      }
    }
  }
}

export { LLMInterface };
