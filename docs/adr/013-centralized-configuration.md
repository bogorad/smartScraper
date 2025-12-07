# ADR-013: Centralized Configuration and Secrets Management

**Status:** Accepted  
**Date:** 2024-12-07  
**Affected Components:** 
- Core configuration module (`src/config.ts`)
- All adapters and services
- Middleware and route handlers

## Problem Statement

Previously, SmartScraper had environment variables scattered throughout the codebase with inconsistent access patterns:

- ❌ Direct `process.env` calls in multiple files
- ❌ Inconsistent variable naming (e.g., `PUPPETEER_EXECUTABLE_PATH` vs `EXECUTABLE_PATH`)
- ❌ No centralized validation
- ❌ Secrets could be accidentally logged in error messages
- ❌ No clear documentation of required configuration
- ❌ Difficult to maintain as features were added

### Example of the Problem

```typescript
// OLD - scattered throughout codebase
const execPath = process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium';
const apiKey = process.env.OPENROUTER_API_KEY || '';
const timeout = Number(process.env.CAPTCHA_DEFAULT_TIMEOUT) || 120;
// ...repeated in multiple files with no validation
```

## Solution: Centralized Configuration Module

Implement a single, authoritative configuration module using Zod for validation that:

1. **Centralizes all environment variable access**
   - Single source of truth in `src/config.ts`
   - All other code imports from this module

2. **Provides strong typing and validation**
   - Zod schema validates all config at startup
   - Clear error messages for invalid/missing config
   - Type-safe throughout the application

3. **Supports multiple configuration sources**
   - Environment variables (highest priority)
   - `.env` file via dotenv (loaded automatically)
   - `secrets.yaml` for encrypted secrets (via sops)
   - Default values (lowest priority)

4. **Protects secrets**
   - Never logs secret values
   - Error messages show field names only, not values
   - Support for encrypted `secrets.yaml` files

5. **Maintains backward compatibility**
   - Legacy variable names still work
   - Clear deprecation path for users

## Implementation Details

### Configuration Module Structure

```typescript
// src/config.ts

// 1. Load .env file automatically
if (fs.existsSync('.env')) {
  dotenv.config();
}

// 2. Define schema with Zod
const ConfigSchema = z.object({
  port: z.coerce.number().default(5555),
  openrouterApiKey: z.string().default(''),
  // ... all config fields
});

// 3. Load and parse
function loadSecretsFromYaml(): Record<string, string> { /* ... */ }
function mapEnvVars(): Record<string, string | undefined> { /* ... */ }
function parseConfig(): Config { /* ... */ }

// 4. Provide getter functions
export function getConfig(): Config { /* ... */ }
export function getPort(): number { /* ... */ }
export function getOpenrouterApiKey(): string { /* ... */ }
// ... one getter per config value
```

### Configuration Sources (Priority Order)

1. **Environment variables** (highest)
   ```bash
   export OPENROUTER_API_KEY=sk-...
   export PORT=8080
   ```

2. **`.env` file**
   ```env
   OPENROUTER_API_KEY=sk-...
   PORT=8080
   ```

3. **`secrets.yaml`**
   ```yaml
   api_keys:
     openrouter: sk-...
     smart_scraper: token-...
   ```

4. **Default values** (lowest)

### Files Updated

All files using `process.env` have been updated to use the centralized config module:

| File | Changes |
|------|---------|
| `src/index.ts` | Use `getPort()`, `getDataDir()`, `getExecutablePath()` |
| `src/adapters/puppeteer-browser.ts` | Use config getters for browser settings |
| `src/adapters/openrouter-llm.ts` | Use config getters for LLM API keys |
| `src/adapters/twocaptcha.ts` | Use config getters for CAPTCHA settings |
| `src/adapters/fs-known-sites.ts` | Use `getDataDir()` |
| `src/services/log-storage.ts` | Use `getDataDir()` |
| `src/services/stats-storage.ts` | Use `getDataDir()` |
| `src/middleware/auth.ts` | Use config getters for auth |

### Validation at Startup

Configuration is validated at application startup using Zod schemas:

```typescript
// Validation happens automatically when initConfig() is called
// in src/index.ts main() function

// If invalid, you get a clear error message:
[CONFIG] Validation failed:
openrouterApiKey: String must contain at least 1 character(s)
```

This ensures all required configuration is present and correctly typed before the server starts.

### Secrets Protection

Secrets are never exposed in error messages or logs:

```typescript
// ✅ Error messages show field names only
[CONFIG] Validation failed: openrouterApiKey: String required

// ✅ Secrets from YAML are not logged (only error message)
[CONFIG] Failed to load secrets.yaml: ENOENT

// ✅ No secret values in validation errors
if (!result.success) {
  const messages = result.error.errors.map(...) // No values shown
}
```

## Advantages

1. **Single Source of Truth**
   - All configuration in one place
   - Easy to audit and maintain

2. **Type Safety**
   - Full TypeScript support
   - Clear API for accessing config
   - Compile-time checking

3. **Validation at Startup**
   - Fail fast with clear errors
   - No silent failures in production
   - All required config visible upfront

4. **Security**
   - Secrets never logged or exposed
   - Support for encrypted files
   - Clear best practices documented

5. **Documentation**
   - `.env.example` documents all options
   - README has configuration section
   - Comprehensive `docs/CONFIGURATION.md` guide

6. **Backward Compatibility**
   - Legacy variable names still work
   - Smooth migration path for users

## Tradeoffs

| Tradeoff | Reasoning |
|----------|-----------|
| Added dependencies (dotenv, yaml) | Worth it for standard practices, easy to remove if needed |
| Initialization required | `initConfig()` must be called early, but we control startup |
| All config must be strings in env | Zod coercion handles type conversion cleanly |

## Alternatives Considered

1. **Keep current approach (direct process.env)**
   - ❌ No validation, error-prone
   - ❌ Scattered throughout codebase
   - ❌ Poor documentation

2. **Use configuration library like `convict`**
   - ❌ Extra dependency
   - ❌ Less type-safe than Zod
   - ❌ Larger bundle

3. **Environment-specific config files (dev.json, prod.json)**
   - ❌ More complex for single-server app
   - ❌ Harder to use with containers/Kubernetes

## Migration Guide for Users

### For existing users with legacy variable names:

1. **Identify legacy variables:**
   ```bash
   grep -E "PUPPETEER_EXECUTABLE_PATH|HTTP_PROXY" .env
   ```

2. **Update to new names:**
   ```bash
   # OLD
   PUPPETEER_EXECUTABLE_PATH=/path/to/chromium
   HTTP_PROXY=http://proxy:8080

   # NEW
   EXECUTABLE_PATH=/path/to/chromium
   PROXY_SERVER=http://proxy:8080
   ```

3. **Legacy names still work** during transition period

### For new users:

Use the new variable names from `.env.example` and documentation.

## Testing

Configuration is tested by:
1. TypeScript type checking (`npm run typecheck`)
2. Build verification (`npm run build`)
3. Schema validation at startup
4. Integration with all adapters and services

## Dependencies Added

- `dotenv` - Load `.env` file automatically
- `yaml` - Parse YAML for secrets.yaml support

Both are lightweight, widely-used, and industry-standard libraries.

## Related Documentation

- **User Guide:** `README.md` - Configuration & Secrets section
- **Configuration Reference:** `docs/CONFIGURATION.md` - Comprehensive guide
- **Example Config:** `.env.example` - All available options with descriptions
- **Implementation:** `src/config.ts` - Source code with comments

## Future Enhancements

Possible future improvements (out of scope for this ADR):

- [ ] Configuration reload without restart
- [ ] Admin UI for managing secrets
- [ ] Automatic secrets rotation
- [ ] Environment variable templates (e.g., for Kubernetes)

## References

- [Zod Documentation](https://zod.dev/) - Schema validation
- [dotenv Documentation](https://github.com/motdotla/dotenv) - .env loading
- [YAML Specification](https://yaml.org/) - secrets.yaml format
- [The Twelve-Factor App](https://12factor.net/config) - Configuration best practices
