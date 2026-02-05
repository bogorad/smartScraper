#!/usr/bin/env bash
#
# Start development server with secrets loaded
#

if ! sops decrypt secrets.yaml --output-type=json > /dev/null 2>&1; then
    echo "Error: Failed to decrypt secrets.yaml"
    exit 1
fi

eval "$(sops decrypt secrets.yaml --output-type=json | jq -r 'to_entries | .[] | "export " + (.key | ascii_upcase) + "=" + (.value | @sh)')"

LOG_LEVEL=DEBUG NODE_ENV=development npm run dev
