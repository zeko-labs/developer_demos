# Security Notes

## Demo Keys

The default mission-authority key is embedded for local demonstration only.

Production deployments must run with `MISSION_AUTH_PROFILE=production` and `DEMO_MODE=false`.
They must set:

```text
ZK_OAUTH_ISSUER_SECRET
MISSION_AUTHORITY_PRIVATE_JWK
MISSION_APPROVAL_BEARER_TOKEN
```

from a secret manager or HSM-backed key source.

## Enterprise Identity

SAML/OIDC providers remain the upstream source of enterprise identity.

Production deployments should configure:

```text
OIDC_ISSUER
OIDC_AUDIENCE
OIDC_JWKS_URL
```

The OIDC callback path requires an ID token, validates JWKS signatures, issuer,
audience, expiry, and nonce, then normalizes provider claims before creating
commitments. Access tokens should be handled by protected resource APIs, not as
agent identity tokens.

Map provider subjects into internal agent records with `AGENT_MAPPINGS_JSON`.
Use `provider:issuer:subject` as the stable key.

## Key Rotation

The JWKS endpoint supports key IDs. Production should publish overlapping old/new keys during rotation and include issuer metadata in discovery.

## Replay

Mission approvals include:

- mission hash
- mission snapshot
- expiry
- approved tools/scopes/rails
- approved checkpoints

Checkpoint verification enforces approval expiry, approval hash/id integrity,
agent binding, dataset binding, operation binding, rail binding, action binding,
scope binding, and checkpoint binding.

In production profile, checkpoint verification also requires `missionExecutionId`
and an idempotency key for compute or side-effect checkpoints. Domain apps should
include action-specific context in checkpoint verification and persist the
resulting enforcement receipt.

Budget counters are tracked per approval when `context.spendUsd` or
`context.amountUsd` is supplied.

## Revocation

The implementation includes an off-chain revocation registry for auth commitments. Production should pair this with either:

- short-lived approvals, or
- an anchored revocation/root model.

## What Is ZK Today

Live Zeko anchoring exists for:

- approval root updates
- execution receipt root updates

The current private-compute demo does not prove the computation itself in-circuit. It anchors commitments to the approval, data, policy, output, payment context, and receipt.

## What Is Not Yet Production-Hardened

- hosted facilitator settlement for every payment rail
- production persistence for roots and witnesses
- HSM/KMS integration for mission-authority keys
- on-chain revocation root

## Production Checklist

- Store `MISSION_AUTHORITY_PRIVATE_JWK` in KMS/HSM-backed secret storage.
- Set `MISSION_AUTH_PROFILE=production` and `DEMO_MODE=false`.
- Set `ZK_OAUTH_ISSUER_SECRET` and `MISSION_APPROVAL_BEARER_TOKEN`.
- Publish overlapping JWKS keys during rotation.
- Set `OIDC_ISSUER`, `OIDC_AUDIENCE`, and `OIDC_JWKS_URL`.
- Configure `AGENT_MAPPINGS_JSON` for each enterprise customer subject mapping.
- Persist missions, approvals, revocations, enforcement receipts, and Zeko root witnesses.
- Enforce short approval TTLs for autonomous agents.
- Require settlement proofs or verified facilitator receipts for x402 payments.
- Set `PRIVATE_COMPUTE_MIN_COHORT` for aggregate-only output policy.
- Anchor approval roots and receipt roots on Zeko on a repeatable operator schedule.
- Run remote conformance against every deployment.
