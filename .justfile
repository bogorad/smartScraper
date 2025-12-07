# SmartScraper v0.1.16

default:
    @just --list

# Development
dev:
    #!/usr/bin/env bash
    set -e
    eval "$(sops decrypt secrets.yaml --output-type=json | jq -r 'to_entries | .[] | "export " + (.key | ascii_upcase) + "=" + (.value | @sh)')"
    LOG_LEVEL=DEBUG NODE_ENV=development npm run dev

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

