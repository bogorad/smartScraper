# SmartScraper

SmartScraper is an intelligent, self-learning web scraping service designed to robustly extract content from diverse websites, including those with heavy JavaScript and anti-bot measures.

## Features

- **Intelligent Extraction**: Uses LLMs to discover content XPaths when standard selectors fail.
- **Self-Healing**: Automatically updates and saves working configurations for domains.
- **Anti-Bot Evasion**: 
  - Realistic browser fingerprinting (Puppeteer Stealth).
  - Integration with 2Captcha for solving generic and DataDome CAPTCHAs.
  - Extension support for ad-blocking and paywall bypass.
- **Backend & Dashboard**: 
  - REST API for programmatic access.
  - Dashboard for managing site configs, viewing statistics, and testing.
  - Persistent storage using JSONC (for human-editable configs) and JSON Lines (for logs).

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

3.  **Configure secrets:**
    Create a `secrets.yaml` or set environment variables:
    - `API_TOKEN`: Secret token for API authentication.
    - `OPENROUTER_API_KEY`: Key for LLM integration.
    - `TWOCAPTCHA_API_KEY`: Key for CAPTCHA solving services.

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

## Dashboard

Visit `http://localhost:5555/dashboard` (requires login) to:
- View extraction statistics.
- Manage known site configurations.
- Manually test extraction on specific URLs.
