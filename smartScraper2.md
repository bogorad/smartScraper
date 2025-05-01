# SmartScraper2 Documentation

This document outlines the architecture and execution flow of the `smartScraper2.js` script.

## Overview

`smartScraper2.js` is a Node.js script using Puppeteer to scrape article content from a given URL. It prioritizes using a stored XPath and cookie for known domains to speed up extraction. If no stored data exists or the stored data fails, it falls back to a discovery process that uses an LLM (via OpenRouter) to suggest potential XPaths based on the page's HTML structure and content snippets. It also includes logic to handle DataDome CAPTCHAs using 2Captcha.

## Configuration

Configuration is primarily done via environment variables loaded from a `.env` file.

- `OPENROUTER_API_KEY`: Your API key for OpenRouter.
- `LLM_MODEL`: The LLM model to use from OpenRouter (e.g., `openai/gpt-4o`).
- `EXECUTABLE_PATH`: Path to the Chrome/Chromium executable (e.g., `/usr/bin/google-chrome-stable`).
- `EXTENSION_PATHS`: (Optional) Comma-separated paths to browser extensions to load.
- `TWOCAPTCHA_API_KEY`: Your API key for 2Captcha. Required if any domains in `DADADOME_DOMAINS` are listed.
- `MY_HTTP_PROXY`: The proxy URL string (e.g., `http://user:pass@host:port`). Required.
- `SAVE_HTML_ON_FAILURE`: Set to `true` to save the HTML content of pages that cause critical failures.
- `SAVE_HTML_ON_SUCCESS_NAV`: Set to `true` to save the HTML content of pages after successful navigation but before extraction attempts.
- `DEBUG`: Set to `true` to enable verbose debug logging.

## Storage (`site_storage.json`)

The script maintains a `site_storage.json` file to store discovered XPaths and DataDome cookies for specific domains. This allows subsequent requests to the same domain to bypass the discovery process and potentially CAPTCHA challenges.

The structure is a JSON object where keys are normalized domain names (e.g., `wsj.com`), and values are objects containing:
- `xpath`: The last successfully used XPath for the domain.
- `cookie_name`: The name of the DataDome cookie.
- `cookie_value`: The value of the DataDome cookie.

## Execution Flow

The core logic resides in the `getContent(url)` function. The process follows these steps:

