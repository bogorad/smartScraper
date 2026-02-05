#!/usr/bin/env bash
#
# End-to-end test runner for SmartScraper
# Reads URLs from urls_for_testing.txt and tests each against the API
#
# Usage: ./testing/run-e2e.sh [--server URL] [--timeout SECONDS]
#
# Prerequisites:
#   - Server must be running (npm run dev or npm start)
#   - sops and yq must be available (provided by nix develop)
#   - secrets.yaml must be decryptable
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
URLS_FILE="$SCRIPT_DIR/urls_for_testing.txt"

# Defaults
SERVER_URL="${SERVER_URL:-http://localhost:5555}"
TIMEOUT="${TIMEOUT:-120}"

# Colors (if terminal supports it)
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    NC='\033[0m' # No Color
else
    RED=''
    GREEN=''
    YELLOW=''
    NC=''
fi

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --server)
            SERVER_URL="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [--server URL] [--timeout SECONDS]"
            echo ""
            echo "Options:"
            echo "  --server URL      Server URL (default: http://localhost:5555)"
            echo "  --timeout SECONDS Request timeout (default: 120)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check prerequisites
if [[ ! -f "$URLS_FILE" ]]; then
    echo -e "${RED}Error: URLs file not found: $URLS_FILE${NC}"
    exit 1
fi

if ! command -v sops &> /dev/null; then
    echo -e "${RED}Error: sops not found. Run from 'nix develop' shell.${NC}"
    exit 1
fi

if ! command -v yq &> /dev/null; then
    echo -e "${RED}Error: yq not found. Run from 'nix develop' shell.${NC}"
    exit 1
fi

if [[ ! -f "$PROJECT_ROOT/secrets.yaml" ]]; then
    echo -e "${RED}Error: secrets.yaml not found in project root.${NC}"
    exit 1
fi

# Check server health
echo "Checking server health at $SERVER_URL..."
if ! curl -sf "$SERVER_URL/health" > /dev/null 2>&1; then
    echo -e "${RED}Error: Server not responding at $SERVER_URL${NC}"
    echo "Start the server with: npm run dev"
    exit 1
fi
echo -e "${GREEN}Server is healthy${NC}"
echo ""

# Read URLs (skip empty lines and comments)
mapfile -t URLS < <(grep -v '^#' "$URLS_FILE" | grep -v '^$' | tr -d '\r')

if [[ ${#URLS[@]} -eq 0 ]]; then
    echo -e "${YELLOW}No URLs found in $URLS_FILE${NC}"
    exit 0
fi

echo "Testing ${#URLS[@]} URLs..."
echo "================================================"
echo ""

# Counters
PASSED=0
FAILED=0
declare -a FAILED_URLS=()

# Test each URL
for url in "${URLS[@]}"; do
    echo -n "Testing: $url ... "
    
    # CRITICAL: Token is inline, never stored in a variable
    # shellcheck disable=SC2016
    RESPONSE=$(curl -sf -X POST "$SERVER_URL/api/scrape" \
        -H "Authorization: Bearer $(sops -d "$PROJECT_ROOT/secrets.yaml" | yq -r '.smart_scraper')" \
        -H "Content-Type: application/json" \
        -d "{\"url\": \"$url\", \"outputType\": \"metadata_only\"}" \
        --max-time "$TIMEOUT" 2>&1) || RESPONSE='{"success":false,"error":"Request failed"}'
    
    # Check success
    SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')
    
    if [[ "$SUCCESS" == "true" ]]; then
        echo -e "${GREEN}PASS${NC}"
        ((PASSED++))
    else
        ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
        echo -e "${RED}FAIL${NC} ($ERROR)"
        ((FAILED++))
        FAILED_URLS+=("$url: $ERROR")
    fi
done

# Summary
echo ""
echo "================================================"
echo "SUMMARY"
echo "================================================"
echo -e "Total:  ${#URLS[@]}"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"

if [[ $FAILED -gt 0 ]]; then
    echo ""
    echo "Failed URLs:"
    for failure in "${FAILED_URLS[@]}"; do
        echo -e "  ${RED}-${NC} $failure"
    done
    exit 1
fi

exit 0
