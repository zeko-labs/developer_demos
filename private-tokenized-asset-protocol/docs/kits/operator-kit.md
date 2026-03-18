# Operator Kit

## Diagnostics

- `GET /api/v1/health`
- `./scripts/preflight_v1_demo.sh` (static + runtime gating)
- `GET /api/v1/diag/credentials` (admin-only)
- `GET /api/v1/diag/providers` (admin-only provider health + circuit state)
- `GET /api/v1/reliability/source-retry-queue` (admin-only)
- `GET /api/v1/reliability/source-dlq` (admin-only)
- `POST /api/v1/reliability/source-retry/run-once` (admin-only)
- `POST /api/v1/reliability/source-dlq/replay` (admin-only)
- settlement and policy audit trails in `output/*.ndjson`

## Required Operational Jobs

- preflight gate before demo/prod-run (`RUN_RUNTIME=1 ./scripts/preflight_v1_demo.sh`)
- settlement reconciliation loop
- external finality sync loop
- retry and dead-letter processing for adapter failures
- review adapter dead-letter queue: `output/source-adapter-dlq.ndjson`

## Credential Operations

- monitor `rotation_due_soon`, `rotation_overdue`, `expires_soon`, `expired`
- rotate before `rotateBy`
- replace before `expiresAt`
- validate env refs after rotation
- for Increase adapter mode, set:
  - `INCREASE_API_KEY`
  - optional `INCREASE_BASE_URL` (default `https://api.increase.com`)
- for `zk-o1js-proof` verification path, set:
  - `ZK_O1JS_VERIFY_CMD`
  - optional: `ZK_O1JS_VERIFICATION_KEY_HASH`
  - recommended package CLI: `node packages/o1js-verifier/dist/cli.js`

## Preferred Real Sandbox Target

Use `increase` as the first real server-to-server target beyond fixture mode.

- fit:
  - bearer auth
  - direct account balance endpoint
  - current and available balances in minor units
  - cleaner operator flow than consumer-linked banking APIs
- TAP provider contract:
  - `provider: "increase"`
  - `source.accountId`
  - optional `source.baseUrl`
  - optional `source.apiKeyEnv`
  - optional `source.minBalanceCents`
  - optional `source.requirePositiveAvailable`
  - optional `source.requireOpenAccount`

## Incident Response

- auth/provider outage runbook
- policy mismatch runbook
- nonce/finality reconciliation runbook
