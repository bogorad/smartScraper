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

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**

- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

<!-- bv-agent-instructions-v1 -->

---

## Beads Workflow Integration

This project uses [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) for issue tracking. Issues are stored in `.beads/` and tracked in git.

### Essential Commands

```bash
# View issues (launches TUI - avoid in automated sessions)
bv

# CLI commands for agents (use these instead)
bd ready              # Show issues ready to work (no blockers)
bd list --status=open # All open issues
bd show <id>          # Full issue details with dependencies
bd create --title="..." --type=task --priority=2
bd update <id> --status=in_progress
bd close <id> --reason="Completed"
bd close <id1> <id2>  # Close multiple issues at once
bd sync               # Commit and push changes
```

### Workflow Pattern

1. **Start**: Run `bd ready` to find actionable work
2. **Claim**: Use `bd update <id> --status=in_progress` and immediately `bd sync --flush-only` to that `bv` can monitor
3. **Work**: Implement the task
4. **Complete**: Use `bd close <id>` and immediately `bd sync --flush-only` to that `bv` can monitor
5. **Sync**: Always run `bd sync` at session end

### Key Concepts

- **Dependencies**: Issues can block other issues. `bd ready` shows only unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers, not words)
- **Types**: task, bug, feature, epic, question, docs
- **Blocking**: `bd dep add <issue> <depends-on>` to add dependencies

### Session Protocol

**Before ending any session, run this checklist:**

```bash
git status              # Check what changed
git add <files>         # Stage code changes
bd sync                 # Commit beads changes
git commit -m "..."     # Commit code
bd sync                 # Commit any new beads changes
git push                # Push to remote
```

### Best Practices

- Check `bd ready` at session start to find available work
- Update status as you work (in_progress → closed)
- Create new issues with `bd create` when you discover tasks
- Use descriptive titles and set appropriate priority/type
- Always supply --desrciption, containing a verbose issue description and an action plan
- Always `bd sync` before ending session

<!-- end-bv-agent-instructions -->
