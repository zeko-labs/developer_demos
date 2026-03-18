# Rollup Assumptions

TAP is designed to operate with a private/permissioned sovereign rollup, but does not implement rollup infrastructure itself.

## Assumed External Capabilities

- Permissioned sequencer/validator topology.
- Account and asset privacy model suitable for regulated institutions.
- On-chain verification hooks for proof-linked settlement events.
- Bridge rails for controlled asset movement to public Ethereum when needed.

## Integration Contract

TAP expects:
- deterministic tx/event identifiers for settlement linkage,
- clear finality statuses (`submitted`, `confirmed`, `failed`),
- replay-safe submission semantics and nonce-safe sequencing,
- chain data APIs for reconciliation and audit.

## Deployment Guidance

- Keep TAP and rollup infrastructure as separate deployable stacks.
- Treat TAP as compliance/risk/issuance control-plane.
- Treat rollup as execution/data-availability plane.
