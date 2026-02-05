# SmartScraper v0.1.69

default:
    @just --list

# Development
dev:
    scripts/dev.sh

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

# Update AdBlock Plus extension
adblock:
    scripts/update-adblock.sh

# Clean build artifacts
clean:
    rm -rf dist node_modules

# Full rebuild
rebuild: clean install build

# Test 5 parallel scrapes
test5:
    scripts/test5.sh

# Test basin/reservoir scrape from Catalan government
test-basin:
    scripts/test-basin.sh

# Run tests with parallel workers
test:
    cd test-orchestrator && go run . --workers 4

# Run specific test by pattern
test-file pattern:
    cd test-orchestrator && go run . --workers 1 --file {{pattern}}

# Force full test run (bypass cache)
test-full:
    cd test-orchestrator && go run . --workers 4 --full

# Run e2e tests against URLs from testing/urls_for_testing.txt
test-urls:
    scripts/test-urls.sh

# Clean up orphan processes and cache
test-clean:
    scripts/test-clean.sh
