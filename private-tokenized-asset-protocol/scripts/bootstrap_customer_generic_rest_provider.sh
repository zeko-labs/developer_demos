#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
ADMIN_API_KEY="${ADMIN_API_KEY:-admin_key}"
TENANT_ID="${TENANT_ID:-tenant-a}"
PROVIDER="${PROVIDER:-generic-rest}"
CUSTOMER_SOURCE_NAME="${CUSTOMER_SOURCE_NAME:-customer-source}"
QUOTA_PER_HOUR="${QUOTA_PER_HOUR:-1000}"
MAPPING_VERSION="${MAPPING_VERSION:-v1}"
ROUTING_STRATEGY="${ROUTING_STRATEGY:-ordered}"
ROUTING_WEIGHT="${ROUTING_WEIGHT:-5}"
ALLOWED_HOSTS_CSV="${ALLOWED_HOSTS_CSV:-sandbox.api.customer.example}"
FAILOVER_PROVIDERS_CSV="${FAILOVER_PROVIDERS_CSV:-}"
AUTH_PROFILE_NAME="${AUTH_PROFILE_NAME:-customerSourceAuth}"
AUTH_TYPE="${AUTH_TYPE:-bearer}"
KEY_VERSION="${KEY_VERSION:-customer-sandbox-v1}"

SECRET_ENV="${SECRET_ENV:-}"
HEADER="${HEADER:-}"
PREFIX="${PREFIX:-}"

TOKEN_URL="${TOKEN_URL:-}"
CLIENT_ID_ENV="${CLIENT_ID_ENV:-}"
CLIENT_SECRET_ENV="${CLIENT_SECRET_ENV:-}"
SCOPE="${SCOPE:-}"
AUDIENCE="${AUDIENCE:-}"
MTLS_PROFILE="${MTLS_PROFILE:-}"

auth_header() {
  printf 'Authorization: Bearer %s' "${ADMIN_API_KEY}"
}

build_auth_profile_json() {
  case "${AUTH_TYPE}" in
    bearer|api-key)
      if [[ -z "${SECRET_ENV}" ]]; then
        echo "error: SECRET_ENV is required for AUTH_TYPE=${AUTH_TYPE}" >&2
        exit 1
      fi
      node -e '
        const profile = {
          type: process.env.AUTH_TYPE,
          secretEnv: process.env.SECRET_ENV,
          lifecycle: { keyVersion: process.env.KEY_VERSION || "customer-sandbox-v1" }
        };
        if (process.env.HEADER) profile.header = process.env.HEADER;
        if (process.env.PREFIX) profile.prefix = process.env.PREFIX;
        process.stdout.write(JSON.stringify(profile));
      '
      ;;
    oauth2-client-credentials)
      if [[ -z "${TOKEN_URL}" || -z "${CLIENT_ID_ENV}" || -z "${CLIENT_SECRET_ENV}" ]]; then
        echo "error: TOKEN_URL, CLIENT_ID_ENV, and CLIENT_SECRET_ENV are required for AUTH_TYPE=${AUTH_TYPE}" >&2
        exit 1
      fi
      node -e '
        const profile = {
          type: "oauth2-client-credentials",
          tokenUrl: process.env.TOKEN_URL,
          clientIdEnv: process.env.CLIENT_ID_ENV,
          clientSecretEnv: process.env.CLIENT_SECRET_ENV,
          lifecycle: { keyVersion: process.env.KEY_VERSION || "customer-sandbox-v1" }
        };
        if (process.env.SCOPE) profile.scope = process.env.SCOPE;
        if (process.env.AUDIENCE) profile.audience = process.env.AUDIENCE;
        if (process.env.HEADER) profile.header = process.env.HEADER;
        if (process.env.PREFIX) profile.prefix = process.env.PREFIX;
        if (process.env.MTLS_PROFILE) profile.mtlsProfile = process.env.MTLS_PROFILE;
        process.stdout.write(JSON.stringify(profile));
      '
      ;;
    *)
      echo "error: unsupported AUTH_TYPE=${AUTH_TYPE}" >&2
      exit 1
      ;;
  esac
}

echo "[1/3] Fetching existing ${TENANT_ID}/${PROVIDER} provider config..."
EXISTING_JSON="$(curl -s "${API_BASE_URL}/api/v1/tenant/${TENANT_ID}/provider-config/${PROVIDER}" \
  -H "$(auth_header)" || true)"

AUTH_PROFILE_JSON="$(build_auth_profile_json)"

echo "[2/3] Merging ${CUSTOMER_SOURCE_NAME} auth profile into ${TENANT_ID}/${PROVIDER}..."
PAYLOAD="$(
  EXISTING_JSON="${EXISTING_JSON}" \
  AUTH_PROFILE_JSON="${AUTH_PROFILE_JSON}" \
  PROVIDER="${PROVIDER}" \
  QUOTA_PER_HOUR="${QUOTA_PER_HOUR}" \
  MAPPING_VERSION="${MAPPING_VERSION}" \
  ALLOWED_HOSTS_CSV="${ALLOWED_HOSTS_CSV}" \
  AUTH_PROFILE_NAME="${AUTH_PROFILE_NAME}" \
  FAILOVER_PROVIDERS_CSV="${FAILOVER_PROVIDERS_CSV}" \
  ROUTING_STRATEGY="${ROUTING_STRATEGY}" \
  ROUTING_WEIGHT="${ROUTING_WEIGHT}" \
  node -e '
    const splitCsv = (value) =>
      String(value || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

    let existing = {};
    try {
      existing = JSON.parse(process.env.EXISTING_JSON || "{}");
    } catch {
      existing = {};
    }
    if (!existing || typeof existing !== "object" || existing.error) existing = {};

    const authProfiles = {
      ...((existing.authProfiles && typeof existing.authProfiles === "object") ? existing.authProfiles : {}),
      [process.env.AUTH_PROFILE_NAME]: JSON.parse(process.env.AUTH_PROFILE_JSON)
    };

    const allowedHosts = [
      ...new Set([
        ...((Array.isArray(existing.allowedHosts) ? existing.allowedHosts : [])),
        ...splitCsv(process.env.ALLOWED_HOSTS_CSV)
      ])
    ];

    const payload = {
      provider: process.env.PROVIDER,
      enabled: true,
      allowedHosts,
      quotaPerHour: Number(process.env.QUOTA_PER_HOUR || existing.quotaPerHour || 1000),
      mappingVersion: process.env.MAPPING_VERSION || existing.mappingVersion || "v1",
      authProfiles,
      mtlsProfiles:
        existing.mtlsProfiles && typeof existing.mtlsProfiles === "object" ? existing.mtlsProfiles : {},
      failoverProviders: process.env.FAILOVER_PROVIDERS_CSV
        ? splitCsv(process.env.FAILOVER_PROVIDERS_CSV)
        : (Array.isArray(existing.failoverProviders) ? existing.failoverProviders : []),
      routingStrategy: process.env.ROUTING_STRATEGY || existing.routingStrategy || "ordered",
      routingWeight: Number(process.env.ROUTING_WEIGHT || existing.routingWeight || 5)
    };

    process.stdout.write(JSON.stringify(payload));
  '
)"

curl -sf -X POST "${API_BASE_URL}/api/v1/tenant/${TENANT_ID}/provider-config" \
  -H 'content-type: application/json' \
  -H "$(auth_header)" \
  -d "${PAYLOAD}" >/dev/null

echo "[3/3] Provider config ready."
echo "Registered:"
echo "  tenant: ${TENANT_ID}"
echo "  provider: ${PROVIDER}"
echo "  source label: ${CUSTOMER_SOURCE_NAME}"
echo "  auth profile: ${AUTH_PROFILE_NAME}"
echo "  auth type: ${AUTH_TYPE}"
echo "  allowed hosts: ${ALLOWED_HOSTS_CSV}"
