#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"

CUSTOMER_SOURCE_NAME="${CUSTOMER_SOURCE_NAME:-customer-kyc}"
ALLOWED_HOSTS_CSV="${ALLOWED_HOSTS_CSV:-sandbox.api.customer.example}"
AUTH_PROFILE_NAME="${AUTH_PROFILE_NAME:-customerKycBearer}"
AUTH_TYPE="${AUTH_TYPE:-bearer}"
SECRET_ENV="${SECRET_ENV:-CUSTOMER_KYC_API_KEY}"
HEADER="${HEADER:-Authorization}"
PREFIX="${PREFIX:-Bearer}"
ROUTING_STRATEGY="${ROUTING_STRATEGY:-ordered}"
ROUTING_WEIGHT="${ROUTING_WEIGHT:-8}"
KEY_VERSION="${KEY_VERSION:-customer-kyc-v1}"

API_BASE_URL="${API_BASE_URL}" \
ADMIN_API_KEY="${ADMIN_API_KEY}" \
TENANT_ID="${TENANT_ID}" \
CUSTOMER_SOURCE_NAME="${CUSTOMER_SOURCE_NAME}" \
ALLOWED_HOSTS_CSV="${ALLOWED_HOSTS_CSV}" \
AUTH_PROFILE_NAME="${AUTH_PROFILE_NAME}" \
AUTH_TYPE="${AUTH_TYPE}" \
SECRET_ENV="${SECRET_ENV}" \
HEADER="${HEADER}" \
PREFIX="${PREFIX}" \
ROUTING_STRATEGY="${ROUTING_STRATEGY}" \
ROUTING_WEIGHT="${ROUTING_WEIGHT}" \
KEY_VERSION="${KEY_VERSION}" \
"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bootstrap_customer_generic_rest_provider.sh"

echo "Next example source payload:"
cat <<EOF
{
  "provider": "generic-rest",
  "tenantId": "${TENANT_ID}",
  "subjectCommitment": "subj_customer_kyc_001",
  "policyId": 2001,
  "settle": true,
  "source": {
    "url": "https://sandbox.api.customer.example/v1/customers/cust_demo_001/kyc-status",
    "method": "GET",
    "authProfile": "${AUTH_PROFILE_NAME}",
    "extract": {
      "eligibilityPath": "kyc_passed",
      "scorePath": "risk_score",
      "fields": {
        "kycPassed": "kyc_passed",
        "jurisdiction": "jurisdiction",
        "customerId": "customer_id",
        "riskTier": "risk_tier"
      }
    }
  }
}
EOF
