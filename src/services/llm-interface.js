// src/services/llm-interface.js
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { LLMError, ConfigurationError } from '../utils/error-handler.js';

class LLMInterface {
  constructor(llmConfig) {
    if (!llmConfig || !llmConfig.apiKey || !llmConfig.chatCompletionsEndpoint || !llmConfig.model) {
      throw new ConfigurationError('LLMInterface: Missing required LLM configuration values (apiKey, chatCompletionsEndpoint, model)', {
        apiKeyProvided: !!llmConfig?.apiKey,
        endpointProvided: !!llmConfig?.chatCompletionsEndpoint,
        modelProvided: !!llmConfig?.model
      });
    }
    this.apiKey = llmConfig.apiKey;
    this.endpoint = llmConfig.chatCompletionsEndpoint;
    this.model = llmConfig.model;
    this.temperature = llmConfig.temperature !== undefined ? llmConfig.temperature : 0; // Default to 0

    this.axiosInstance = axios.create({
      baseURL: this.endpoint.substring(0, this.endpoint.lastIndexOf('/')), // Assuming endpoint is like '.../v1/chat/completions'
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        // OpenRouter specific headers (optional but good practice)
        'HTTP-Referer': 'https://github.com/bogorad/smartscraper', // Replace with your app's URL or repo
        'X-Title': 'SmartScraper' // Replace with your app's name
      }
    });
    logger.info(`LLMInterface initialized for model: ${this.model}, Temperature: ${this.temperature}`);
  }

  /**
   * Constructs the prompt for the LLM.
   * Uses the enhanced prompt structure from reference/test-find-xpath.js.
   * @param {string} simplifiedDomStructure - The simplified and annotated DOM structure.
   * @param {string[]} snippets - Text snippets from the page.
   * @param {string[]} feedbackContext - Feedback from previous LLM attempts.
   * @returns {string} The constructed prompt.
   * @private
   */
  _constructPrompt(simplifiedDomStructure, snippets, feedbackContext) {
    // Max length for the simplified DOM structure in the prompt to avoid overly large payloads
    // This is a safeguard; extractDomStructure should already make it much smaller.
    const maxDomLength = 100000; // Increased, as simplified DOM is already small
    let truncatedDom = simplifiedDomStructure;
    if (simplifiedDomStructure.length > maxDomLength) {
      truncatedDom = simplifiedDomStructure.substring(0, maxDomLength) + "\n... (Simplified DOM truncated) ...";
      logger.warn(`Simplified DOM structure was truncated to ${maxDomLength} chars for LLM prompt.`);
    }

    let prompt = `Analyze the following HTML source code from a webpage.
NOTE: This is a simplified DOM structure where most text content has been truncated to save space, but all tags and important attributes (id, class, etc.) are preserved.

IMPORTANT: Elements with significant text content have been annotated with:
1. A 'data-original-text-length' attribute showing the original character count.
2. HTML comments like <!-- Element contains X chars of text, Y paragraphs, Z links, N images -->.

Use these annotations to help identify the main content area. Elements with large text content and multiple paragraphs are likely part of the main article.

Identify the HTML element (and provide its XPath) that appears to contain the main body content, such as the primary narrative, text paragraphs, images, and embedded media, but excluding surrounding elements like navigation, sidebars, headers, footers, comment sections, and related stories.

Look for elements with these common patterns found across news and article websites:

1. Common element types:
   - <article> elements
   - <main> elements
   - <div> elements with descriptive classes/IDs
   - <section> elements with content-related attributes

2. Common class names (look for elements with these classes):
   - "article__content", "article-content", "article-body", "entry-content", "body-content",
   - "post-body", "story-body", "content-body", "main-content", "article__text",
   - "article__body", "story-text", "article-text", "paywall-content", "article-dropcap"

3. Common attribute patterns:
   - article elements with name="articleBody"
   - div elements with itemprop="articleBody"
   - section elements with class containing "Container" (e.g., WSJ)

4. Common ID patterns:
   - "article-content", "article-body", "content", "main-content", "article",
   - "story-content", "post-content", "article-body" (again, very common)

Prioritize finding a minimal container that wraps the core content accurately. Elements with the most paragraphs and significant text content (as indicated by the annotations) are likely to be the main content.

Focus on the structure, attributes, and the text size annotations rather than the truncated text content itself.`;

    if (snippets && snippets.length > 0) {
      prompt += `\n\nConsider that the main content likely contains text similar to these snippets (first 100 chars each):\n`;
      prompt += snippets.map(s => `- "${s.substring(0, 100)}${s.length > 100 ? '...' : ''}"`).join('\n');
    } else {
      prompt += `\n\nCould not extract specific text snippets, rely on structural and semantic analysis.`;
    }

    if (feedbackContext && feedbackContext.length > 0) {
      prompt += `\n\nPrevious attempts to validate XPaths failed or scored low. Here is the feedback on some XPaths tried (higher score is better, aim for scores > 0):`;
      feedbackContext.forEach(item => {
        // Sanitize feedback for the prompt
        const sanitizedResult = (typeof item === 'string' ? item : item.result || item.message || JSON.stringify(item))
                                .replace(/"/g, "'").substring(0, 150);
        const xpathPart = typeof item === 'string' ? "General feedback" : `XPath "${item.xpath}"`;
        prompt += `\n- ${xpathPart}: ${sanitizedResult}`;
      });
      prompt += `\nPlease suggest *alternative* and potentially more accurate XPaths based on this feedback. Avoid suggesting XPaths that resulted in 0 elements or were too broad/incorrectly scored. Focus on specificity and common content patterns. Avoid overly generic XPaths like "//div" unless highly qualified.`;
    } else {
      prompt += `\n\nProvide a list of the 3-5 most likely candidate XPaths, ordered by confidence.`;
    }

    prompt += `\n\n**IMPORTANT:** Respond ONLY with a JSON array of strings, where each string is a candidate XPath. Do not include any other text, explanation, or formatting outside the JSON array. Example: ["//div[@class='article-body']", "//main/article"].`;
    prompt += "\n\nSimplified HTML Structure:\n```html\n" + truncatedDom + "\n```";

    return prompt.trim();
  }

  /**
   * Gets candidate XPaths from the LLM.
   * @param {string} simplifiedDom - The simplified and annotated DOM structure.
   * @param {string[]} snippets - Text snippets from the page.
   * @param {Array<object|string>} [feedbackContext=[]] - Feedback from previous attempts. Each item can be an object {xpath, result} or a string.
   * @returns {Promise<string[]>} An array of candidate XPath strings.
   */
  async getCandidateXPaths(simplifiedDom, snippets, feedbackContext = []) {
    const prompt = this._constructPrompt(simplifiedDom, snippets, feedbackContext);
    const requestBody = {
      model: this.model,
      messages: [
        { role: "system", content: "You are an expert HTML analyzer. You identify XPaths for main content. You MUST respond ONLY with a JSON array of XPath strings. No other text or explanation." },
        { role: "user", content: prompt }
      ],
      temperature: this.temperature,
      // response_format: { type: "json_object" }, // Some models support this for more reliable JSON
      // max_tokens: 500 // Optional: limit response length
    };

    logger.info(`Sending request to LLM. Prompt length (approx): ${prompt.length} chars. Simplified DOM length: ${simplifiedDom.length} chars.`);
    logger.debug('LLM Request Body (excluding HTML in prompt for brevity):', { ...requestBody, messages: [{...requestBody.messages[0]}, {...requestBody.messages[1], content: "Prompt with HTML..."}] });

    try {
      const response = await this.axiosInstance.post(
        this.endpoint.substring(this.endpoint.lastIndexOf('/')), // Use just the path part like /chat/completions
        requestBody,
        { timeout: 75000 } // Increased timeout for potentially larger prompts/responses
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

      logger.debug(`LLM raw response content (first 300 chars): ${messageContent.substring(0, 300)}...`);

      // Attempt to parse the JSON from the response content
      let xpaths = [];
      try {
        // Try to find JSON within markdown code blocks first
        const codeBlockMatch = messageContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        let jsonStringToParse = messageContent.trim();

        if (codeBlockMatch && codeBlockMatch[1]) {
          jsonStringToParse = codeBlockMatch[1].trim();
          logger.debug('Extracted JSON from markdown code block.');
        } else {
          // If no code block, try to find a JSON array directly
          const arrayMatch = jsonStringToParse.match(/(\[[\s\S]*\])/);
          if (arrayMatch && arrayMatch[1]) {
            jsonStringToParse = arrayMatch[1];
            logger.debug('Found JSON array pattern in response.');
          }
        }
        
        xpaths = JSON.parse(jsonStringToParse);

        if (Array.isArray(xpaths) && xpaths.every(item => typeof item === 'string' && item.trim().startsWith('/'))) {
          logger.info(`LLM successfully returned ${xpaths.length} candidate XPaths.`);
          // Deduplicate XPaths
          const uniqueXPaths = [...new Set(xpaths.map(xp => xp.trim()).filter(xp => xp))];
          if (uniqueXPaths.length < xpaths.length) {
            logger.info(`Removed ${xpaths.length - uniqueXPaths.length} duplicate XPaths.`);
          }
          return uniqueXPaths;
        } else {
          logger.warn('LLM response content was not a valid JSON array of valid XPath strings:', jsonStringToParse);
          throw new LLMError('LLM response content was not a valid JSON array of XPath strings', { rawContent: jsonStringToParse });
        }
      } catch (parseError) {
        logger.error(`Failed to parse LLM response as JSON: ${parseError.message}. Raw content: ${messageContent}`);
        // Fallback: try to extract XPaths using a simple regex if JSON parsing fails
        const xpathRegex = /(\/\/[a-zA-Z0-9@=\[\]"'():.,\s*\-_]+)/g; // Improved regex
        const extracted = messageContent.match(xpathRegex);
        if (extracted && extracted.length > 0) {
          const uniqueExtracted = [...new Set(extracted.map(xp => xp.trim()).filter(xp => xp))];
          logger.warn(`Fallback: Extracted ${uniqueExtracted.length} XPaths using regex due to JSON parse error.`);
          return uniqueExtracted;
        }
        throw new LLMError('Failed to parse LLM response and fallback regex extraction failed.', {
          originalError: parseError.message,
          rawContent: messageContent.substring(0, 500) + (messageContent.length > 500 ? '...' : '')
        });
      }
    } catch (error) {
      if (error instanceof LLMError) throw error; // Re-throw if already our custom error

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
