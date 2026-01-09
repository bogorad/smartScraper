# SmartScraper

SmartScraper is an intelligent, self-learning web scraping service designed to robustly extract content from diverse websites, including those with heavy JavaScript and anti-bot measures.

## Features

- **Intelligent Extraction**: Uses LLMs to discover content XPaths when standard selectors fail.
- **Self-Healing**: Automatically updates and saves working configurations for domains.
- **Anti-Bot Evasion**: 
  - Realistic browser fingerprinting (Puppeteer Stealth).
  - Integration with 2Captcha for solving generic and DataDome CAPTCHAs.
  - Extension support for ad-blocking and paywall bypass.
- **Concurrency & Scaling**:
  - High-performance queue processing with **5 parallel workers** by default.
  - Granular resource management (per-scrape browser page cleanup).
- **Backend & Dashboard**: 
  - REST API for programmatic access.
  - **Real-time Dashboard** powered by HTMX + SSE (Server-Sent Events) for live worker status.
  - Statistical insights and site configuration management.
  - Persistent storage using JSONC and JSON Lines.

## Architecture

The system follows a Hexagonal Architecture (Ports & Adapters) to separate core logic from external dependencies.

For detailed architectural decisions, please refer to the [ADR Directory](docs/adr/README.md).

### Key Architecture Decision Records (ADRs)

- **[ADR-003: Core Engine](docs/adr/003-core-engine.md)** - Explains the central orchestration and scraping pipeline phases.
- **[ADR-001: Puppeteer Configuration](docs/adr/001-puppeteer.md)** - Details browser session management, extension loading, and stealth techniques.
- **[ADR-011: Backend Architecture](docs/adr/011-backend-architecture.md)** - Covers the Hono + HTMX stack, API endpoints, and storage strategy.
- **[ADR-004: LLM XPath Discovery](docs/adr/004-llm-xpath-discovery.md)** - Describes how LLMs are used to analyze DOM structures and suggest XPaths.
- **[ADR-006: Known Sites Storage](docs/adr/006-known-sites-storage.md)** - Defines the schema for persisting site configurations.

## Getting Started

### Prerequisites

- Node.js 24+
- Chromium (or Google Chrome)
- Valid API keys for:
  - OpenRouter (for LLM features)
  - 2Captcha (optional, for CAPTCHA solving)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-org/smart-scraper.git
    cd smart-scraper
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure the application:**
    See the [Configuration & Secrets](#configuration--secrets) section below.

### Running the Server

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

The server typically starts on port `5555`.

## API Usage

**Scrape a URL:**

```bash
curl -X POST http://localhost:5555/api/scrape \
  -H "Authorization: Bearer <YOUR_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/article",
    "outputType": "markdown"
  }'
```

See [ADR-002](docs/adr/002-public-api.md) for the full API contract.

## Configuration & Secrets

SmartScraper uses a **centralized configuration system** with Zod validation. All configuration is managed through a single config module that:

- ✅ Validates all environment variables at startup
- ✅ Supports `.env` file loading via dotenv
- ✅ Supports `secrets.yaml` for sensitive data
- ✅ Provides clear error messages for missing required configuration
- ✅ Prevents secrets from being logged or exposed

### Configuration Sources (in order of precedence)

1. **Environment variables** (highest priority)
   - Loaded from `.env` file automatically
   - Or set directly in your shell/deployment environment

2. **secrets.yaml** file
   - Encrypted YAML file for sensitive data
   - Useful for Docker secrets or sops-encrypted files
   - Structure:
     ```yaml
     api_keys:
       smart_scraper: "your_api_token"
       openrouter: "your_openrouter_key"
       twocaptcha: "your_2captcha_key"
     ```

3. **Default values** (lowest priority)
   - Sensible defaults for non-critical config
   - See `.env.example` for all defaults

### Setting Up Configuration

#### Option 1: .env File (Recommended for Development)

1. Copy the example file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your values:
   ```env
   # Required
   API_TOKEN=your_secure_token_here
   OPENROUTER_API_KEY=your_key_here
   TWOCAPTCHA_API_KEY=your_2captcha_key_here

   # Optional
   PORT=5555
   DATA_DIR=./data
   LLM_MODEL=meta-llama/llama-4-maverick:free
   ```

3. Run the server:
   ```bash
   npm run dev
   ```

#### Option 2: secrets.yaml (Recommended for Production)

Create a `secrets.yaml` file with encrypted secrets (using sops or similar):

```yaml
api_keys:
  smart_scraper: "your_api_token"
  openrouter: "your_openrouter_key"
  twocaptcha: "your_2captcha_key"
```

Then set other config via environment variables:
```bash
export PORT=5555
export DATA_DIR=/var/data/smart-scraper
npm start
```

#### Option 3: Environment Variables Only

Set all config via environment variables (useful for Docker/Kubernetes):
```bash
export PORT=5555
export API_TOKEN=your_token
export OPENROUTER_API_KEY=your_key
export TWOCAPTCHA_API_KEY=your_key
npm start
```

### Required Configuration

These must be set for the application to function:

| Variable | Description | Where to Set |
|----------|-------------|--------------|
| `API_TOKEN` | Token for API authentication | `.env` or `secrets.yaml` |
| `OPENROUTER_API_KEY` | OpenRouter API key for LLM features | `.env` or `secrets.yaml` |
| `TWOCAPTCHA_API_KEY` | 2Captcha API key (only if scraping CAPTCHA sites) | `.env` or `secrets.yaml` |

### Optional Configuration

See `.env.example` for all available options including:
- `PORT` - Server port (default: 5555)
- `DATA_DIR` - Data storage directory (default: ./data)
- `LLM_MODEL` - LLM model to use (default: meta-llama/llama-4-maverick:free)
- `LLM_TEMPERATURE` - LLM temperature (default: 0)
- `EXECUTABLE_PATH` - Chrome/Chromium path
- `EXTENSION_PATHS` - Browser extensions to load
- `PROXY_SERVER` - HTTP proxy for scraping
- `LOG_LEVEL` - Logging level (default: INFO)
- And more...

### Legacy Environment Variable Names

For backward compatibility, these legacy names are still supported:

| Legacy Name | New Name | Status |
|-------------|----------|--------|
| `PUPPETEER_EXECUTABLE_PATH` | `EXECUTABLE_PATH` | Still works, use new name |
| `HTTP_PROXY` | `PROXY_SERVER` | Still works, use new name |

The config module will automatically detect and use legacy names if the new names are not set.

### Configuration Validation

The application validates all configuration at startup using [Zod](https://zod.dev/) schemas. If any required config is missing or invalid, you'll see a clear error message:

```
[CONFIG] Validation failed:
openrouterApiKey: String must contain at least 1 character(s)
```

Fix the issues shown and restart the application.

### Secrets Security

To prevent secrets leaking:
- ✅ Secrets are **never logged** even in debug mode
- ✅ Validation errors show **field names only**, not values
- ✅ Use `secrets.yaml` with sops encryption in production
- ✅ Set sensitive vars via Docker secrets or Kubernetes vault
- ✅ Never commit `.env` or `secrets.yaml` to version control
- ✅ Add them to `.gitignore` (already done)

## Dashboard

Visit `http://localhost:5555/dashboard` (requires login) to:
- View extraction statistics.
- Manage known site configurations.
- Manually test extraction on specific URLs.

## Testing

SmartScraper has comprehensive test coverage using **Vitest** with 181 tests across 12 test files.

### Running Tests

```bash
# Run all tests (watch mode)
npm test

# Run tests once (CI mode)
npm test -- --run

# Run tests with coverage
npm test -- --run --coverage

# Run type checking
npm run typecheck
```

### Test Coverage

- **Utilities** (6 test files) - Date, URL, DOM, mutex, HTML cleaning, XPath parsing
- **Core Engine** (2 test files) - Element scoring, scraper orchestration (with mocked ports)
- **Adapters** (2 test files) - LLM integration, CAPTCHA solving (with mocked axios)
- **Routes & Middleware** (2 test files) - API endpoints, authentication

All external dependencies are mocked, so tests run without requiring:
- Real API keys
- Browser instances
- Network access
- File system changes

### Continuous Integration

Tests and type checking run automatically on every push and pull request via GitHub Actions:

- ✅ TypeScript type checking (`tsc --noEmit`)
- ✅ All unit tests pass
- ✅ Code coverage reporting

See `.github/workflows/ci.yml` for the CI configuration.

For more details, see [TEST_SUMMARY.md](TEST_SUMMARY.md).
