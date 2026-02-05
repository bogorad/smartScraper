#!/usr/bin/env bash
#
# E2E test: Run two URLs concurrently and verify both succeed
# Requires: running server (just dev), decrypted secrets
#

set -o pipefail

# Configuration - use empty string as default for PROXY (no proxy by default)
PROXY="${SMART_SCRAPER_PROXY:-}"
SERVER="${SMART_SCRAPER_SERVER:-http://localhost:5555}"
TIMEOUT="${SMART_SCRAPER_TIMEOUT:-120}"
URLS_FILE="testing/urls_for_testing.txt"

# Decrypt secrets using sops -d | yq
SMART_SCRAPER=$(sops -d secrets.yaml | yq -r '.smart_scraper')
if [[ -z "$SMART_SCRAPER" ]]; then
    echo "Error: Failed to get smart_scraper token from secrets.yaml"
    exit 1
fi

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

# Build curl args
build_curl_args() {
    local url="$1"
    echo "-sf -X POST $SERVER/api/scrape -H 'Authorization: Bearer $SMART_SCRAPER' -H 'Content-Type: application/json' -d '{\"url\": \"$url\", \"outputType\": \"metadata_only\"}' --max-time $TIMEOUT"
}

# Temp files for output
OUT1=$(mktemp)
OUT2=$(mktemp)
TIME1=$(mktemp)
TIME2=$(mktemp)

echo "Starting concurrent scrapes..."
echo ""

# Build curl commands
CURL_BASE=(-sf -X POST "$SERVER/api/scrape"
    -H "Authorization: Bearer $SMART_SCRAPER"
    -H "Content-Type: application/json"
    --max-time "$TIMEOUT")

if [[ -n "$PROXY" ]]; then
    CURL_BASE+=(--proxy "$PROXY")
fi

# Launch both in parallel using process substitution
{
    start=$(date +%s)
    curl "${CURL_BASE[@]}" -d "{\"url\": \"$URL1\", \"outputType\": \"metadata_only\"}" > "$OUT1" 2>&1
    echo $? > "$TIME1.exit"
    echo $(($(date +%s) - start)) > "$TIME1"
} &
PID1=$!

{
    start=$(date +%s)
    curl "${CURL_BASE[@]}" -d "{\"url\": \"$URL2\", \"outputType\": \"metadata_only\"}" > "$OUT2" 2>&1
    echo $? > "$TIME2.exit"
    echo $(($(date +%s) - start)) > "$TIME2"
} &
PID2=$!

# Wait for both
wait $PID1
wait $PID2

# Read results
EXIT1=$(cat "$TIME1.exit")
EXIT2=$(cat "$TIME2.exit")
DUR1=$(cat "$TIME1")
DUR2=$(cat "$TIME2")
RESP1=$(cat "$OUT1")
RESP2=$(cat "$OUT2")

# Parse results
parse_result() {
    local label="$1"
    local exit_code="$2"
    local response="$3"
    local duration="$4"
    
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

parse_result "URL1" "$EXIT1" "$RESP1" "$DUR1"
R1=$?
parse_result "URL2" "$EXIT2" "$RESP2" "$DUR2"
R2=$?

# Cleanup
rm -f "$OUT1" "$OUT2" "$TIME1" "$TIME2" "$TIME1.exit" "$TIME2.exit"

echo ""
echo "=== Results ==="

FAILED=0
if [[ $R1 -ne 0 ]]; then
    echo "URL1: FAILED"
    FAILED=$((FAILED + 1))
else
    echo "URL1: PASSED"
fi

if [[ $R2 -ne 0 ]]; then
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
