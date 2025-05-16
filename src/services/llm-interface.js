// src/services/llm-interface.js

import axios from 'axios';
import logger from '../utils/logger.js';
// No need to import llmConfig directly here if passed in constructor

class LLMInterface {
    constructor(llmConfig) {
        if (!llmConfig || !llmConfig.apiKey || !llmConfig.chatCompletionsEndpoint || !llmConfig.model) {
            throw new Error('LLMInterface: Missing required LLM configuration (apiKey, chatCompletionsEndpoint, model).');
        }
        this.apiKey = llmConfig.apiKey;
        this.endpoint = llmConfig.chatCompletionsEndpoint;
        this.model = llmConfig.model;
        this.defaultTemperature = llmConfig.defaultTemperature || 0.5; // More deterministic for XPath
        this.defaultMaxTokens = llmConfig.defaultMaxTokens || 256; // XPaths are usually not too long

        this.axiosInstance = axios.create({
            baseURL: this.endpoint.substring(0, this.endpoint.lastIndexOf('/')), // Base URL for OpenRouter
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                // OpenRouter specific headers (optional, but good practice)
                // 'HTTP-Referer': 'YOUR_APP_URL_OR_NAME', // Replace with your app's URL or name
                // 'X-Title': 'UniversalScraperLLM', // Replace with your app's name
            }
        });
        logger.info(`LLMInterface initialized for model: ${this.model}`);
    }

    _constructPrompt(htmlContentSummary, snippets, feedbackContext) {
        // Truncate HTML content if too long to avoid excessive token usage
        const maxHtmlLength = 15000; // Adjust based on model context window and typical page sizes
        let truncatedHtml = htmlContentSummary;
        if (htmlContentSummary.length > maxHtmlLength) {
            truncatedHtml = htmlContentSummary.substring(0, maxHtmlLength) + "\n... (HTML truncated) ...";
        }

        let prompt = `
You are an expert web scraper tasked with identifying the main content area of a webpage.
Analyze the provided HTML structure and text snippets to suggest robust XPath expressions that point to the primary article body or main content container.

Prioritize XPaths that use:
1. Semantic HTML5 tags like <article>, <main>.
2. IDs or classes that are descriptive of content (e.g., "article-body", "main-content", "story-text").
3. Relative XPaths if they are clearly anchored to a stable element.
Avoid overly brittle XPaths that rely on specific numerical indices if possible (e.g., /div[3]/div[2]/p[5]).

HTML Structure Summary (may be truncated):
\`\`\`html
${truncatedHtml}
\`\`\`

Key Text Snippets from the page to help identify relevant content:
${snippets.map(s => `- "${s}"`).join('\n')}

${feedbackContext && feedbackContext.length > 0 ? `
Previous attempts and feedback (use this to improve your suggestions):
${feedbackContext.map(f => `- ${f}`).join('\n')}
Please provide DIFFERENT and BETTER XPath suggestions based on this feedback.
` : ''}

Respond ONLY with a JSON array of unique XPath strings, like this: ["//article", "//div[@id='content']"]
Do not include any other text, explanations, or markdown formatting outside the JSON array.
Suggest up to 5 diverse and high-quality candidate XPaths.
`;
        return prompt.trim();
    }

    /**
     * Gets candidate XPath expressions from the LLM.
     * @param {string} htmlContent - A summary or significant portion of the page's HTML.
     * @param {string[]} snippets - Array of text snippets from the page.
     * @param {string[]} feedbackContext - Array of feedback strings from previous failed attempts.
     * @returns {Promise<string[]|null>} An array of XPath strings or null if an error occurs.
     */
    async getCandidateXPaths(htmlContent, snippets, feedbackContext = []) {
        const prompt = this._constructPrompt(htmlContent, snippets, feedbackContext);
        const payload = {
            model: this.model,
            messages: [
                { role: 'system', content: 'You are an expert XPath generator for web scraping.' },
                { role: 'user', content: prompt }
            ],
            temperature: this.defaultTemperature,
            max_tokens: this.defaultMaxTokens,
            // stream: false, // Not streaming for this use case
        };

        logger.info(`Sending request to LLM. Prompt length (approx): ${prompt.length} chars.`);
        // logger.debug(`LLM Payload: ${JSON.stringify(payload, null, 2)}`); // Can be very verbose

        try {
            const response = await this.axiosInstance.post(
                this.endpoint.substring(this.endpoint.lastIndexOf('/')), // Just the path part e.g. /chat/completions
                payload,
                { timeout: 30000 } // 30 second timeout for LLM response
            );

            if (response.data && response.data.choices && response.data.choices.length > 0) {
                const messageContent = response.data.choices[0].message?.content;
                if (messageContent) {
                    logger.debug(`LLM raw response content: ${messageContent}`);
                    try {
                        // Attempt to parse the content as a JSON array of strings
                        // The LLM might sometimes include markdown backticks around the JSON
                        const cleanedContent = messageContent.replace(/^```json\s*|```\s*$/g, '').trim();
                        const xpaths = JSON.parse(cleanedContent);
                        if (Array.isArray(xpaths) && xpaths.every(item => typeof item === 'string')) {
                            logger.info(`LLM returned ${xpaths.length} candidate XPaths.`);
                            return xpaths.filter((xpath, index, self) => self.indexOf(xpath) === index); // Ensure uniqueness
                        } else {
                            logger.warn('LLM response content was not a valid JSON array of strings:', cleanedContent);
                            return null;
                        }
                    } catch (parseError) {
                        logger.error(`Failed to parse LLM response as JSON: ${parseError.message}. Raw content: ${messageContent}`);
                        // Fallback: try to extract XPaths using a regex if parsing fails (less reliable)
                        const xpathRegex = /\/\/[a-zA-Z0-9\[\]@='".:,()\s-]+/g;
                        const extracted = messageContent.match(xpathRegex);
                        if (extracted && extracted.length > 0) {
                            logger.warn(`Fallback: Extracted ${extracted.length} XPaths using regex.`);
                            return extracted.filter((xpath, index, self) => self.indexOf(xpath) === index);
                        }
                        return null;
                    }
                } else {
                    logger.warn('LLM response did not contain expected message content.');
                    return null;
                }
            } else {
                logger.warn('LLM response was empty or malformed:', response.data);
                return null;
            }
        } catch (error) {
            if (error.response) {
                logger.error(`LLM API request failed with status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
            } else if (error.request) {
                logger.error(`LLM API request failed: No response received. ${error.message}`);
            } else {
                logger.error(`Error setting up LLM API request: ${error.message}`);
            }
            return null;
        }
    }
}

export { LLMInterface };
