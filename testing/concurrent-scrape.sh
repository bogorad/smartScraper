#!/usr/bin/env bash
#
# E2E test: Run two URLs concurrently and verify both succeed
# Requires: running server (just dev), decrypted secrets
#

set -o pipefail

# Configuration
PROXY="${SMART_SCRAPER_PROXY:-socks5://r5s.bruc:1080}"
SERVER="${SMART_SCRAPER_SERVER:-http://localhost:5555}"
TIMEOUT="${SMART_SCRAPER_TIMEOUT:-120}"
URLS_FILE="testing/urls_for_testing.txt"

# Decrypt secrets
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

# Check server health
if ! curl -sf "$SERVER/health" > /dev/null 2>&1; then
    echo "Error: Server not responding at $SERVER"
    echo "Start with: just dev"
    exit 1
fi

# Read all non-comment URLs and pick 2 random ones
mapfile -t ALL_URLS < <(grep -v '^#' "$URLS_FILE" | grep -v '^$' | tr -d '\r')
if [[ ${#ALL_URLS[@]} -lt 2 ]]; then
    echo "Error: Need at least 2 URLs in $URLS_FILE"
    exit 1
fi

# Pick 2 random unique indices
IDX1=$((RANDOM % ${#ALL_URLS[@]}))
IDX2=$((RANDOM % ${#ALL_URLS[@]}))
while [[ $IDX2 -eq $IDX1 ]]; do
    IDX2=$((RANDOM % ${#ALL_URLS[@]}))
done

URL1="${ALL_URLS[$IDX1]}"
URL2="${ALL_URLS[$IDX2]}"

echo "=== Concurrent Scrape Test ==="
echo "URL 1: $URL1"
echo "URL 2: $URL2"
echo "Server: $SERVER"
echo "Timeout: ${TIMEOUT}s"
echo ""

# Function to scrape a URL and return result
scrape_url() {
    local url="$1"
    local label="$2"
    local start_time=$(date +%s.%N)
    
    local response
    response=$(curl -sf --proxy "$PROXY" -X POST "$SERVER/api/scrape" \
        -H "Authorization: Bearer $SMART_SCRAPER" \
        -H "Content-Type: application/json" \
        -d "{\"url\": \"$url\", \"outputType\": \"metadata_only\"}" \
        --max-time "$TIMEOUT" 2>&1)
    local exit_code=$?
    
    local end_time=$(date +%s.%N)
    local duration=$(echo "$end_time - $start_time" | bc)
    
    if [[ $exit_code -ne 0 ]]; then
        echo "$label: FAILED (curl exit $exit_code) [${duration}s]"
        return 1
    fi
    
    local success=$(echo "$response" | jq -r '.success // false')
    if [[ "$success" == "true" ]]; then
        local xpath=$(echo "$response" | jq -r '.xpath // "unknown"')
        echo "$label: PASS (xpath: $xpath) [${duration}s]"
        return 0
    else
        local error=$(echo "$response" | jq -r '.error // "unknown error"')
        echo "$label: FAILED ($error) [${duration}s]"
        return 1
    fi
}

# Run both scrapes concurrently in background
echo "Starting concurrent scrapes..."
echo ""

# Temp files for results
RESULT1=$(mktemp)
RESULT2=$(mktemp)

# Launch both in parallel
(scrape_url "$URL1" "URL1"; echo $? > "$RESULT1") &
PID1=$!

(scrape_url "$URL2" "URL2"; echo $? > "$RESULT2") &
PID2=$!

# Wait for both to complete
wait $PID1
wait $PID2

# Read exit codes
EXIT1=$(cat "$RESULT1")
EXIT2=$(cat "$RESULT2")

# Cleanup
rm -f "$RESULT1" "$RESULT2"

echo ""
echo "=== Results ==="

FAILED=0
if [[ "$EXIT1" != "0" ]]; then
    echo "URL1: FAILED"
    FAILED=$((FAILED + 1))
else
    echo "URL1: PASSED"
fi

if [[ "$EXIT2" != "0" ]]; then
    echo "URL2: FAILED"
    FAILED=$((FAILED + 1))
else
    echo "URL2: PASSED"
fi

echo ""
if [[ $FAILED -eq 0 ]]; then
    echo "✓ All concurrent scrapes succeeded"
    exit 0
else
    echo "✗ $FAILED scrape(s) failed"
    exit 1
fi
