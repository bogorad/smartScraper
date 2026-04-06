#!/usr/bin/env bash
#
# Test basin/reservoir scrape from Catalan government
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configuration: override with environment variables
SERVER="${SMART_SCRAPER_SERVER:-http://localhost:5555}"
TIMEOUT="${SMART_SCRAPER_TIMEOUT:-60}"
URL="https://aca.gencat.cat/es/laigua/estat-del-medi-hidric/recursos-disponibles/estat-de-les-reserves-daigua-als-embassaments/index.html"
XPATH_FILE="$SCRIPT_DIR/test-basin.xpath"

if [[ ! -f "$XPATH_FILE" ]]; then
    echo "Error: XPath file not found: $XPATH_FILE"
    exit 1
fi

XPATH=$(<"$XPATH_FILE")

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

# Check server health
if ! curl -sf "$SERVER/health" > /dev/null 2>&1; then
    echo "Error: Server not responding at $SERVER"
    echo "Start with: just dev"
    exit 1
fi

echo "Scraping basin reserves from Catalan government..."
echo "URL: $URL"
echo "---"

# Use jq to safely construct JSON payload (handles escaping)
PAYLOAD=$(jq -n --arg url "$URL" --arg xpath "$XPATH" '{url: $url, xpath: $xpath}')

RESPONSE=$(curl -sf -X POST "$SERVER/api/scrape" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $SMART_SCRAPER" \
    -d "$PAYLOAD" \
    --max-time "$TIMEOUT" 2>&1)
CURL_EXIT=$?

if [[ $CURL_EXIT -ne 0 ]]; then
    case $CURL_EXIT in
        6)  CURL_ERROR="Could not resolve host" ;;
        7)  CURL_ERROR="Failed to connect" ;;
        22) CURL_ERROR="HTTP error (4xx/5xx)" ;;
        28) CURL_ERROR="Operation timeout" ;;
        35) CURL_ERROR="SSL connect error" ;;
        52) CURL_ERROR="Empty reply from server" ;;
        56) CURL_ERROR="Failure receiving network data" ;;
        *)  CURL_ERROR="curl exit code $CURL_EXIT" ;;
    esac
    echo "Error: $CURL_ERROR"
    exit 1
fi

echo "$RESPONSE" | jq '.'

SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')
if [[ "$SUCCESS" == "true" ]]; then
    echo "---"
    echo "Basin scrape successful"
else
    ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
    echo "---"
    echo "Basin scrape failed: $ERROR"
    exit 1
fi
