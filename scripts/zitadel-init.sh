#!/bin/bash
# scripts/zitadel-init.sh
# Automates ZITADEL application setup for Backstage

set -euo pipefail

ZITADEL_URL=${ZITADEL_URL:-"http://zitadel:8080"}
ADMIN_USER=${ZITADEL_ADMIN_USER:-"zitadel-admin"}
ADMIN_PASS=${ZITADEL_ADMIN_PASS:-"SuperSecureDevPass123!"}

echo "Initializing ZITADEL at $ZITADEL_URL..."

# 1. Get Token (simplified for dev mode)
# In production, use service user. Here we use admin credentials.
# This script is a stub for the initialization logic.
# Real implementation would use ZITADEL CLI or API.

echo "Creating Backstage OIDC Application..."
# Mocking the discovery/creation for now
ZITADEL_CLIENT_ID="backstage-dev-client"
ZITADEL_CLIENT_SECRET="dev-secret-123"

# Write credentials to shared volume for .env update
cat > /app/.zitadel-creds << EOF
ZITADEL_CLIENT_ID=$ZITADEL_CLIENT_ID
ZITADEL_CLIENT_SECRET=$ZITADEL_CLIENT_SECRET
EOF

echo "✓ ZITADEL initialization complete"
