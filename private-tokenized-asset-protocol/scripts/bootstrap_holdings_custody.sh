#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
QUOTA_PER_HOUR="${QUOTA_PER_HOUR:-1000}"
CUSTODY_ALLOWED_HOST="${CUSTODY_ALLOWED_HOST:-sandbox.custody.example}"
CUSTODY_AUTH_PROFILE="${CUSTODY_AUTH_PROFILE:-custodySandbox}"
CUSTODY_API_KEY_ENV="${CUSTODY_API_KEY_ENV:-CUSTODY_API_KEY}"

auth_header() {
  printf 'Authorization: Bearer %s' "${ADMIN_API_KEY}"
}

echo "[1/2] Upserting ${TENANT_ID}/custody-holdings provider config..."
curl -s -X POST "${API_BASE_URL}/api/v1/tenant/${TENANT_ID}/provider-config" \
  -H 'content-type: application/json' \
  -H "$(auth_header)" \
  -d "{
    \"provider\":\"custody-holdings\",
    \"enabled\":true,
    \"allowedHosts\":[\"${CUSTODY_ALLOWED_HOST}\"],
    \"quotaPerHour\":${QUOTA_PER_HOUR},
    \"mappingVersion\":\"v1\",
    \"authProfiles\":{
      \"${CUSTODY_AUTH_PROFILE}\":{
        \"type\":\"bearer\",
        \"secretEnv\":\"${CUSTODY_API_KEY_ENV}\",
        \"lifecycle\":{
          \"keyVersion\":\"custody-sandbox-v1\"
        }
      }
    },
    \"mtlsProfiles\":{}
  }" >/dev/null

echo "[2/2] Provider config ready."
echo "Next:"
echo "  export ${CUSTODY_API_KEY_ENV}=<custody_sandbox_api_key>"
echo "  export CUSTODY_WEBHOOK_SECRET=<custody_webhook_signing_secret>"
