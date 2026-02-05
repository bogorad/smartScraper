# AGENTS.md - SmartScraper

## Project Snapshot

- **Type**: Single TypeScript project (not monorepo)
- **Stack**: TypeScript + Hono + Puppeteer + Nix + Vitest
- **Architecture**: Ports & Adapters (Hexagonal)
- **Sub-guides**: See [src/AGENTS.md](src/AGENTS.md) for detailed source code patterns

---

## Justfile is THE source of truth, beads is your issus tracker

Before attempting ANYTHING check the .justfile, it might contain guidance.
Before acting, checkout/create beads issue, consult beads for all actions.

## Root Setup Commands

```bash
just dev          # Development with secrets loaded
just build        # Build TypeScript
just check        # Typecheck
just test         # Run tests (Go orchestrator)
just test-urls    # E2E tests against real URLs
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

### Concurrency & Performance

- **Execution Model**: Configurable concurrency via `CONCURRENCY` env var (default: 1, max: 20)
- **Queue Management**: `PQueue` with `concurrency: N`
- **Browser Lifecycle**: Fresh browser instance per scrape; launch → scrape → destroy
- **Resource Cleanup**: Browser and temp profile destroyed in `finally` block
- **Memory Planning**: ~400MB per concurrent browser; size server accordingly

### Dashboard (HTMX + SSE)

- **Real-time Updates**: HTMX SSE extension for server-push
- **Security**: Always use `escapeHtml()` for user-provided data in SSE fragments
- **Keepalive**: SSE streams include `: keepalive\n\n` heartbeat (every 30s)
- **No Inline JS**: Use HTMX attributes, not `onclick` or `<script>`

### Branch Strategy

- `main` is the default branch
- Feature branches: `feat/description` or `fix/description`

### Development Commands

- Use `nix develop --command <command>` to run commands with the devShell environment

---

## Security & Secrets

### NEVER commit:

- API tokens or keys
- `.env` files (only `.env.example`)
- Decrypted `secrets.yaml`

### Secrets Management

- **Development**: SOPS-encrypted `secrets.yaml` (decrypted via `just dev`)
- **Production**: NixOS sops-nix module
- **Pattern**: Environment variables loaded at runtime

---

## Architecture Layers

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

### Key Entry Points

- `src/index.ts` - Application entry point
- `src/config.ts` - Centralized configuration
- `src/core/engine.ts` - Core scraping logic

---

## Definition of Done

Before submitting a PR:

1. `just check` - No type errors
2. `just test` - All tests pass
3. `just build` - Build succeeds
4. No tokens/keys in diff

---

## Additional Resources

- **ADRs**: `docs/adr/*.md` - Architecture decisions
- **Config Guide**: `docs/CONFIGURATION.md`
- **Just Commands**: `.justfile`

---

## Session Completion

**Work is NOT complete until `git push` succeeds.**

```bash
git status              # Check changes
bd sync                 # Sync beads
git add <files>
git commit -m "..."
git push
```

---

## Beads Workflow

Issue tracking via [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer). Issues stored in `.beads/`.

### Commands

```bash
bd ready              # Show ready issues
bd list --status=open # All open issues
bd show <id>          # Issue details
bd create --title="..." --type=task --priority=2 --description="..."
bd update <id> --status=in_progress
bd close <id> --reason="..."
bd sync               # Commit beads changes
```

### Workflow

1. `bd ready` → find work
2. `bd update <id> --status=in_progress` + `bd sync --flush-only`
3. Implement
4. `bd close <id>` + `bd sync --flush-only`
5. `bd sync` at session end
