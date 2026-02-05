# SmartScraper v0.1.68

default:
    @just --list

# Development
dev:
    #!/usr/bin/env bash
    if ! sops decrypt secrets.yaml --output-type=json > /dev/null 2>&1; then
        echo "Error: Failed to decrypt secrets.yaml"
        exit 1
    fi
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
    #!/usr/bin/env bash
    if ! sops decrypt secrets.yaml --output-type=json > /dev/null 2>&1; then
        echo "Error: Failed to decrypt secrets.yaml"
        exit 1
    fi
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

# Test basin/reservoir scrape from Catalan government
test-basin:
    #!/usr/bin/env bash
    if ! sops decrypt secrets.yaml --output-type=json > /dev/null 2>&1; then
        echo "Error: Failed to decrypt secrets.yaml"
        exit 1
    fi
    eval "$(sops decrypt secrets.yaml --output-type=json | jq -r 'to_entries | .[] | "export " + (.key | ascii_upcase) + "=" + (.value | @sh)')"
    echo "Scraping basin reserves from Catalan government..."
    echo "---"
    curl -s -X POST "http://localhost:5555/api/scrape" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $SMART_SCRAPER" \
      -d '{"url": "https://aca.gencat.cat/es/laigua/estat-del-medi-hidric/recursos-disponibles/estat-de-les-reserves-daigua-als-embassaments/index.html", "xpath": "substring-before(substring-after(//textarea[contains(@id, '\''result_'\'')]/text(), '\''porciento2='\''), '\''\&'\'')"}' | jq '.'

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
    #!/usr/bin/env bash
    PROXY="socks5://r5s.bruc:1080"
    
    if ! sops decrypt secrets.yaml --output-type=json > /dev/null 2>&1; then
        echo "Error: Failed to decrypt secrets.yaml"
        exit 1
    fi
    eval "$(sops decrypt secrets.yaml --output-type=json | jq -r 'to_entries | .[] | "export " + (.key | ascii_upcase) + "=" + (.value | @sh)')"
    
    URLS_FILE="testing/urls_for_testing.txt"
    SERVER="http://localhost:5555"
    
    # Check server health
    if ! curl -sf "$SERVER/health" > /dev/null 2>&1; then
        echo "Error: Server not responding at $SERVER"
        echo "Start with: just dev"
        exit 1
    fi
    
    if [[ ! -f "$URLS_FILE" ]]; then
        echo "Error: URLs file not found: $URLS_FILE"
        exit 1
    fi
    
    mapfile -t URLS < <(grep -v '^#' "$URLS_FILE" | grep -v '^$' | tr -d '\r')
    if [[ ${#URLS[@]} -eq 0 ]]; then
        echo "No URLs found in $URLS_FILE"
        exit 0
    fi
    
    echo "Testing ${#URLS[@]} URLs (proxy: $PROXY)..."
    echo "================================================"
    
    PASSED=0
    FAILED=0
    declare -a FAILURES=()
    
    for url in "${URLS[@]}"; do
        printf "Testing: %s ... " "$url"
        
        RESPONSE=$(curl -sf --proxy "$PROXY" -X POST "$SERVER/api/scrape" \
            -H "Authorization: Bearer $SMART_SCRAPER" \
            -H "Content-Type: application/json" \
            -d "{\"url\": \"$url\", \"outputType\": \"metadata_only\"}" \
            --max-time 120 2>&1)
        CURL_EXIT=$?
        
        if [[ $CURL_EXIT -ne 0 ]]; then
            RESPONSE='{"success":false,"error":"Request failed"}'
        fi
        
        SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')
        if [[ "$SUCCESS" == "true" ]]; then
            echo "PASS"
            PASSED=$((PASSED + 1))
        else
            ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
            echo "FAIL ($ERROR)"
            FAILED=$((FAILED + 1))
            FAILURES+=("$url: $ERROR")
        fi
    done
    
    echo "================================================"
    echo "Passed: $PASSED, Failed: $FAILED"
    
    if [[ $FAILED -gt 0 ]]; then
        echo ""
        echo "Failed URLs:"
        for f in "${FAILURES[@]}"; do
            echo "  - $f"
        done
        exit 1
    fi

# Clean up orphan processes and cache
test-clean:
    #!/usr/bin/env bash
    rm -f .test-cache.json
    rm -rf test-orchestrator/logs/*
    rm -rf /tmp/smartscraper-test-*
    for port in 9000 9001 9002 9003 9004 9005 9006 9007; do
        lsof -ti:$port 2>/dev/null | xargs -r kill -9 2>/dev/null || true
    done
