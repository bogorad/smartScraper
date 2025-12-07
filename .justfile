# SmartScraper v0.1.5

default:
    @just --list

# Development
dev:
    #!/usr/bin/env bash
    set -e
    eval "$(sops decrypt secrets.yaml --output-type=json | jq -r '.api_keys // {} | "export API_TOKEN=" + (.smart_scraper // "" | @sh), "export OPENROUTER_API_KEY=" + (.openrouter // "" | @sh), "export TWOCAPTCHA_API_KEY=" + (.twocaptcha // "" | @sh)')"
    npm run dev

build:
    npm run build

start:
    npm start

# Type checking and linting
check:
    npm run typecheck

# Install dependencies
install:
    npm install

# Clean build artifacts
clean:
    rm -rf dist node_modules

# Full rebuild
rebuild: clean install build

