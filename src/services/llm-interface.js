// src/services/llm-interface.js
// REMOVED incorrect and unused import of scraperSettings
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { LLMError, ConfigurationError } from '../utils/error-handler.js';

class LLMInterface {
  constructor(llmConfig) { 
    if (!llmConfig || !llmConfig.apiKey || !llmConfig.chatCompletionsEndpoint || !llmConfig.model) {
      throw new ConfigurationError('LLMInterface: Missing required LLM configuration values (apiKey, chatCompletionsEndpoint, model)', {
        missing: Object.entries({
          apiKey: llmConfig?.apiKey,
          chatCompletionsEndpoint: llmConfig?.chatCompletionsEndpoint,
          model: llmConfig?.model
        }).filter(([, v]) => !v).map(([k]) => k)
      });
    }
    this.apiKey = llmConfig.apiKey;
    this.endpoint = llmConfig.chatCompletionsEndpoint; 
    this.model = llmConfig.model;
    this.temperature = llmConfig.temperature !== undefined ? llmConfig.temperature : 0;

    this.axiosInstance = axios.create({
      baseURL: this.endpoint.substring(0, this.endpoint.lastIndexOf('/')), 
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000', 
        'X-Title': 'SmartScraper LLM Call',  
      }
    });
    logger.info(`LLMInterface initialized for model: ${this.model}, Temperature: ${this.temperature}`);
  }

  _constructPrompt(simplifiedDomStructure, snippets, feedbackContext) {
    const maxDomLength = 100000; 
    let truncatedDom = simplifiedDomStructure;
    if (simplifiedDomStructure.length > maxDomLength) {
      truncatedDom = simplifiedDomStructure.substring(0, maxDomLength) + "\n... (Simplified DOM truncated) ...";
      logger.warn(`Simplified DOM structure was truncated to ${maxDomLength} chars for LLM prompt.`);
    }

    let prompt = \`You are an expert XPath generator. Based on the following simplified HTML DOM structure, relevant text snippets, and feedback from previous attempts, identify the best XPath expression to extract the main article content.
The HTML provided has been simplified: long text nodes are truncated, and some irrelevant tags (scripts, styles, etc.) are removed. Annotations like 'data-original-text-length' and 'data-paragraph-count' might be present on elements to give you clues about their original content density.

HTML Structure:
\`\`\`html
\${truncatedDom}
\`\`\`

Relevant Text Snippets from the page (these are good indicators of the main content):
\`;

    if (snippets && snippets.length > 0) {
      prompt += snippets.map(s => \`- "\${s.substring(0, 100)}\${s.length > 100 ? '...' : ''}"\`).join('\n');
    } else {
      prompt += "- (No specific text snippets provided, rely on DOM structure and common patterns.)";
    }

    prompt += \`\n\nCommon patterns for main content often involve tags like 'article', 'main', or divs with IDs/classes like 'content', 'main-content', 'story-body', 'article-body', 'entry-content', 'post-content'. Prioritize these but be flexible. The content is usually text-heavy with multiple paragraphs ('<p>' tags). Avoid selecting headers, footers, navigation bars, sidebars, comment sections, or ad containers. Pay attention to 'data-original-text-length' and 'data-paragraph-count' attributes if present, as higher values often indicate main content areas.

Previous attempts and feedback (if any):
\`;

    if (feedbackContext && feedbackContext.length > 0) {
      feedbackContext.forEach(item => {
        const sanitizedResult = (typeof item === 'string' ? item : item.result || item.message || JSON.stringify(item))
                                .replace(/"/g, "'").substring(0, 150); 
        prompt += \`- Attempted XPath: \${item.xpath || 'N/A'}, Result/Feedback: \${sanitizedResult}...\n\`;
      });
    } else {
      prompt += "- No previous attempts or feedback.\n";
    }

    prompt += \`
Return ONLY a JSON array of strings, where each string is a candidate XPath expression. For example: ["//article", "//div[@id='main-content']"]
Do not include any other text, explanations, or markdown formatting outside the JSON array.
Generate up to 5 diverse and plausible candidate XPaths. Aim for specificity to avoid overly broad matches.
Consider XPaths that are robust to minor site structure changes.
If the HTML contains elements with attributes like 'data-content-score' or 'data-is-content-block', pay attention to them.\`;

    return prompt.trim();
  }

  async getCandidateXPaths(simplifiedDom, snippets, feedbackContext = []) {
    const prompt = this._constructPrompt(simplifiedDom, snippets, feedbackContext);
    const requestBody = {
      model: this.model,
      messages: [
        { role: "system", content: "You are an expert XPath generator. Output ONLY the JSON array of XPath strings." },
        { role: "user", content: prompt }
      ],
      temperature: this.temperature,
    };

    logger.info(\`Sending request to LLM. Prompt length (approx): \${prompt.length} chars. Simplified DOM length: \${simplifiedDom.length} chars.\`);
    
    const promptSnippet = prompt.length > 1000 ? prompt.substring(0, 500) + "..." + prompt.substring(prompt.length - 500) : prompt;
    logger.debug('[DEBUG_MODE] LLM Request Body (prompt snippet):', { ...requestBody, messages: [{...requestBody.messages[0]}, {...requestBody.messages[1], content: promptSnippet}] });

    try {
      const response = await this.axiosInstance.post(
        this.endpoint.substring(this.endpoint.lastIndexOf('/')), 
        requestBody,
        { timeout: 60000 } 
      );

      if (!response.data || !response.data.choices || response.data.choices.length === 0) {
        logger.warn('LLM response missing choices or data.', { responseData: response.data });
        throw new LLMError('LLM response missing choices', { responseData: response.data });
      }

      const messageContent = response.data.choices[0].message?.content;
      if (!messageContent) {
        logger.warn('LLM response choice missing content.', { responseData: response.data });
        throw new LLMError('LLM response choice missing content', { responseData: response.data });
      }
      
      logger.debug(\`[DEBUG_MODE] LLM raw response content (first 500 chars): \${messageContent.substring(0, 500)}...\`);

      const codeBlockMatch = messageContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      let jsonStringToParse = messageContent.trim();

      if (codeBlockMatch && codeBlockMatch[1]) {
        jsonStringToParse = codeBlockMatch[1].trim();
        logger.debug('[LLMInterface getCandidateXPaths] Extracted JSON from markdown code block.');
      } else {
         const arrayMatch = jsonStringToParse.match(/^(\[[\s\S]*\])$/);
         if (arrayMatch && arrayMatch[1]) {
             jsonStringToParse = arrayMatch[1];
             logger.debug('[LLMInterface getCandidateXPaths] Found JSON array pattern in response.');
         }
      }
      
      let xpaths = [];
      try {
        xpaths = JSON.parse(jsonStringToParse);
        if (Array.isArray(xpaths) && xpaths.every(item => typeof item === 'string' && item.trim().startsWith('/'))) {
          const uniqueXPaths = [...new Set(xpaths.map(xp => xp.trim()).filter(xp => xp))];
          logger.info(\`LLM successfully returned \${uniqueXPaths.length} unique candidate XPaths.\`);
          logger.debug(\`[DEBUG_MODE] Parsed XPaths:\`, uniqueXPaths);
          return uniqueXPaths;
        } else {
          logger.warn('LLM response content was not a valid JSON array of XPath strings:', jsonStringToParse);
          throw new LLMError('LLM response content was not a valid JSON array of XPath strings', { rawContent: jsonStringToParse });
        }
      } catch (parseError) {
        logger.error(\`Failed to parse LLM response as JSON: \${parseError.message}. Raw content (first 500 chars): \${messageContent.substring(0,500)}...\`);
        logger.error(\`[DEBUG_MODE] Full error during LLM JSON parse:\`, parseError);
        
        const xpathRegex = /(\/\/[^"\s\[\]]+(?:\[[^\]]+\])*)/g; 
        const extracted = messageContent.match(xpathRegex);
        if (extracted && extracted.length > 0) {
            const uniqueExtracted = [...new Set(extracted.map(xp => xp.trim()).filter(xp => xp))];
            logger.warn(\`Fallback: Extracted \${uniqueExtracted.length} XPaths using regex due to JSON parse error.\`);
            logger.debug(\`[DEBUG_MODE] Regex extracted XPaths:\`, uniqueExtracted);
            return uniqueExtracted;
        }
        throw new LLMError('Failed to parse LLM response and fallback regex extraction failed.', {
            originalError: parseError.message,
            rawContent: messageContent.substring(0, 500) + (messageContent.length > 500 ? '...' : '')
        });
      }
    } catch (error) {
      if (error instanceof LLMError) throw error; 

      logger.error(\`[DEBUG_MODE] Full error during getCandidateXPaths:\`, error);
      
      if (error.response) {
        logger.error(\`LLM API request failed with status \${error.response.status}: \${JSON.stringify(error.response.data)}\`);
        throw new LLMError(\`LLM API request failed with status \${error.response.status}\`, {
          statusCode: error.response.status,
          responseData: error.response.data,
          originalErrorName: error.name
        });
      } else if (error.request) {
        logger.error(\`LLM API request failed: No response received. \${error.message}\`);
        throw new LLMError('LLM API request failed: No response received', { originalErrorName: error.name, originalErrorMessage: error.message });
      } else {
        logger.error(\`Error setting up LLM API request: \${error.message}\`);
        throw new LLMError(\`Error setting up LLM API request: \${error.message}\`, { originalErrorName: error.name, originalErrorMessage: error.message });
      }
    }
  }
}

export { LLMInterface };
