#!/usr/bin/env bash
#
# Clean up orphan processes and cache
#

rm -f .test-cache.json
rm -rf test-orchestrator/logs/*
rm -rf /tmp/smartscraper-test-*

for port in 9000 9001 9002 9003 9004 9005 9006 9007; do
    lsof -ti:$port 2>/dev/null | xargs -r kill -9 2>/dev/null || true
done

echo "Cleanup complete"
