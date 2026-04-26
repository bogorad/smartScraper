# SmartScraper Configuration & Secrets Management

This document provides comprehensive information on configuring SmartScraper, including environment variables, secrets management, and configuration validation.

## Overview

SmartScraper uses a **centralized configuration system** with the following features:

- **Single Source of Truth**: All configuration is managed through `src/config.ts`
- **Zod Validation**: All config is validated at startup with clear error messages
- **Multiple Sources**: Support for `.env` files, `secrets.yaml`, and environment variables
- **Secret Protection**: Secrets are never logged or exposed in error messages
- **Backward Compatibility**: Legacy environment variable names are supported

## Configuration Module Architecture

The `src/config.ts` module:
1. Loads `.env` file automatically via dotenv
2. Attempts to load `secrets.yaml` for sensitive data
3. Maps environment variable names (supporting legacy names)
4. Applies runtime defaults from `src/constants.ts`
5. Validates all config against Zod schema at startup
6. Provides typed getter functions for accessing config throughout the app

### Direct process.env Usage - REMOVED

❌ **BEFORE**: Direct `process.env` calls throughout the codebase
```typescript
// OLD - Don't do this
const port = Number(process.env.PORT) || 5555;
const apiKey = process.env.OPENROUTER_API_KEY || '';
```

✅ **AFTER**: Centralized config module
```typescript
// NEW - Use the config module
import { getPort, getOpenrouterApiKey } from './config.js';
const port = getPort();
const apiKey = getOpenrouterApiKey();
```

Files updated to use the centralized config:
- `src/index.ts` - Server startup configuration
- `src/adapters/puppeteer-browser.ts` - Browser executable, extensions, proxy
- `src/adapters/openrouter-llm.ts` - LLM API credentials and settings
- `src/adapters/twocaptcha.ts` - CAPTCHA solver configuration
- `src/adapters/fs-known-sites.ts` - Data directory
- `src/services/log-storage.ts` - Data directory
- `src/services/stats-storage.ts` - Data directory
- `src/middleware/auth.ts` - API token and NODE_ENV

## Configuration Sources

### 1. Environment Variables (Highest Priority)

Set configuration via shell environment or `.env` file:

```bash
export PORT=5555
export OPENROUTER_API_KEY=sk-...
export TWOCAPTCHA_API_KEY=xxx
npm start
```

### 2. .env File

Automatically loaded on startup (if it exists):

```bash
cp .env.example .env
# Edit .env with your values
npm run dev
```

### 3. secrets.yaml File

For encrypted sensitive data:

```yaml
api_keys:
  smart_scraper: "your_api_token"
  openrouter: "your_openrouter_key"
  twocaptcha: "your_2captcha_key"
  datadome_proxy_host: "host:port"
  datadome_proxy_login: "proxy_login"
  datadome_proxy_password: "proxy_password"
  victorialogs_otlp_endpoint: "http://victorialogs:9428/insert/opentelemetry/v1/logs"
  victorialogs_otlp_headers: "X-Scope=prod"
  victorialogs_otlp_auth_header_name: "Authorization"
  victorialogs_otlp_auth_header_value: "Bearer token"
```

Flat `secrets.yaml` keys are also supported for these same secret names:
`smart_scraper`, `openrouter`, `twocaptcha`, `datadome_proxy_host`,
`datadome_proxy_login`, `datadome_proxy_password`,
`victorialogs_otlp_endpoint`, `victorialogs_otlp_headers`,
`victorialogs_otlp_auth_header_name`, and
`victorialogs_otlp_auth_header_value`.

Can be encrypted with sops:
```bash
sops secrets.yaml
```

### 4. Default Values (Lowest Priority)

Sensible defaults for non-critical configuration are defined in `src/constants.ts`, consumed by `src/config.ts`, and mirrored in `.env.example` for operators.

## Configuration Reference

### Server Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PORT` | number | 5555 | Server listen port |
| `NODE_ENV` | enum | production | Environment (development/production) |
| `DATA_DIR` | string | ./data | Data storage directory |

### LLM Configuration (OpenRouter)

| Variable | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| `OPENROUTER_API_KEY` | string | '' | Yes* | OpenRouter API key for LLM features |
| `LLM_MODEL` | string | meta-llama/llama-4-maverick:free | No | LLM model identifier |
| `LLM_TEMPERATURE` | number | 0 | No | LLM response temperature (0-2) |
| `LLM_HTTP_REFERER` | string | https://github.com/bogorad/smartScraper | No | HTTP Referer header |
| `LLM_X_TITLE` | string | SmartScraper | No | X-Title header |

*Required if using LLM-assisted XPath discovery

### Browser Configuration (Puppeteer)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `EXECUTABLE_PATH` | string | /usr/lib/chromium/chromium | Chrome/Chromium executable path |
| `EXTENSION_PATHS` | string | '' | Comma-separated browser extension paths |
| `PROXY_SERVER` | string | '' | HTTP proxy URL for scraping |

**Legacy Names Supported:**
- `PUPPETEER_EXECUTABLE_PATH` → `EXECUTABLE_PATH`
- `HTTP_PROXY` → `PROXY_SERVER`

### CAPTCHA Configuration

| Variable | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| `TWOCAPTCHA_API_KEY` | string | '' | Yes* | 2Captcha API key |
| `CAPTCHA_DEFAULT_TIMEOUT` | number | 120 | No | CAPTCHA solving timeout (seconds) |
| `CAPTCHA_POLLING_INTERVAL` | number | 5000 | No | Polling interval (milliseconds) |

*Required if scraping sites with CAPTCHAs

### DataDome Proxy Secrets

| Variable | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| `DATADOME_PROXY_HOST` | string | '' | Yes* | Residential proxy host and port |
| `DATADOME_PROXY_LOGIN` | string | '' | Yes* | Proxy login without generated session suffixes |
| `DATADOME_PROXY_PASSWORD` | string | '' | Yes* | Proxy password |

*Required when a site is configured with `needsProxy: "datadome"`.

These values can be loaded from environment variables, flat `secrets.yaml`
keys, or nested `api_keys.*` keys.

### Authentication

| Variable | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| `API_TOKEN` | string | '' | Yes | API authentication token |

Can be loaded from `secrets.yaml` (`smart_scraper` or `api_keys.smart_scraper`) or environment variable.

### Logging & Debug

| Variable | Type | Default | Options | Description |
|----------|------|---------|---------|-------------|
| `LOG_LEVEL` | enum | INFO | DEBUG, INFO, WARN, ERROR, NONE | Application log level |
| `SAVE_HTML_ON_SUCCESS_NAV` | boolean | false | - | Save HTML snapshots on success |

Debug features (enabled when `LOG_LEVEL=DEBUG`):
- Verbose logging
- HTML snapshots on errors/success
- Detailed error messages

### VictoriaLogs OTLP Logging

| Variable | Type | Default | Secret | Description |
|----------|------|---------|--------|-------------|
| `VICTORIALOGS_OTLP_ENABLED` | boolean | false | No | Enable OTLP log export |
| `VICTORIALOGS_OTLP_ENDPOINT` | string | '' | Yes | OTLP/HTTP logs endpoint |
| `VICTORIALOGS_OTLP_HEADERS` | string | '' | Yes | Extra headers as JSON or comma-separated entries |
| `VICTORIALOGS_OTLP_AUTH_HEADER_NAME` | string | '' | Yes | Optional auth header name |
| `VICTORIALOGS_OTLP_AUTH_HEADER_VALUE` | string | '' | Yes | Optional auth header value |
| `VICTORIALOGS_OTLP_STREAM_FIELDS` | string | '' | No | Value for the `VL-Stream-Fields` header |
| `VICTORIALOGS_OTLP_TIMEOUT_MS` | number | 10000 | No | Export timeout in milliseconds |
| `VICTORIALOGS_OTLP_BATCH_DELAY_MS` | number | 5000 | No | Batch delay in milliseconds |
| `VICTORIALOGS_OTLP_MAX_QUEUE_SIZE` | number | 2048 | No | Max pending log records |
| `VICTORIALOGS_OTLP_MAX_EXPORT_BATCH_SIZE` | number | 512 | No | Max records per export batch |

VictoriaLogs secret fields can be loaded from environment variables, flat
`secrets.yaml` keys, or nested `api_keys.*` keys. Runtime switches and
batching values stay in environment variables or `.env`.

### DOM Structure Extraction (Advanced)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DOM_STRUCTURE_MAX_TEXT_LENGTH` | number | 15 | Max text length in DOM dumps |
| `DOM_STRUCTURE_MIN_TEXT_SIZE_TO_ANNOTATE` | number | 100 | Min text size for annotations |

## Setup Examples

### Development (Using .env)

```bash
# 1. Copy example file
cp .env.example .env

# 2. Edit with your values
# Minimal setup for testing:
API_TOKEN=my-test-token-12345
OPENROUTER_API_KEY=sk-or-v1-xxx
TWOCAPTCHA_API_KEY=xxx

# 3. Run
npm run dev
```

### Docker Production

```dockerfile
FROM node:24-slim

WORKDIR /app
COPY . .
RUN npm ci --only=production

# Load secrets from Docker secrets
ENV PORT=5555
ENV DATA_DIR=/data

# Docker will mount secrets to /run/secrets/
CMD ["node", "dist/index.js"]
```

Provide secrets via Docker:
```bash
docker run -e OPENROUTER_API_KEY=$KEY \
           -e TWOCAPTCHA_API_KEY=$KEY2 \
           -e API_TOKEN=$TOKEN \
           smart-scraper
```

### Kubernetes with sops

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: smart-scraper-secrets
type: Opaque
stringData:
  api_token: "your-token"
  openrouter_api_key: "your-key"
  twocaptcha_api_key: "your-key"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: smart-scraper
spec:
  template:
    spec:
      containers:
      - name: smart-scraper
        image: smart-scraper:latest
        env:
        - name: PORT
          value: "5555"
        - name: API_TOKEN
          valueFrom:
            secretKeyRef:
              name: smart-scraper-secrets
              key: api_token
        - name: OPENROUTER_API_KEY
          valueFrom:
            secretKeyRef:
              name: smart-scraper-secrets
              key: openrouter_api_key
        - name: TWOCAPTCHA_API_KEY
          valueFrom:
            secretKeyRef:
              name: smart-scraper-secrets
              key: twocaptcha_api_key
```

## Configuration Validation

The application validates all configuration at startup using Zod schemas. If validation fails, you'll see a clear error message:

```
[CONFIG] Validation failed:
openrouterApiKey: String must contain at least 1 character(s)
```

**Why validate at startup?**
- Fail fast with clear errors
- No silent failures in production
- All required config visible in one place
- Type-safe throughout the application

## Secrets Security Best Practices

### ✅ DO

- Use `secrets.yaml` with sops encryption in production
- Set sensitive variables via Docker secrets or Kubernetes vault
- Use strong, randomly generated tokens
- Rotate keys periodically
- Store `.env` in `.gitignore` (already done)

### ❌ DON'T

- Commit `.env` or `secrets.yaml` to version control
- Log or print configuration values
- Use the same token across environments
- Hardcode secrets in the code
- Share API keys in documentation

### Error Messages Don't Expose Secrets

Even with verbose error logging, secrets are never exposed:

```typescript
// ✅ Good - Field name only, no value
[CONFIG] Validation failed: openrouterApiKey: String must contain at least 1 character

// ❌ Bad - Would expose secret (doesn't happen)
// [CONFIG] Failed to validate sk-or-v1-1234567890abc123def...
```

## Migration from Legacy Variable Names

If you have existing configuration using old variable names:

| Old Name | New Name | What to do |
|----------|----------|-----------|
| `PUPPETEER_EXECUTABLE_PATH` | `EXECUTABLE_PATH` | Still works, update to new name |
| `HTTP_PROXY` | `PROXY_SERVER` | Still works, update to new name |

The config module automatically detects legacy names and uses them as fallback, but you should migrate to the new names in your configuration.

### Migration Steps

1. **Identify old variables in your setup:**
   ```bash
   grep -E "PUPPETEER_EXECUTABLE_PATH|HTTP_PROXY" .env
   ```

2. **Update to new names:**
   ```env
   # OLD
   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
   HTTP_PROXY=http://proxy:8080

   # NEW
   EXECUTABLE_PATH=/usr/bin/chromium
   PROXY_SERVER=http://proxy:8080
   ```

3. **Verify it works:**
   ```bash
   npm run typecheck
   npm run build
   npm start
   ```

## Troubleshooting Configuration Issues

### "Configuration validation failed"

**Check:**
1. Required variables are set (API_TOKEN, OPENROUTER_API_KEY)
2. Type conversions are valid (PORT should be a number)
3. Enum values are correct (NODE_ENV must be 'development' or 'production')

### "API token not configured on server"

**Check:**
1. API_TOKEN is set in `.env`, environment, or `secrets.yaml`
2. `secrets.yaml` has a supported flat key such as `smart_scraper` or nested key such as `api_keys.smart_scraper`
3. Secrets.yaml is readable (check file permissions)

### "Chromium executable not found"

**Check:**
1. EXECUTABLE_PATH points to existing Chrome/Chromium binary
2. Binary is executable: `chmod +x /path/to/chromium`
3. Try common paths:
   - Linux: `/usr/lib/chromium/chromium`, `/usr/bin/chromium`
   - macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
   - Windows: `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe`

### LLM features not working

**Check:**
1. OPENROUTER_API_KEY is set and valid
2. API key has sufficient balance
3. LLM_MODEL is a valid OpenRouter model

## Configuration File Locations

```
smart-scraper/
├── .env                    # Runtime environment variables (not in git)
├── .env.example           # Template for configuration
├── secrets.yaml           # Encrypted secrets (not in git)
├── .gitignore             # Prevents committing secrets
├── src/
│   └── config.ts          # Configuration module (source of truth)
├── docs/
│   └── CONFIGURATION.md   # This file
└── README.md              # User-facing configuration guide
```

## Related Files

- **Config Module**: `src/config.ts` - Implementation details
- **Environment Example**: `.env.example` - All available options
- **README Guide**: `README.md` - User-friendly setup guide
- **Git Ignore**: `.gitignore` - Prevents secret commits

## Support

For configuration issues:
1. Check `.env.example` for correct variable names
2. Run `npm run typecheck` to validate TypeScript
3. Check application logs for validation errors
4. Verify secrets are properly loaded from `.env` or `secrets.yaml`
