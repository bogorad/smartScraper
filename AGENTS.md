# AGENTS.md - SmartScraper

## Project Snapshot

- **Type**: Single TypeScript project (not monorepo)
- **Stack**: TypeScript + Hono + Puppeteer + Nix + Vitest
- **Architecture**: Ports & Adapters (Hexagonal)
- **Sub-guides**: See [src/AGENTS.md](src/AGENTS.md) for detailed source code patterns

---

## Root Setup Commands

```bash
# Install dependencies
npm install

# Development (hot reload)
npm run dev
# Or with secrets loaded:
just dev

# Build
npm run build

# Typecheck
npm run typecheck

# Run tests
npm test

# Production start
npm start
```

---

## Universal Conventions

### Code Style
- **TypeScript**: Strict mode enabled (`strict: true`)
- **Modules**: ESM (`"type": "module"`)
- **Target**: ES2022 / NodeNext
- **Formatting**: Prettier (via Nix devShell)

### Commits
- Use conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`
- Reference issues when applicable

### Versioning
- **AFTER EACH CODE CHANGE**: Bump patch version in `package.json` (`xx.yy.zz` → `xx.yy.zz+1`)
- Version bump is mandatory even for small fixes
- Update `CHANGELOG.md` if it exists

### Concurrency & Performance
- **Default Concurrency**: 5 parallel scrapes
- **Queue Management**: Use `PQueue` in `CoreScraperEngine`
- **Resource Cleanup**: Use `closePage(pageId)` for per-scrape browser cleanup; only close the whole browser on shutdown
- **Tracking**: Use unique `scrapeId` (Map) instead of URLs (Set) to allow multiple concurrent scrapes of the same URL

### Dashboard Interactivity (HTMX + SSE)
- **Real-time Updates**: Use HTMX SSE extension for server-push (e.g., workers status)
- **Named Events**: Use `event: <name>` in SSE stream and `sse-swap="<name>"` in HTML
- **OOB Swaps**: Prefer `hx-swap-oob="true"` for granular multi-element updates via SSE
- **Security**: Always use `escapeHtml()` when rendering user-provided data (like URLs) into SSE HTML fragments
- **Keepalive**: SSE streams must include a `: keepalive\n\n` heartbeat (every 30s) to prevent proxy timeouts
- **Fallbacks**: Dashboard body uses `hx-trigger="every 300s"` as a safety auto-refresh
- **No Inline JS**: Use HTMX attributes (`hx-post`, `hx-confirm`, etc.) instead of `onclick` or `<script>` blocks

### Branch Strategy
- `main` is the default branch
- Feature branches: `feat/description` or `fix/description`

### PR Requirements
- All typechecks pass: `npm run typecheck`
- All tests pass: `npm test`
- Build succeeds: `npm run build`

---

## Security & Secrets

### NEVER commit:
- API tokens or keys
- `.env` files (only `.env.example`)
- Decrypted `secrets.yaml`

### Secrets Management
- **Development**: SOPS-encrypted `secrets.yaml` (decrypted via `just dev`)
- **Production**: NixOS sops-nix module
- **Pattern**: Environment variables loaded at runtime (`API_TOKEN`, `OPENROUTER_API_KEY`, `TWOCAPTCHA_API_KEY`)

### Env Files
- `.env.example` - Template with all options documented
- `.env` - Local secrets (gitignored)
- `secrets.yaml` - SOPS-encrypted secrets for team/deployment

---

## JIT Index (what to open, not what to paste)

### Package Structure
- Source code: `src/` → [see src/AGENTS.md](src/AGENTS.md)
- Documentation: `docs/` → ADRs at `docs/adr/*.md`
- Configuration: `docs/CONFIGURATION.md`

### Architecture Layers
```
src/ports/       # Interfaces (BrowserPort, LlmPort, CaptchaPort, KnownSitesPort)
src/adapters/    # Implementations (puppeteer, openrouter, twocaptcha, fs)
src/core/        # Business logic (engine.ts, scoring.ts)
src/domain/      # Domain models (models.ts)
src/routes/      # HTTP endpoints (api/, dashboard/)
src/components/  # Hono JSX UI
src/services/    # App services (stats, logs)
src/utils/       # Utilities
```

### Quick Find Commands
```bash
# Find a function definition
rg -n "export (async )?function \w+" src/

# Find a class
rg -n "export class \w+" src/

# Find a type/interface
rg -n "export (interface|type) \w+" src/

# Find route handlers
rg -n "app\.(get|post|put|delete)\(" src/routes/

# Find tests
find src -name "*.test.ts"

# Find port interfaces
rg -n "export interface \w+Port" src/ports/

# Find adapters
rg -n "export class \w+Adapter" src/adapters/
```

### Key Entry Points
- `src/index.ts` - Application entry point
- `src/config.ts` - Centralized configuration
- `src/constants.ts` - Application constants
- `src/core/engine.ts` - Core scraping logic

---

## Definition of Done

Before submitting a PR:

1. `npm run typecheck` - No type errors
2. `npm test` - All tests pass
3. `npm run build` - Build succeeds
4. Secrets checked - No tokens/keys in diff

Single command:
```bash
npm run typecheck && npm test && npm run build
```

---

## Additional Resources

- **ADRs**: `docs/adr/README.md` - Architecture decisions explained
- **Config Guide**: `docs/CONFIGURATION.md` - All environment variables
- **Nix Setup**: `flake.nix` - Dev shell and NixOS module
- **Just Commands**: `.justfile` - Common dev tasks
