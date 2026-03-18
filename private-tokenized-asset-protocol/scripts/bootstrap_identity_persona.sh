#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
QUOTA_PER_HOUR="${QUOTA_PER_HOUR:-1000}"
PERSONA_ALLOWED_HOST="${PERSONA_ALLOWED_HOST:-withpersona.com}"
PERSONA_AUTH_PROFILE="${PERSONA_AUTH_PROFILE:-personaSandbox}"
PERSONA_API_KEY_ENV="${PERSONA_API_KEY_ENV:-PERSONA_API_KEY}"

auth_header() {
  printf 'Authorization: Bearer %s' "${ADMIN_API_KEY}"
}

echo "[1/2] Upserting ${TENANT_ID}/persona provider config..."
curl -s -X POST "${API_BASE_URL}/api/v1/tenant/${TENANT_ID}/provider-config" \
  -H 'content-type: application/json' \
  -H "$(auth_header)" \
  -d "{
    \"provider\":\"persona\",
    \"enabled\":true,
    \"allowedHosts\":[\"${PERSONA_ALLOWED_HOST}\"],
    \"quotaPerHour\":${QUOTA_PER_HOUR},
    \"mappingVersion\":\"v1\",
    \"authProfiles\":{
      \"${PERSONA_AUTH_PROFILE}\":{
        \"type\":\"bearer\",
        \"secretEnv\":\"${PERSONA_API_KEY_ENV}\",
        \"lifecycle\":{
          \"keyVersion\":\"persona-sandbox-v1\"
        }
      }
    },
    \"mtlsProfiles\":{}
  }" >/dev/null

echo "[2/2] Provider config ready."
echo "Next:"
echo "  export ${PERSONA_API_KEY_ENV}=<persona_sandbox_api_key>"
echo "  export PERSONA_WEBHOOK_SECRET=<persona_webhook_signing_secret>"
