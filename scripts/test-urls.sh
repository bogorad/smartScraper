#!/usr/bin/env bash
#
# Run e2e tests against URLs from testing/urls_for_testing.txt
#

# Configuration: override with environment variables
PROXY="${SMART_SCRAPER_PROXY:-socks5://r5s.bruc:1080}"
SERVER="${SMART_SCRAPER_SERVER:-http://localhost:5555}"
TIMEOUT="${SMART_SCRAPER_TIMEOUT:-120}"

# Decrypt secrets once and reuse
SECRETS=$(sops decrypt secrets.yaml --output-type=json 2>/dev/null)
if [[ $? -ne 0 ]]; then
    echo "Error: Failed to decrypt secrets.yaml"
    exit 1
fi

if [[ -z "$SECRETS" || "$SECRETS" == "{}" ]]; then
    echo "Error: secrets.yaml decrypted but is empty"
    exit 1
fi

eval "$(echo "$SECRETS" | jq -r 'to_entries | .[] | "export " + (.key | ascii_upcase) + "=" + (.value | @sh)')"

URLS_FILE="testing/urls_for_testing.txt"

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

echo "Testing ${#URLS[@]} URLs (proxy: $PROXY, timeout: ${TIMEOUT}s)..."
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
        --max-time "$TIMEOUT" 2>&1)
    CURL_EXIT=$?
    
    if [[ $CURL_EXIT -ne 0 ]]; then
        # Map common curl exit codes to human-readable errors
        case $CURL_EXIT in
            5)  CURL_ERROR="Proxy error" ;;
            6)  CURL_ERROR="Could not resolve host" ;;
            7)  CURL_ERROR="Failed to connect" ;;
            22) CURL_ERROR="HTTP error (4xx/5xx)" ;;
            28) CURL_ERROR="Operation timeout" ;;
            35) CURL_ERROR="SSL connect error" ;;
            52) CURL_ERROR="Empty reply from server" ;;
            56) CURL_ERROR="Failure receiving network data" ;;
            60) CURL_ERROR="SSL certificate problem" ;;
            *)  CURL_ERROR="curl exit code $CURL_EXIT" ;;
        esac
        RESPONSE="{\"success\":false,\"error\":\"$CURL_ERROR\"}"
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
