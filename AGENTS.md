# AGENTS.md - SmartScraper

## Scope

This file adds SmartScraper-specific rules on top of the global
`~/.dotfiles/opencode/AGENTS.md` baseline.

- Treat `/home/chuck/git/smartScraper` as the project root.
- This is a single TypeScript project, not a monorepo.
- For source-code patterns, also read `src/AGENTS.md` before editing files under
  `src/`.

## Project Snapshot

- **Stack**: TypeScript, Hono, Puppeteer, Nix, Vitest.
- **Architecture**: Ports and adapters, also called hexagonal architecture.
- **Entry point**: `src/index.ts`.
- **Configuration**: `src/config.ts`.
- **Core scraper**: `src/core/engine.ts`.

## Required Workflow

Before starting work:

1. Read `.justfile`; it is the source of truth for project commands.
2. Read `/home/chuck/.dotfiles/opencode/BEADS.md`.
3. Use Beads for issue tracking. Do not use native todo lists.
4. Inspect existing Beads work before creating a new issue.
5. Claim or create the Beads issue for the task before editing files.

Session completion requires:

1. `git status`
2. `git add <files>`
3. `git commit -m "<conventional commit message>"`
4. `git push`

Work is not complete until `git push` succeeds.

## Commands

Run project commands through the Nix dev shell:

```bash
nix develop --command <command>
```

Root commands:

```bash
just dev          # Development with secrets loaded
just build        # Build TypeScript
just check        # Typecheck
just test         # Run tests through the Go orchestrator
just test-urls    # E2E tests against real URLs
```

## Code Style

- TypeScript strict mode is enabled.
- Modules use ESM with `"type": "module"`.
- Target runtime is ES2022 with NodeNext resolution.
- Formatting is handled by Prettier through the Nix dev shell.
- Match the existing local style before introducing a new pattern.

## Versioning

- After each code change, bump the patch version in `package.json`.
- Example: `0.1.90` becomes `0.1.91`.
- This is required for code changes, including small fixes.

## Commits

- Use conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`,
  `test:`, or `docs:`.
- Reference Beads issues when the commit is tied to an issue.

## Runtime Model

- `CONCURRENCY` controls scrape concurrency.
- Default concurrency is `1`.
- Maximum concurrency is `20`.
- Queue management uses `PQueue` with `concurrency: N`.
- Each scrape gets a fresh browser instance.
- Browser launch, scrape, and cleanup must be paired.
- Browser and temporary profile cleanup belongs in `finally`.
- Plan for about 400 MB of memory per concurrent browser.

## Dashboard Rules

- Dashboard uses HTMX and the HTMX SSE extension.
- Escape user-provided data in SSE fragments with `escapeHtml()`.
- SSE streams must include a `: keepalive\n\n` heartbeat every 30 seconds.
- Do not use inline JavaScript such as `onclick` or `<script>`.
- Prefer HTMX attributes for dashboard behavior.

## Security

Never commit:

- API tokens or keys.
- `.env` files, except `.env.example`.
- Decrypted `secrets.yaml`.

Secrets:

- Development uses SOPS-encrypted `secrets.yaml`, decrypted by `just dev`.
- Production uses the NixOS `sops-nix` module.
- Runtime configuration comes from environment variables.

## Architecture Map

```text
src/ports/       Interfaces: BrowserPort, LlmPort, CaptchaPort, KnownSitesPort
src/adapters/    Implementations: Puppeteer, OpenRouter, TwoCaptcha, filesystem
src/core/        Business logic: engine.ts, scoring.ts
src/domain/      Domain models
src/routes/      HTTP endpoints: API and dashboard
src/middleware/  Auth, rate limiting, CSRF protection
src/components/  Hono JSX UI
src/services/    Stats and log services
src/utils/       Utilities
```

## Branches

- `main` is the default branch.
- Use `feat/<description>` or `fix/<description>` for feature branches.

## Definition of Done

Before submitting a PR:

1. `just check`
2. `just test`
3. `just build`
4. Confirm the diff contains no tokens or keys.

## Project References

- ADRs: `docs/adr/*.md`.
- Configuration guide: `docs/CONFIGURATION.md`.
- Commands: `.justfile`.
