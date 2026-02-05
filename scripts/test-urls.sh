#!/usr/bin/env bash
#
# Run e2e tests against URLs from testing/urls_for_testing.txt
#

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
