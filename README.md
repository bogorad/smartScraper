# SmartScraper: Intelligent Web Content Extractor

## Overview

SmartScraper is a modular Node.js library designed to intelligently extract the main article content from any web page URL. It addresses the challenge of varying website structures through a robust, adaptive approach:

1. **Tiered Extraction Strategy:** Prioritizes simpler, faster methods (like cURL) and escalates to more complex, resource-intensive methods (like Puppeteer with LLM-assisted XPath discovery) only when necessary.

2. **Learning & Adaptation:** Stores successful scraping configurations (method, XPath, CAPTCHA needs) for known domains to expedite future requests. Re-discovers configurations if they become stale.

3. **Anti-Bot Evasion:** Utilizes `puppeteer-extra` and `puppeteer-extra-plugin-stealth` for advanced stealth techniques, with optional CAPTCHA solving capabilities.

The goal is to provide a robust way to extract content from diverse web pages while maintaining efficiency and adaptability to website changes.

## Features

* **Modular Architecture:** Built with loosely coupled modules with well-defined responsibilities and interfaces, facilitating maintainability, testability, and extensibility.
* **Automatic XPath Discovery:** Leverages LLMs to find the main content container XPath for unknown domains.
* **Method Selection:** Intelligently chooses between cURL (for simple sites) and Puppeteer (for JavaScript-heavy sites or those requiring CAPTCHA solving).
* **Configuration Storage:** Stores successful domain configurations in a local JSON file for efficient reuse.
* **Self-Healing:** If a stored configuration fails during extraction, automatically triggers re-discovery to find updated selectors.
* **Anti-Bot Measures:** Uses `puppeteer-extra-plugin-stealth` to bypass common bot detection techniques.
* **CAPTCHA Handling:** Optional integration with external CAPTCHA solving services.
* **Robust Error Handling:** Custom error classes with detailed context for better debugging.
* **Configurable:** Uses environment variables (`.env` file) for API keys, LLM model selection, and other settings.

## Architecture & Workflow

The system is designed with a modular architecture to ensure separation of concerns, testability, and maintainability. A core "Scraper Engine" orchestrates the overall flow, delegating tasks to specialized modules:

### Key Modules

* **`CoreScraperEngine`**: Orchestrates the main workflow, deciding whether to use known site logic or trigger discovery.
* **`KnownSitesManager`**: Handles CRUD operations for the known sites storage.
* **`PuppeteerController`**: Manages Puppeteer browser instances with `puppeteer-extra` and `puppeteer-extra-plugin-stealth` integration.
* **`CurlHandler`**: Executes HTTP requests for non-JavaScript reliant fetching.
* **`DomComparator`**: Compares HTML DOM structures to assess similarity.
* **`LLMInterface`**: Interacts with the Large Language Model API for XPath discovery.
* **`ContentScoringEngine`**: Implements heuristic scoring logic to evaluate content relevance.
* **`CaptchaSolver`**: Interfaces with external CAPTCHA solving services.
* **`HtmlAnalyser`**: Performs static analysis on HTML content.
* **`PluginManager`**: Manages browser plugins/extensions within Puppeteer.

### High-Level Workflow

1. **Request Initiation:** Core engine receives URL, proxy info, User-Agent, etc.
2. **Known Site Check:**
   * If **Known Site & Config Valid:** Use stored configuration.
   * If **Known Site & Config Stale/Fails:** Trigger re-discovery.
   * If **Unknown Site:** Proceed to discovery.
3. **Discovery Process:**
   * **Initial Probing:** Try both cURL and Puppeteer, compare results.
   * **XPath Discovery:** Use LLM to generate candidate XPaths, validate and score them.
   * **Method Selection:** Choose between cURL, Puppeteer, or Puppeteer with CAPTCHA solving.
   * **Store Configuration:** Save successful configuration for future use.
4. **Content Extraction:** Use determined method, XPath, and CAPTCHA solver if needed.
5. **Return Data.**

This modular approach allows for easy extension and maintenance of the system.

## Technology Stack

* **Runtime:** Node.js
* **Browser Automation:** `puppeteer-extra` with `puppeteer-extra-plugin-stealth`
* **DOM Parsing:** `jsdom` for static HTML analysis
* **HTTP Requests:** `axios` for API calls and cURL-like requests
* **HTML Processing:** `turndown` for HTML-to-markdown conversion
* **Configuration:** `dotenv` for environment variable management
* **LLM API:** OpenRouter.ai (or any OpenAI-compatible API endpoint)

## Prerequisites

* **Node.js:** Version 16 or higher recommended.
* **npm:** Node Package Manager (usually comes with Node.js).
* **Chromium/Chrome:** A compatible version of Chromium or Google Chrome installed and accessible by Puppeteer.
* **OpenRouter API Key:** An API key from [OpenRouter.ai](https://openrouter.ai/).
* **LLM Model Access:** Ensure the selected LLM model in your `.env` file is available via your OpenRouter account.
* **CAPTCHA Solver API Key (Optional):** If you need CAPTCHA solving capabilities.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/universal-scraper.git
   cd universal-scraper
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file with your configuration (see Configuration section).

## Configuration

Create a file named `.env` in the root directory. Add the following variables:

```dotenv
# --- LLM Configuration ---
# Your OpenRouter API Key
OPENROUTER_API_KEY=your_openrouter_api_key_here
# The LLM model identifier to use
LLM_MODEL=openai/gpt-3.5-turbo

# --- Puppeteer Configuration ---
# Path to your Chrome/Chromium executable (optional)
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
# Default timeout for Puppeteer operations (in milliseconds)
PUPPETEER_DEFAULT_TIMEOUT=30000
# Navigation timeout (in milliseconds)
PUPPETEER_NAVIGATION_TIMEOUT=60000

# --- CAPTCHA Solver Configuration (Optional) ---
CAPTCHA_SERVICE_NAME=2captcha
CAPTCHA_API_KEY=your_captcha_api_key_here

# --- Logging Configuration ---
# Set log level (DEBUG, INFO, WARN, ERROR)
LOG_LEVEL=INFO
# Save HTML to ./failed_html_dumps/ if extraction fails
SAVE_HTML_ON_FAILURE=false

# --- Plugin Configuration (Optional) ---
# Paths to browser extensions (comma-separated)
EXTENSION_PATHS=/path/to/extension1,/path/to/extension2
```

You can customize these settings based on your specific requirements.

## Usage

### As a Library

```javascript
import { UniversalScraper } from './src/index.js';

// Create a scraper instance
const scraper = new UniversalScraper();

// Extract content from a URL
async function extractContent() {
  try {
    const result = await scraper.getContent('https://example.com/article');
    console.log('Extracted content:', result.content);
    console.log('Method used:', result.method);
    console.log('XPath used:', result.xpath);
  } catch (error) {
    console.error('Extraction failed:', error.message);
  }
}

extractContent();
```

### Advanced Usage

```javascript
import { UniversalScraper } from './src/index.js';

// Custom configuration
const customConfig = {
  llmConfig: {
    model: 'anthropic/claude-3-haiku'
  },
  scraperSettings: {
    puppeteerNavigationTimeout: 90000,
    domComparisonThreshold: 0.85
  }
};

// Create a scraper instance with custom configuration
const scraper = new UniversalScraper(customConfig);

// Extract content with proxy and user agent
async function extractWithProxy() {
  const options = {
    proxyDetails: {
      server: 'http://your-proxy-server:port',
      auth: { username: 'user', password: 'pass' }
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    outputType: 'markdown' // Get markdown instead of HTML
  };

  try {
    const result = await scraper.getContent('https://example.com/article', options);
    console.log('Extracted content:', result.content);
  } catch (error) {
    console.error('Extraction failed:', error.message);
  }
}

extractWithProxy();
```

## Storage

The system stores successful scraping configurations in a JSON file for efficient reuse:

* **File:** `known_sites_storage.json` (configurable)
* **Location:** `./data/` directory by default (configurable)
* **Format:** A JSON object mapping normalized domain names to their corresponding configurations:

```json
{
  "example.com": {
    "domain_pattern": "example.com",
    "method": "curl",
    "xpath_main_content": "//article[@class='main-content']",
    "last_successful_scrape_timestamp": "2023-07-15T14:32:45.123Z",
    "failure_count_since_last_success": 0,
    "needs_captcha_solver": false
  },
  "news-site.com": {
    "domain_pattern": "news-site.com",
    "method": "puppeteer_stealth",
    "xpath_main_content": "//div[@id='article-body']",
    "last_successful_scrape_timestamp": "2023-07-16T09:12:30.456Z",
    "failure_count_since_last_success": 0,
    "needs_captcha_solver": false
  },
  "paywall-site.com": {
    "domain_pattern": "paywall-site.com",
    "method": "puppeteer_captcha",
    "xpath_main_content": "//main[@class='content']",
    "last_successful_scrape_timestamp": "2023-07-17T18:45:22.789Z",
    "failure_count_since_last_success": 0,
    "needs_captcha_solver": true
  }
}
```

The `KnownSitesManager` module handles all CRUD operations for this storage, including:
- Loading configurations at startup
- Querying by domain
- Saving/updating entries after successful scrapes
- Tracking failure counts for stale configurations

## Error Handling & Robustness

The system implements a comprehensive error handling strategy with custom error classes:

* **`ScraperError`**: Base error class for all scraper-related errors
* **`LLMError`**: For issues with LLM API calls
* **`CaptchaError`**: For CAPTCHA solving failures
* **`NetworkError`**: For network-related issues (cURL, Puppeteer navigation)
* **`ConfigurationError`**: For configuration problems
* **`ExtractionError`**: For content extraction failures

Each error class includes:
- Detailed error message
- Additional context in a `details` object
- Original error (if applicable)
- Timestamp

This structured approach makes debugging easier and provides more useful information when things go wrong.

## Logging

The system uses a flexible logging system with configurable levels:

```javascript
// Example usage
import { logger } from './src/utils/logger.js';

logger.debug('Detailed debugging information');
logger.info('General information about operation');
logger.warn('Warning about potential issues');
logger.error('Error information when something fails');
```

To set the log level, use the `LOG_LEVEL` environment variable:

```dotenv
# Set to DEBUG, INFO, WARN, ERROR, or NONE
LOG_LEVEL=INFO
```

## Future Enhancements

* **Database Integration**: Replace JSON storage with a database for better concurrency and scalability
* **Visual Analysis**: Implement screenshot-based content detection for complex layouts
* **Machine Learning**: Train models to identify main content without relying on XPaths
* **API Server**: Create a REST API for remote content extraction
* **Proxy Rotation**: Add support for rotating proxies to avoid IP blocking
* **Content Cleaning**: Add more output formats and content cleaning options
* **Performance Optimization**: Implement caching and parallel processing for faster extraction

## License

MIT License
