# Production Readiness Checklist

Use this as the go-live gate for a bank/consortium deployment.

## 1. Security

- All partner credentials are env/key-vault managed.
- No raw secrets in API payloads or logs.
- Auth/mTLS lifecycle metadata present for all active profiles.
- `/api/v1/diag/credentials` has no `expired` or `rotation_overdue` profiles.

## 2. Compliance and Governance

- Policy versioning workflow approved.
- Settlement-time policy linkage guard enabled.
- Maker-checker enforced for mint/burn.
- Audit retention policy defined for NDJSON and transcript artifacts.

## 3. Reliability

- Source adapter timeout/retry/circuit breaker config defined.
- Reconciliation + finality sync jobs running.
- Idempotency and replay behavior validated.

## 4. Integration Quality

- Contract tests passing for each enabled adapter.
- Sandbox to pre-prod promotion checklist completed.
- Failure mode drills executed (provider outage, auth failure, stale policy).

## 5. Operational Readiness

- Runbooks reviewed by operations and security teams.
- On-call alert routes configured.
- Recovery playbooks tested.

## 6. Evidence and Audit

- End-to-end transcript pack generated and verified.
- sha256 fingerprints archived.
- Approval and settlement records linked for every issuance event.
