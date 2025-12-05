# SmartScraper v0.1.5

default:
    @just --list

# Development
dev:
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

# Git shortcuts
status:
    git status

diff:
    git diff

log:
    git log --oneline -10

# Commit and push
push message:
    git add -A && git commit -m "{{message}}" && git push

# Health check
health:
    curl -s http://localhost:5555/health | jq

# Test scrape (markdown output)
scrape url:
    curl -s -X POST http://localhost:5555/api/scrape \
        -H "Authorization: Bearer $(sops decrypt secrets.yaml --output-type=json | jq -r '.api_keys.smart_scraper')" \
        -H "Content-Type: application/json" \
        -d '{"url": "{{url}}", "outputType": "markdown"}' | jq

# Test scrape (plain text)
scrape-text url:
    curl -s -X POST http://localhost:5555/api/scrape \
        -H "Authorization: Bearer $(sops decrypt secrets.yaml --output-type=json | jq -r '.api_keys.smart_scraper')" \
        -H "Content-Type: application/json" \
        -d '{"url": "{{url}}", "outputType": "content_only"}' | jq

# Test scrape with debug and xpath override
scrape-debug url xpath="//body":
    curl -s -X POST http://localhost:5555/api/scrape \
        -H "Authorization: Bearer $(sops decrypt secrets.yaml --output-type=json | jq -r '.api_keys.smart_scraper')" \
        -H "Content-Type: application/json" \
        -d '{"url": "{{url}}", "outputType": "markdown", "xpath": "{{xpath}}", "debug": true}' | jq

# Show version
version:
    @grep '"version"' package.json | head -1 | cut -d'"' -f4

# Bump patch version
bump:
    #!/usr/bin/env bash
    current=$(grep '"version"' package.json | head -1 | cut -d'"' -f4)
    IFS='.' read -r major minor patch <<< "$current"
    new="$major.$minor.$((patch + 1))"
    sed -i "s/\"version\": \"$current\"/\"version\": \"$new\"/" package.json
    sed -i "s/VERSION = '$current'/VERSION = '$new'/" src/constants.ts
    echo "Bumped $current -> $new"

# Show site count
sites:
    @jq length data/sites.jsonc

# Show stats
stats:
    @cat data/stats.json | jq
