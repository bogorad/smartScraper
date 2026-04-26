#!/usr/bin/env bash
#
# Run e2e tests against URLs from testing/urls_for_testing.txt.
# Before running, kill every process listening on :5555, restart `just dev`,
# and verify /health. Passing responses must report method curl or chrome only.
# Required secrets must already be present in the environment.
#

# Configuration: override with environment variables
PROXY="${SMART_SCRAPER_PROXY-}"
SERVER="${SMART_SCRAPER_SERVER:-http://localhost:5555}"
TIMEOUT="${SMART_SCRAPER_TIMEOUT:-120}"
DEFAULT_URLS_FILE="testing/urls_for_testing.txt"
FAILED_URLS_FILE="${SMART_SCRAPER_FAILED_URLS_FILE:-testing/failed_urls.txt}"
FAILED_ARTIFACTS_FILE="${SMART_SCRAPER_FAILED_ARTIFACTS_FILE:-testing/failed_url_artifacts.jsonl}"

usage() {
    cat <<EOF
Usage: $0 [--failed]

Options:
  --failed    Rerun only URLs recorded as failed by the previous run.

Environment:
  SMART_SCRAPER_SERVER            Server URL (default: http://localhost:5555)
  SMART_SCRAPER_PROXY             optional curl proxy URL for the API request
  SMART_SCRAPER_TIMEOUT           Per-URL timeout in seconds (default: 120)
  SMART_SCRAPER_FAILED_URLS_FILE  Failed URL artifact (default: testing/failed_urls.txt)
  SMART_SCRAPER_FAILED_ARTIFACTS_FILE  Failed response artifact (default: testing/failed_url_artifacts.jsonl)
EOF
}

RUN_FAILED_ONLY=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --failed|--failed-only)
            RUN_FAILED_ONLY=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Error: Unknown argument: $1"
            usage
            exit 2
            ;;
    esac
done

if [[ -z "${SMART_SCRAPER:-}" ]]; then
    echo "Error: SMART_SCRAPER env var is required"
    echo "Run with: scripts/with-secrets.sh -- scripts/test-urls.sh"
    exit 1
fi

if [[ "$RUN_FAILED_ONLY" == "true" ]]; then
    URLS_FILE="$FAILED_URLS_FILE"
else
    URLS_FILE="$DEFAULT_URLS_FILE"
fi

# Check server health
if ! curl -sf "$SERVER/health" > /dev/null 2>&1; then
    echo "Error: Server not responding at $SERVER"
    echo "Start with: just dev"
    exit 1
fi

if [[ ! -f "$URLS_FILE" ]]; then
    echo "Error: URLs file not found: $URLS_FILE"
    if [[ "$RUN_FAILED_ONLY" == "true" ]]; then
        echo "Run a full URL test first to create $FAILED_URLS_FILE"
    fi
    exit 1
fi

declare -a URLS=()
declare -a URL_MODES=()
declare -a URL_CLASSES=()

while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    line="${raw_line%$'\r'}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue

    if [[ "$RUN_FAILED_ONLY" == "true" ]]; then
        if [[ "$line" == *"|"* ]]; then
            IFS="|" read -r classification url _ <<< "$line"
            URLS+=("$url")
            URL_MODES+=("required")
            URL_CLASSES+=("${classification:-previous-failure}")
        else
            URLS+=("$line")
            URL_MODES+=("required")
            URL_CLASSES+=("previous-failure")
        fi
        continue
    fi

    if [[ "$line" == required\|* ]]; then
        URLS+=("${line#required|}")
        URL_MODES+=("required")
        URL_CLASSES+=("smoke")
        continue
    fi

    if [[ "$line" == diagnostic\|* ]]; then
        rest="${line#diagnostic|}"
        URLS+=("${rest#*|}")
        URL_MODES+=("diagnostic")
        URL_CLASSES+=("${rest%%|*}")
        continue
    fi

    URLS+=("$line")
    URL_MODES+=("required")
    URL_CLASSES+=("legacy")
done < "$URLS_FILE"

if [[ ${#URLS[@]} -eq 0 ]]; then
    echo "No URLs found in $URLS_FILE"
    exit 0
fi

if [[ "$RUN_FAILED_ONLY" == "true" ]]; then
    echo "Rerunning ${#URLS[@]} failed URLs from $FAILED_URLS_FILE (curl proxy: ${PROXY:-none}, timeout: ${TIMEOUT}s)..."
else
    REQUIRED_COUNT=0
    DIAGNOSTIC_COUNT=0
    for mode in "${URL_MODES[@]}"; do
        if [[ "$mode" == "diagnostic" ]]; then
            DIAGNOSTIC_COUNT=$((DIAGNOSTIC_COUNT + 1))
        else
            REQUIRED_COUNT=$((REQUIRED_COUNT + 1))
        fi
    done
    echo "Testing ${#URLS[@]} URLs ($REQUIRED_COUNT required, $DIAGNOSTIC_COUNT diagnostic; curl proxy: ${PROXY:-none}, timeout: ${TIMEOUT}s)..."
fi
echo "================================================"

PASSED=0
FAILED=0
REQUIRED_FAILED=0
DIAGNOSTIC_FAILED=0
declare -a FAILURES=()
declare -a FAILED_URLS=()
declare -a CURL_PROXY_ARGS=()

if [[ -n "$PROXY" ]]; then
    CURL_PROXY_ARGS=(--proxy "$PROXY")
fi

mkdir -p "$(dirname "$FAILED_ARTIFACTS_FILE")"
: > "$FAILED_ARTIFACTS_FILE"

record_failure_artifact() {
    local url="$1"
    local http_status="$2"
    local curl_exit="$3"
    local response_body="$4"
    local reason="$5"
    local method="$6"
    local timestamp
    local parsed_json
    local error_type
    local error
    local details
    local scrape_id
    local log_id

    timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    parsed_json="false"
    error_type=""
    error="$reason"
    details="null"
    scrape_id=""
    log_id=""

    if echo "$response_body" | jq -e . > /dev/null 2>&1; then
        parsed_json="true"
        error_type="$(echo "$response_body" | jq -r '.errorType // empty')"
        error="$(echo "$response_body" | jq -r '.error // empty')"
        if [[ -z "$error" ]]; then
            error="$reason"
        fi
        details="$(echo "$response_body" | jq -c '.details // null')"
        scrape_id="$(echo "$response_body" | jq -r '.scrapeId // .scrapeID // empty')"
        log_id="$(echo "$response_body" | jq -r '.logId // .logID // empty')"
    fi

    jq -n \
        --arg timestamp "$timestamp" \
        --arg url "$url" \
        --arg httpStatus "$http_status" \
        --arg curlExit "$curl_exit" \
        --arg reason "$reason" \
        --arg errorType "$error_type" \
        --arg error "$error" \
        --arg method "$method" \
        --arg scrapeId "$scrape_id" \
        --arg logId "$log_id" \
        --arg responseBody "$response_body" \
        --argjson parsedJson "$parsed_json" \
        --argjson details "$details" \
        '{
          timestamp: $timestamp,
          url: $url,
          httpStatus: $httpStatus,
          curlExit: ($curlExit | tonumber),
          reason: $reason,
          method: $method,
          errorType: $errorType,
          error: $error,
          details: $details,
          scrapeId: $scrapeId,
          logId: $logId,
          parsedJson: $parsedJson,
          responseBody: $responseBody
        }' >> "$FAILED_ARTIFACTS_FILE"
}

for i in "${!URLS[@]}"; do
    url="${URLS[$i]}"
    mode="${URL_MODES[$i]}"
    classification="${URL_CLASSES[$i]}"
    printf "Testing [%s/%s]: %s ... " "$mode" "$classification" "$url"

    REQUEST_BODY="$(jq -n --arg url "$url" '{url: $url, outputType: "metadata_only"}')"
    BODY_FILE="$(mktemp)"
    STDERR_FILE="$(mktemp)"
    HTTP_STATUS=$(curl -sS "${CURL_PROXY_ARGS[@]}" -X POST "$SERVER/api/scrape" \
        -H "Authorization: Bearer $SMART_SCRAPER" \
        -H "Content-Type: application/json" \
        -d "$REQUEST_BODY" \
        --max-time "$TIMEOUT" \
        -o "$BODY_FILE" \
        -w "%{http_code}" 2>"$STDERR_FILE")
    CURL_EXIT=$?
    RESPONSE="$(cat "$BODY_FILE")"
    CURL_STDERR="$(cat "$STDERR_FILE")"
    rm -f "$BODY_FILE" "$STDERR_FILE"

    if [[ $CURL_EXIT -ne 0 || "$HTTP_STATUS" -lt 200 || "$HTTP_STATUS" -ge 300 ]]; then
        # Map common curl exit codes to human-readable errors
        case $CURL_EXIT in
            0)  CURL_ERROR="HTTP $HTTP_STATUS" ;;
            5)  CURL_ERROR="Proxy error" ;;
            6)  CURL_ERROR="Could not resolve host" ;;
            7)  CURL_ERROR="Failed to connect" ;;
            28) CURL_ERROR="Operation timeout" ;;
            35) CURL_ERROR="SSL connect error" ;;
            52) CURL_ERROR="Empty reply from server" ;;
            56) CURL_ERROR="Failure receiving network data" ;;
            60) CURL_ERROR="SSL certificate problem" ;;
            *)  CURL_ERROR="curl exit code $CURL_EXIT" ;;
        esac
        if [[ -n "$CURL_STDERR" && -z "$RESPONSE" ]]; then
            RESPONSE="$CURL_STDERR"
        fi
    fi

    if echo "$RESPONSE" | jq -e . > /dev/null 2>&1; then
        SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')
        METHOD=$(echo "$RESPONSE" | jq -r '.method // empty')
    else
        SUCCESS="false"
        METHOD=""
    fi

    if [[ "$SUCCESS" == "true" ]]; then
        if [[ "$METHOD" != "curl" && "$METHOD" != "chrome" ]]; then
            echo "FAIL (invalid method: ${METHOD:-missing})"
            FAILED=$((FAILED + 1))
            if [[ "$mode" == "diagnostic" ]]; then
                DIAGNOSTIC_FAILED=$((DIAGNOSTIC_FAILED + 1))
            else
                REQUIRED_FAILED=$((REQUIRED_FAILED + 1))
            fi
            FAILURES+=("$url: $mode $classification: invalid method: ${METHOD:-missing}")
            FAILED_URLS+=("$classification|$url|invalid method: ${METHOD:-missing}")
            record_failure_artifact "$url" "$HTTP_STATUS" "$CURL_EXIT" "$RESPONSE" "invalid method: ${METHOD:-missing}" "$METHOD"
            continue
        fi
        echo "PASS ($METHOD)"
        PASSED=$((PASSED + 1))
    else
        if echo "$RESPONSE" | jq -e . > /dev/null 2>&1; then
            ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"')
            ERROR_TYPE=$(echo "$RESPONSE" | jq -r '.errorType // empty')
            if [[ -n "$ERROR_TYPE" ]]; then
                ERROR="$ERROR_TYPE: $ERROR"
            fi
        else
            ERROR="${CURL_ERROR:-Invalid JSON response}"
        fi
        echo "FAIL ($ERROR)"
        FAILED=$((FAILED + 1))
        if [[ "$mode" == "diagnostic" ]]; then
            DIAGNOSTIC_FAILED=$((DIAGNOSTIC_FAILED + 1))
        else
            REQUIRED_FAILED=$((REQUIRED_FAILED + 1))
        fi
        FAILURES+=("$url: $mode $classification: $ERROR")
        FAILED_URLS+=("$classification|$url|$ERROR")
        record_failure_artifact "$url" "$HTTP_STATUS" "$CURL_EXIT" "$RESPONSE" "$ERROR" "$METHOD"
    fi
done

echo "================================================"
echo "Passed: $PASSED, Failed: $FAILED"
echo "Required failures: $REQUIRED_FAILED, Diagnostic failures: $DIAGNOSTIC_FAILED"

mkdir -p "$(dirname "$FAILED_URLS_FILE")"
if [[ $FAILED -gt 0 ]]; then
    printf "%s\n" "${FAILED_URLS[@]}" > "$FAILED_URLS_FILE"
    echo "Wrote failed URLs to $FAILED_URLS_FILE"
    echo "Wrote failure artifacts to $FAILED_ARTIFACTS_FILE"
else
    : > "$FAILED_URLS_FILE"
fi

if [[ $REQUIRED_FAILED -gt 0 ]]; then
    echo ""
    echo "Failed URLs:"
    for f in "${FAILURES[@]}"; do
        echo "  - $f"
    done
    exit 1
fi
