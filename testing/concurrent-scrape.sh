#!/usr/bin/env bash
#
# E2E test: Run two URLs concurrently and verify both succeed
# Requires: running server (just dev), decrypted secrets
#
# For diagnostics, check server logs:
#   tail -f data/logs/scraper-$(date +%Y-%m-%d).jsonl | jq -c '{ts: .timestamp, msg: .message, err: .error}'
#

set -o pipefail

# Configuration
# Note: Proxy for browser scraping is configured server-side via PROXY_SERVER env var
# DataDome CAPTCHA solving uses separate DATADOME_PROXY_* credentials
SERVER="${SMART_SCRAPER_SERVER:-http://localhost:5555}"
TIMEOUT="${SMART_SCRAPER_TIMEOUT:-120}"
URLS_FILE="testing/urls_for_testing.txt"

# Temp files - declare early for cleanup trap
OUT1="" OUT2="" TIME1="" TIME2=""

# Cleanup on exit (normal or interrupted)
cleanup() {
    rm -f "$OUT1" "$OUT2" "$TIME1" "$TIME2" "$TIME1.exit" "$TIME2.exit" 2>/dev/null
}
trap cleanup EXIT

# Decrypt secrets using sops -d | yq with proper error handling
SECRETS=$(sops -d secrets.yaml 2>/dev/null) || {
    echo "Error: Failed to decrypt secrets.yaml"
    exit 1
}
SMART_SCRAPER=$(echo "$SECRETS" | yq -r '.smart_scraper')
if [[ -z "$SMART_SCRAPER" || "$SMART_SCRAPER" == "null" ]]; then
    echo "Error: smart_scraper key not found in secrets.yaml"
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

# Create temp files
OUT1=$(mktemp)
OUT2=$(mktemp)
TIME1=$(mktemp)
TIME2=$(mktemp)

echo "Starting concurrent scrapes..."
echo ""

# Build curl commands - proxy is configured server-side, not passed per-request
CURL_BASE=(-sf -X POST "$SERVER/api/scrape"
    -H "Authorization: Bearer $SMART_SCRAPER"
    -H "Content-Type: application/json"
    --max-time "$TIMEOUT")

# Launch both in parallel
{
    start=$(date +%s)
    curl "${CURL_BASE[@]}" -d "{\"url\": \"$URL1\", \"outputType\": \"metadata_only\", \"debug\": true}" > "$OUT1" 2>&1
    echo "$?" > "$TIME1.exit"
    echo "$(($(date +%s) - start))" > "$TIME1"
} &
PID1=$!

{
    start=$(date +%s)
    curl "${CURL_BASE[@]}" -d "{\"url\": \"$URL2\", \"outputType\": \"metadata_only\", \"debug\": true}" > "$OUT2" 2>&1
    echo "$?" > "$TIME2.exit"
    echo "$(($(date +%s) - start))" > "$TIME2"
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

# Parse results with jq validation
parse_result() {
    local label="$1"
    local exit_code="$2"
    local response="$3"
    local duration="$4"
    
    if [[ $exit_code -ne 0 ]]; then
        echo "$label: FAILED (curl exit $exit_code) [${duration}s]"
        echo "  Response: $response"
        return 1
    fi
    
    # Validate JSON before parsing
    if ! echo "$response" | jq -e . >/dev/null 2>&1; then
        echo "$label: FAILED (invalid JSON response) [${duration}s]"
        echo "  Response: ${response:0:200}"
        return 1
    fi
    
    local success=$(echo "$response" | jq -r '.success // false')
    if [[ "$success" == "true" ]]; then
        local xpath=$(echo "$response" | jq -r '.xpath // "unknown"')
        echo "$label: PASS (xpath: $xpath) [${duration}s]"
        return 0
    else
        local error=$(echo "$response" | jq -r '.error // "unknown error"')
        local errorType=$(echo "$response" | jq -r '.errorType // "unknown"')
        echo "$label: FAILED [$errorType] $error [${duration}s]"
        return 1
    fi
}

parse_result "URL1" "$EXIT1" "$RESP1" "$DUR1"
R1=$?
parse_result "URL2" "$EXIT2" "$RESP2" "$DUR2"
R2=$?

echo ""
echo "=== Results ==="

FAILED=0
FAILED_DOMAINS=()

if [[ $R1 -ne 0 ]]; then
    echo "URL1: FAILED"
    FAILED=$((FAILED + 1))
    # Extract domain for log lookup
    DOMAIN1=$(echo "$URL1" | sed -E 's|https?://([^/]+).*|\1|' | sed 's/^www\.//')
    FAILED_DOMAINS+=("$DOMAIN1")
else
    echo "URL1: PASSED"
fi

if [[ $R2 -ne 0 ]]; then
    echo "URL2: FAILED"
    FAILED=$((FAILED + 1))
    DOMAIN2=$(echo "$URL2" | sed -E 's|https?://([^/]+).*|\1|' | sed 's/^www\.//')
    FAILED_DOMAINS+=("$DOMAIN2")
else
    echo "URL2: PASSED"
fi

# Show diagnostic logs for failed domains
if [[ $FAILED -gt 0 ]]; then
    echo ""
    echo "=== Diagnostics (from server logs) ==="
    LOG_FILE="data/logs/scraper-$(date +%Y-%m-%d).jsonl"
    if [[ -f "$LOG_FILE" ]]; then
        for domain in "${FAILED_DOMAINS[@]}"; do
            echo ""
            echo "--- $domain ---"
            entries=$(grep -F "\"$domain\"" "$LOG_FILE" | tail -10)
            if [[ -z "$entries" ]]; then
                echo "(no log entries found)"
            else
                echo "$entries" | jq -c '{level: .level, msg: .message, err: .error}' 2>/dev/null || echo "(log parse error)"
            fi
        done
    else
        echo "(log file not found: $LOG_FILE)"
    fi
fi

echo ""
if [[ $FAILED -eq 0 ]]; then
    echo "✓ All concurrent scrapes succeeded"
    exit 0
else
    echo "✗ $FAILED scrape(s) failed"
    exit 1
fi
