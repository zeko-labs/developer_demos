# Runtime Kit

## Contents

- `apps/api-gateway`
- `packages/prover-service`
- `packages/policy-engine`
- `packages/source-adapters`
- `packages/contracts`
- scripts for bootstrap and demo evidence generation

## Responsibilities

- enforce role-based workflows
- collect off-chain evidence via adapters
- generate + verify proof envelopes
- perform policy-linked settlement recording

## Required Environment

- API keys and role map (`TAP_API_KEYS_JSON`)
- provider auth and mTLS env refs
- policy + tenant provider config
- optional Postgres (`TAP_DATABASE_URL`)

## Success Criteria

- deterministic startup and health checks
- end-to-end flows pass with transcript verification
- no critical path depends on hosted external UI
