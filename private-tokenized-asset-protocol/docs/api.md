# API Summary

Base URL: `/api/v1`

Auth:
- Protected endpoints require `Authorization: Bearer <api-key>` (or `x-api-key`).
- Keys and roles are configured via `TAP_API_KEYS_JSON`.

## Core

- `GET /health`
- `GET /config/public`
- `POST /admin/demo/reset` (admin-only)
  - clears settlement store, issuer workflow state, source idempotency/usage maps, and local audit files
  - works for both file-backed and Postgres settlement stores
- `GET /diag/credentials` (admin-only)
  - reports credential lifecycle and env-presence status by tenant/provider/profile
  - statuses: `ok`, `rotation_due_soon`, `rotation_overdue`, `expires_soon`, `expired`, `missing_env_secret`
  - optional query filters:
    - `tenantId`
    - `provider`
    - `rotateSoonDays` (default from `TAP_DIAG_ROTATE_SOON_DAYS` or `14`)
    - `expireSoonDays` (default from `TAP_DIAG_EXPIRE_SOON_DAYS` or `14`)
- `GET /diag/providers` (admin-only)
  - provider circuit-breaker and health telemetry by `tenantId/provider`
  - optional query filters:
    - `tenantId`
    - `provider`
- `GET /diag/providers/ranked` (admin-only)
  - ranked provider recommendation
  - required query:
    - `providers` (comma-separated)
  - optional query:
    - `tenantId`
    - `strategy`: `ordered` | `health-weighted`
- `GET /reliability/source-retry-queue` (admin-only)
  - lists pending retry worker queue items
- `GET /reliability/source-dlq` (admin-only)
  - lists source dead-letter entries (`limit` query supported)
- `POST /reliability/source-retry/run-once` (admin-only)
  - manually executes one retry worker tick
  - body optional: `{ "maxItems": 5 }`
- `POST /reliability/source-dlq/replay` (admin-only)
  - replay dead-letter entry by `dlqId` or direct `requestData`
  - body:
    - `{ "dlqId": "...", "searchLimit"?: 200 }`
    - or `{ "requestData": <SourceAdapterRequest> }`
- `POST /routing/config/upsert` (admin-only)
  - update tenant-provider routing controls:
    - `failoverProviders`
    - `routingStrategy`
    - `routingWeight`
- `GET /routing/configs`
  - list routing controls by tenant (admin can list all)

## Attestation

- `POST /attest/upload-statement`
- `POST /attest/verify-phone`
- `POST /attest/identity/persona/webhook`
  - verifies Persona webhook HMAC signature (`persona-signature` or `x-persona-signature`)
  - expected header format: `t=<unix_seconds>,v1=<hex_hmac_sha256>`
  - signing payload: `${t}.${raw_request_body}`
  - env:
    - `PERSONA_WEBHOOK_SECRET` (required)
    - `PERSONA_WEBHOOK_TOLERANCE_SEC` (optional, default `300`)
- `POST /attest/holdings/custody/webhook`
  - verifies custody webhook HMAC signature (`x-custody-signature` or `custody-signature`)
  - expected header format: `t=<unix_seconds>,v1=<hex_hmac_sha256>`
  - signing payload: `${t}.${raw_request_body}`
  - env:
    - `CUSTODY_WEBHOOK_SECRET` (required)
    - `CUSTODY_WEBHOOK_TOLERANCE_SEC` (optional, default `300`)
- `GET /attest/source/providers`
- `POST /attest/source/collect`
  - Body:
    - `provider`: `mock-bank` | `generic-rest` | `plaid` | `persona` | `custody-holdings`
    - `subjectCommitment`: `string`
    - `policyId`: `number` (default `1`)
    - `settle`: `boolean` (default `true`)
    - `idempotencyKey`: `string` (optional; replays same response for duplicate request key)
    - `failover` (optional):
      - `strategy`: `ordered` | `health-weighted`
      - `providers`: ordered fallback providers
      - `sources`: provider-keyed source payload overrides
    - `source`: provider-specific payload
      - `mock-bank`: `{ balanceCents?, kycPassed?, accountStatus? }`
      - `generic-rest`: `{ url, method?, headers?, body?, authProfile?, mappingVersion?, timeoutMs?, retryCount?, extract? }`
      - `plaid`: `{ accessToken, clientIdEnv?, secretEnv?, baseUrl?, minBalanceCents?, requirePositiveBalance? }`
      - `persona`: `{ inquiryId, baseUrl?, apiKeyEnv?, requirePassed?, acceptedStatuses? }`
      - `custody-holdings`: `{ accountId, assetSymbol?, certificateId?, baseUrl?, apiKeyEnv?, minUnits?, requireCertificateValid? }`
  - Error format:
    - `{ "error": { "code": "...", "message": "...", "retryable": boolean, "details"?: object } }`
  - Reliability behavior:
    - circuit breaker rejects provider calls when open (`503 upstream_unavailable`)
    - repeated failures move provider to `open` until timeout elapses
    - failures are written to dead-letter audit file: `output/source-adapter-dlq.ndjson`
    - retryable failures enqueue background retries with capped attempt/budget controls
    - response includes `selectedProvider`, `attemptedProviders`, `failoverUsed`, `routingStrategy`, and `rankedProviders`
  - Tenant-aware behavior:
    - when `tenantId` is provided, tenant provider config is applied (allowlist/auth profiles/quota)
    - active policy is resolved and linked into proof input (`policyVersion`, `policyHash`, `jurisdiction`)
    - default failover and routing strategy/weights are read from tenant provider config
  - Plaid notes:
    - defaults to `PLAID_CLIENT_ID` and `PLAID_SECRET` env vars
    - optional `PLAID_BASE_URL` override (default `https://sandbox.plaid.com`)
    - for multi-tenant setups, keep creds in env/key-vault and only pass `accessToken` in request
  - Settlement enforcement:
    - when `settle=true`, active policy snapshot is validated at settlement time
    - proof linkage must match active snapshot: `tenantId`, `policyId`, `policyVersion`, `policyHash`
    - reject reasons: `policy_linkage_missing`, `active_policy_not_found`, `policy_version_mismatch`, `policy_hash_mismatch`
  - Auth:
    - requires API key
    - tenant-scoped access is enforced (`tenantId` must match actor tenant unless admin)
- `GET /attest/zktls/status`
- `GET /attest/zktls/latest`
- `POST /attest/zktls/run` (`{ "mode": "eligible" | "ineligible" }`)
- `POST /attest/zktls/ingest`
  - Optional body:
    - `mode`: `eligible` | `ineligible`
    - `runPipelineFirst`: `boolean`
    - `subjectCommitment`: `string`
    - `settle`: `boolean`
    - `tenantId`: `string` (required when `settle=true`)
    - `policyId`: `number` (required when `settle=true`)
  - Settlement guard:
    - validates active `(tenantId, policyId)` against proof linkage at settlement time
    - same rejection reasons as `POST /settlement/record`

## Proof

- `POST /proof/eligibility`
- `POST /proof/transfer-compliance`
- `POST /proof/verify`
- `GET /proof/:proofId`

## Settlement

- `POST /settlement/record`
  - Required proof linkage in `proof.publicInput` (or metadata fallback):
    - `tenantId`, `policyId`, `policyVersion`, `policyHash`
  - Settlement-time guard:
    - resolves active policy for `(tenantId, policyId)`
    - requires exact match on `policyVersion` and `policyHash`
  - Response includes:
    - `policySnapshotHash`
    - `policyEffectiveAt`
  - Rejection reasons:
    - `policy_linkage_missing`
    - `active_policy_not_found`
    - `policy_version_mismatch`
    - `policy_hash_mismatch`
- `POST /settlement/zktls/submit-latest`
  - Optional body:
    - `runId`: `string` (use a specific zkTLS run output directory id)
    - `subjectCommitment`: `string`
    - `tenantId`: `string` (required for settlement acceptance)
    - `policyId`: `number` (required for settlement acceptance)
  - Settlement guard:
    - validates active `(tenantId, policyId)` against proof linkage at settlement time
- `GET /settlement/:settlementId`
- `GET /settlement/recent`

## Finality Sync

- `POST /finality/sync/zktls-latest`
  - Optional body:
    - `runId`: `string` (must match submit run for deterministic sync)
    - `subjectCommitment`: `string`

## Tenant Config

- `POST /tenant/:tenantId/provider-config`
- `GET /tenant/:tenantId/provider-configs`
- `GET /tenant/:tenantId/provider-config/:provider`
  - Auth:
    - write requires `CONSORTIUM_ADMIN`
    - read requires tenant scope (`CONSORTIUM_ADMIN` or matching tenant)

## Policy

- `POST /policy/upsert`
- `GET /policy/:tenantId/:policyId/versions`
- `GET /policy/:tenantId/:policyId/active`
  - Auth:
    - write requires `CONSORTIUM_ADMIN`
    - read requires tenant scope (`CONSORTIUM_ADMIN` or matching tenant)

## Risk Controls

- `POST /risk/config/upsert`
  - admin-only
  - body:
    - `tenantId`
    - `operation`: `eligibility` | `mint` | `burn`
    - `enabled`
    - optional limits: `minScore`, `maxPerTxnAmountCents`, `maxDailyAmountCents`, `maxSubjectDailyAmountCents`, `maxRequestsPerHour`
- `GET /risk/configs`
  - admin can list all or by `tenantId`
  - non-admin requires tenant scope + `tenantId`
  - optional filter: `operation`

Enforcement:
- `POST /attest/source/collect` with `settle=true` enforces `eligibility` risk controls before settlement persistence.
- `POST /settlement/record` enforces `mint`/`burn`/`eligibility` risk controls before settlement persistence.
- rejection format:
  - `{ "error": "risk_*", "detail": { ... }, "riskConfig": { ... } }`

## Issuer / Transfer / Bridge

- `POST /issuer/mint/request`
- `POST /issuer/burn/request`
- `POST /issuer/stock/issue/request`
- `POST /issuer/stock/allocate/request`
- `POST /issuer/stock/restrict/request`
- `POST /issuer/stock/redeem/request`
- `GET /issuer/requests`
- `POST /issuer/mint/:requestId/approve`
- `POST /issuer/mint/:requestId/reject`
- `POST /issuer/burn/:requestId/approve`
- `POST /issuer/burn/:requestId/reject`
- `POST /issuer/issue/:requestId/approve`
- `POST /issuer/issue/:requestId/reject`
- `POST /issuer/allocate/:requestId/approve`
- `POST /issuer/allocate/:requestId/reject`
- `POST /issuer/restrict/:requestId/approve`
- `POST /issuer/restrict/:requestId/reject`
- `POST /issuer/redeem/:requestId/approve`
- `POST /issuer/redeem/:requestId/reject`
  - Maker-checker rules:
    - maker role creates request (`ISSUER_MAKER` or admin)
    - checker role approves/rejects (`ISSUER_CHECKER` or admin)
  - Supported issuer workflow kinds:
    - stablecoin: `mint`, `burn`
    - tokenized stock: `issue`, `allocate`, `restrict`, `redeem`
    - self-approval is blocked (`maker_checker_separation_required`)
  - Settlement guard for `mint`/`burn`:
    - `POST /settlement/record` requires `metadata.issuerRequestId`
    - request must be `approved` before settlement, else rejected with:
      - `issuer_request_linkage_missing`
      - `issuer_request_not_found`
      - `issuer_request_not_approved`
- `POST /transfer/request`
- `POST /bridge/exit/request`
- `POST /bridge/entry/request`

## Auditor

- `GET /auditor/events`

See `docs/openapi.yaml` for starter schemas.
