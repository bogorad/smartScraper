#!/usr/bin/env bash
#
# Test 5 parallel scrapes of example.com
#

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
