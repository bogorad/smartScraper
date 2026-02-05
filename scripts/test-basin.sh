#!/usr/bin/env bash
#
# Test basin/reservoir scrape from Catalan government
#

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
