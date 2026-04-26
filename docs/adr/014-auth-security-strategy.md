# 14. Authentication Security Strategy

## Context

The SmartScraper application provides a dashboard and API that need to be secured. 
We rely on a single API Token for both API access (Bearer token) and Dashboard access (Session cookie).

We faced challenges with:
1.  Handling secrets in development vs production.
2.  Managing `Secure` cookies in mixed environments (Localhost HTTP vs Production HTTPS).
3.  Injecting secrets into the application runtime.

## Decision

### 1. Secret Management
We use `sops` with `secrets.yaml` to encrypt local development secrets.
- **Development**: A `just dev` recipe decrypts secrets on-the-fly and injects them as environment variables.
- **Production**: Secrets should be provided via environment variables from the deployment secret manager.

### 2. Authentication Flow
- **API**: Stateless `Authorization: Bearer <token>` header check.
- **Dashboard**: Session-based auth using an `ss_session` cookie.
    - The cookie contains a hash of the API token signed with a session secret.
    - The "session secret" is derived from the API token itself (deterministic), eliminating the need for a separate session store or random secret management for this simple single-tenant app.

### 3. Cookie Security
To support both local development (often HTTP) and production (HTTPS) without manual configuration toggles, we implement adaptive cookie security:
- **Rule**: `secure: true` (HTTPS only) is enforced when `NODE_ENV=production` and either:
    - the request host is not a local loopback address (`localhost`, `127.0.0.1`, `0.0.0.0`), or
    - `TRUST_PROXY_HEADERS=true` and the trusted reverse proxy reports `X-Forwarded-Proto=https`.
- **Impact**: 
    - Developers can run the "production" build locally on HTTP without auth failing.
    - Reverse-proxy deployments make HTTPS cookie behavior explicit by enabling trusted proxy headers only after the proxy strips untrusted forwarded headers.

### 4. Configuration Loading
Configuration is centralized in `src/config.ts`. It loads:
- Environment variables and `.env`.
- Validation via Zod schema.

The application runtime does not parse `secrets.yaml`; development wrappers
decrypt that file before process startup and export environment variables.

## Status

Accepted

## Consequences

- **Positive**: "It just works" developer experience; secure by default in production; no need for complex `.env` file management for secrets.
- **Negative**: The "local detection" logic in `createSession` is a slight deviation from strict "config-driven" behavior, but provides significant usability benefits.
