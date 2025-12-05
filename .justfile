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

