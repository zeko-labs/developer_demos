#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"

CUSTOMER_SOURCE_NAME="${CUSTOMER_SOURCE_NAME:-customer-balance}"
ALLOWED_HOSTS_CSV="${ALLOWED_HOSTS_CSV:-sandbox.api.customer.example}"
AUTH_PROFILE_NAME="${AUTH_PROFILE_NAME:-customerBalanceOauth}"
AUTH_TYPE="${AUTH_TYPE:-oauth2-client-credentials}"
TOKEN_URL="${TOKEN_URL:-https://sandbox.api.customer.example/oauth/token}"
CLIENT_ID_ENV="${CLIENT_ID_ENV:-CUSTOMER_BALANCE_CLIENT_ID}"
CLIENT_SECRET_ENV="${CLIENT_SECRET_ENV:-CUSTOMER_BALANCE_CLIENT_SECRET}"
SCOPE="${SCOPE:-accounts.read}"
ROUTING_STRATEGY="${ROUTING_STRATEGY:-health-weighted}"
ROUTING_WEIGHT="${ROUTING_WEIGHT:-10}"
KEY_VERSION="${KEY_VERSION:-customer-balance-v1}"

API_BASE_URL="${API_BASE_URL}" \
ADMIN_API_KEY="${ADMIN_API_KEY}" \
TENANT_ID="${TENANT_ID}" \
CUSTOMER_SOURCE_NAME="${CUSTOMER_SOURCE_NAME}" \
ALLOWED_HOSTS_CSV="${ALLOWED_HOSTS_CSV}" \
AUTH_PROFILE_NAME="${AUTH_PROFILE_NAME}" \
AUTH_TYPE="${AUTH_TYPE}" \
TOKEN_URL="${TOKEN_URL}" \
CLIENT_ID_ENV="${CLIENT_ID_ENV}" \
CLIENT_SECRET_ENV="${CLIENT_SECRET_ENV}" \
SCOPE="${SCOPE}" \
ROUTING_STRATEGY="${ROUTING_STRATEGY}" \
ROUTING_WEIGHT="${ROUTING_WEIGHT}" \
KEY_VERSION="${KEY_VERSION}" \
"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bootstrap_customer_generic_rest_provider.sh"

echo "Next example source payload:"
cat <<EOF
{
  "provider": "generic-rest",
  "tenantId": "${TENANT_ID}",
  "subjectCommitment": "subj_customer_balance_001",
  "policyId": 1001,
  "settle": true,
  "source": {
    "url": "https://sandbox.api.customer.example/v1/accounts/acct_demo_001/balance",
    "method": "GET",
    "authProfile": "${AUTH_PROFILE_NAME}",
    "extract": {
      "eligibilityPath": "eligible",
      "scorePath": "score",
      "fields": {
        "currentBalanceCents": "current_balance_cents",
        "availableBalanceCents": "available_balance_cents",
        "currency": "currency",
        "accountStatus": "account_status"
      }
    }
  }
}
EOF
