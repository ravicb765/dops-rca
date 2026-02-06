#!/bin/bash
# scripts/wait-for-zitadel.sh
# Polls ZITADEL ready endpoint

set -euo pipefail

URL="http://localhost:8080/debug/ready"
MAX_RETRIES=30
RETRY_INTERVAL=2

echo "Waiting for ZITADEL to be ready..."

for i in $(seq 1 $MAX_RETRIES); do
    if curl -sf "$URL" &> /dev/null; then
        echo "✓ ZITADEL is ready"
        exit 0
    fi
    echo "  Attempt $i/$MAX_RETRIES: ZITADEL not ready yet..."
    sleep $RETRY_INTERVAL
done

echo "✗ ZITADEL failed to become ready after $((MAX_RETRIES * RETRY_INTERVAL)) seconds"
exit 1
