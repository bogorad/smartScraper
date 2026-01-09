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

# Test 5 parallel scrapes
test5:
    #!/usr/bin/env bash
    set -e
    eval "$(sops decrypt secrets.yaml --output-type=json | jq -r 'to_entries | .[] | "export " + (.key | ascii_upcase) + "=" + (.value | @sh)')"
    echo "Running 5 parallel scrapes of example.com..."
    echo "---"
    for i in 1 2 3 4 5; do
      (curl -s -X POST "http://localhost:5555/api/scrape" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $SMART_SCRAPER" \
        -d '{"url": "https://example.com", "xpath": "//body"}' | \
        jq -c '{scrape: '$i', success, method, data: (.data // "" | .[0:80])}') &
    done
    wait
    echo "---"
    echo "All 5 scrapes completed"
