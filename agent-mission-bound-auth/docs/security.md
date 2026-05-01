# Security Notes

## Demo Keys

The default mission-authority key is embedded for local demonstration only.

Production deployments must set:

```text
MISSION_AUTHORITY_PRIVATE_JWK
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

and verify JWTs before creating commitments or approvals.

## Key Rotation

The JWKS endpoint supports key IDs. Production should publish overlapping old/new keys during rotation and include issuer metadata in discovery.

## Replay

Mission approvals include:

- mission hash
- mission snapshot
- expiry
- approved tools/scopes/rails
- approved checkpoints

Checkpoint verification enforces approval expiry, agent binding, dataset binding, operation binding, rail binding, action binding, and checkpoint binding.

Domain apps should include action-specific context in checkpoint verification. For high-value side effects, add a nonce or idempotency key to `context` and persist the resulting enforcement receipt.

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
- Publish overlapping JWKS keys during rotation.
- Set `OIDC_ISSUER`, `OIDC_AUDIENCE`, and `OIDC_JWKS_URL`.
- Persist missions, approvals, revocations, enforcement receipts, and Zeko root witnesses.
- Enforce short approval TTLs for autonomous agents.
- Anchor approval roots and receipt roots on Zeko on a repeatable operator schedule.
- Run remote conformance against every deployment.
