# SmartScraper: Intelligent Web Content Extractor

SmartScraper is an advanced web scraping tool designed to intelligently identify and extract the main article content from various web pages, even those protected by CAPTCHAs or complex JavaScript. It leverages a combination of direct fetching (cURL-like), browser automation (Puppeteer), and Large Language Models (LLMs) for robust content discovery and extraction.

## Core Features

*   **Multiple Scraping Strategies:**
    *   **cURL:** Fast, direct HTTP requests for simple sites.
    *   **Puppeteer (Stealth):** Headless browser automation with stealth capabilities to mimic real user behavior and handle JavaScript-heavy sites.
    *   **Puppeteer (CAPTCHA Solving):** Integrated CAPTCHA solving for sites protected by services like DataDome (using 2Captcha by default).
*   **LLM-Powered Content Discovery:** For unknown sites, an LLM (e.g., via OpenRouter) analyzes a simplified DOM structure to identify the most likely XPath for the main content.
*   **Known Sites Database:** Stores successful scraping configurations (method, XPath, User-Agent, CAPTCHA requirements) for domains, improving speed and reliability for subsequent scrapes.
*   **Self-Healing Configuration:**
    *   If a known site configuration fails, the system can trigger a re-discovery process.
    *   If a CAPTCHA is encountered and solved on a site not previously marked as needing it, the configuration can be updated automatically.
*   **Proxy Support:** Uses HTTP/HTTPS proxies (configurable via `HTTP_PROXY` environment variable) for all scraping methods and CAPTCHA solving requests.
*   **User-Agent Customization:** Allows setting a custom User-Agent via the `USER_AGENT` environment variable, or uses a robust default.
*   **Plugin System:** Supports Puppeteer browser extensions (e.g., for ad-blocking).
*   **Robust Error Handling:** Differentiates between operational errors (per URL) and critical script failures.
*   **TypeScript:** Written in TypeScript for improved code quality, maintainability, and type safety.

## Project Structure

*   `src/`: Main source code.
    *   `core/engine.ts`: The central `CoreScraperEngine` orchestrating the scraping process.
    *   `analysis/`: Modules for HTML analysis, DOM comparison, and content scoring.
    *   `browser/`: Puppeteer controller and plugin manager.
    *   `network/`: cURL-like request handler.
    *   `services/`: LLM interface, CAPTCHA solver, DataDome solver.
    *   `storage/`: Management of the known sites database.
    *   `utils/`: Logger, error handlers, URL helpers.
    *   `config/`: Configuration files for scraper settings, LLM, and CAPTCHA services.
*   `tools/`: Utility scripts, including `process_url_list.ts` for batch scraping.
*   `data/`: Stores `known_sites_storage.json`.
*   `tests/`: Unit and integration tests.
*   `dist/`: Compiled JavaScript output from TypeScript.

## Setup and Installation

1.  **Prerequisites:**
    *   Node.js (v18.x or later recommended)
    *   npm (or Yarn)
    *   A Chromium-based browser installed (if Puppeteer needs to launch its own). The path can be specified via `PUPPETEER_EXECUTABLE_PATH` in `.env`.

2.  **Clone the Repository:**
    ```bash
    git clone https://github.com/bogorad/smartScraper.git
    cd smartScraper
    ```

3.  **Install Dependencies:**
    ```bash
    npm install
    # or
    # yarn install
    ```

4.  **Environment Configuration (`.env` file):**
    *   Copy the example environment file:
        ```bash
        cp .env.example .env
        ```
    *   Edit the `.env` file and fill in your details, especially:
        *   `OPENROUTER_API_KEY`: Your API key for OpenRouter (or another LLM provider if `LLM_MODEL` and endpoint are changed).
        *   `LLM_MODEL`: The identifier for the LLM model you wish to use (defaults to a free OpenRouter model).
        *   `TWOCAPTCHA_API_KEY`: Your API key for 2Captcha service (required for `puppeteer_captcha` method).
        *   `HTTP_PROXY`: (Optional) Your proxy server URL (e.g., `http://user:pass@host:port`).
        *   `USER_AGENT`: (Optional) A custom User-Agent string. If not set, a default Chrome User-Agent is used.
        *   `PUPPETEER_EXECUTABLE_PATH`: (Optional) Path to your Chrome/Chromium executable if not found automatically by Puppeteer.
        *   `LOG_LEVEL`: Set to `INFO` (default), `DEBUG` (for verbose output and HTML dumps), `WARN`, or `ERROR`.

5.  **Build TypeScript to JavaScript:**
    ```bash
    npm run build
    ```
    This compiles all `.ts` files into the `dist/` directory.

## Running the Scraper

### Batch Processing URLs

The primary way to use the scraper for a list of URLs is via the `process_url_list.ts` script.

1.  **Prepare URL List:**
    *   Edit the file `urls_for_testing.txt` in the project root.
    *   Add one URL per line.

2.  **Run the Script:**
    *   After building the project (`npm run build`):
        ```bash
        npm run start:dist
        # or directly with node:
        # node dist/tools/process_url_list.js
        ```
    *   Alternatively, for development, you can run the TypeScript file directly using `ts-node` (ensure it's installed: `npm install -D ts-node`):
        ```bash
        node --loader ts-node/esm tools/process_url_list.ts
        ```

    *   **Output:**
        *   Logs will appear in the console.
        *   A detailed processing log will be saved to `tools_processing_log.txt`.
        *   If `LOG_LEVEL=DEBUG` (in `.env`), HTML dumps for successful/failed pages will be saved in `success_html_dumps/` and `failed_html_dumps/` respectively.
    *   **Fail-Fast Behavior:** The `process_url_list.ts` script is configured to **halt immediately and exit with an error code if any single URL fails** during its processing (either in fetching, CAPTCHA solving, content extraction, or discovery).

### Programmatic Usage (as a Library)

You can import and use the `scrapeUrl` function from `src/index.ts` in your own Node.js TypeScript projects.

```typescript
import { scrapeUrl, OUTPUT_TYPES, METHODS } from './dist/src/index.js'; // Adjust path as needed

async function main() {
  try {
    const result = await scrapeUrl('https://www.example.com/article', {
      outputType: OUTPUT_TYPES.CONTENT_ONLY as any, // Cast if type incompatibility
      // proxyDetails: { server: 'http://user:pass@host:port' },
      // userAgentString: 'MyCustomUserAgent/1.0'
    });

    if (result.success) {
      console.log('Method:', result.method);
      console.log('XPath:', result.xpath);
      console.log('Extracted Content:', result.data);
    } else {
      console.error('Scraping failed:');
      console.error('  Error Type:', result.errorType);
      console.error('  Error Message:', result.error);
      if (result.details) {
        console.error('  Details:', result.details);
      }
    }
  } catch (error) {
    console.error('Critical error during scrapeUrl call:', error);
  }
}

main();
```

## Key Configuration Files

*   `.env`: For sensitive keys, proxy details, and environment-specific settings.
*   `config/scraper-settings.ts`: General scraper behavior, timeouts, paths, default User-Agent, content scoring weights.
*   `config/captcha-solver-config.ts`: CAPTCHA service settings (defaults to 2Captcha).
*   `config/index.ts`: Aggregates and exports all configurations.
*   `data/known_sites_storage.json`: Stores learned configurations for specific domains.

## Debugging

*   Set `LOG_LEVEL=DEBUG` in your `.env` file for verbose console output.
*   When `LOG_LEVEL=DEBUG`, HTML dumps are saved:
    *   `saveHtmlOnSuccessNav=true` (in `scraper-settings.ts` or `.env`) saves HTML for successful scrapes.
    *   Failed attempts (e.g., CAPTCHA pages, error pages) are saved in `failed_html_dumps/`.
*   Run Puppeteer in non-headless mode by setting `PUPPETEER_HEADLESS=false` in `.env` to visually inspect browser behavior.

## CAPTCHA Handling

*   Currently integrates with **2Captcha** for solving DataDome and other standard CAPTCHAs (reCAPTCHA, hCaptcha, Turnstile).
*   Requires `TWOCAPTCHA_API_KEY` in `.env`.
*   The `DataDomeSolver` implements logic based on the reference example provided, including proxy usage for 2Captcha tasks and robust cookie formatting.
*   Solved DataDome cookies are stored in `known_sites_storage.json` for potential reuse.

## Development

*   **Build:** `npm run build` (compiles TypeScript)
*   **Watch & Run:** `npm run dev` (watches for TS changes, recompiles, and restarts `tools/process_url_list.ts` using `nodemon`)
*   **Lint:** `npm run lint` (uses ESLint with TypeScript plugin)
*   **Test:** `npm test` (runs Jest tests)

## Flowchart

Refer to `smartScraper.dot` (Graphviz DOT file) and `smartScraper.svg` for a visual representation of the high-level algorithm flow. To regenerate the SVG from the DOT file:
```bash
dot -Tsvg smartScraper.dot -o smartScraper.svg
```

![Smart Scraper](smartScraper.svg)
