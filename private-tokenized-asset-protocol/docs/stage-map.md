# TAP Stage Map

Last updated: 2026-03-16

## How to use this

- `Completed`: stable enough to demo today
- `In Progress`: active buildout; should be checked on regularly
- `Next`: highest-leverage milestone to move the platform forward
- `Later`: important, but not the current bottleneck

## Stage 0: Protocol Framing

Status: `Completed`

- Consortium / issuer / user roles defined
- Permissioned tokenization architecture defined
- Privacy + compliance + sovereign rollup positioning defined
- Self-hosted bank-dev-team deployment goal defined

## Stage 1: Core TAP Platform

Status: `Completed`

- API gateway scaffolded
- Policy registry and version linkage working
- Settlement recording and replay/idempotency working
- Tenant provider config working
- Maker/checker issuer controls working
- Transcript and release bundle tooling working

## Stage 2: Real Proof Runtime

Status: `Completed`

- Real `o1js` verifier package working
- Real `eligibility_v1` `o1js` runtime path working
- Real `transfer_compliance_v1` `o1js` runtime path working
- zk runtime transcript packaging working

## Stage 3: Partner Adapter Demo Surface

Status: `Completed`

- Generic adapter layer working
- Plaid sandbox adapter working
- Partner certification/demo scripts working
- Operator one-command demo flow working

## Stage 4: zkTLS Source Integration

Status: `Completed`

Completed:
- External zkTLS employer flow integrated
- External zkTLS bank fixture/profile integrated
- External zkTLS proof envelope persisted as canonical TAP proof on both zkTLS source paths
- Live `zktls-employer` and `zktls-bank` transcripts passing

## Stage 5: Bank-Facing v1 Demo

Status: `In Progress`

Done:
- Real bank-shaped zkTLS source path exists
- Real policy-linked settlement exists
- Real operator/demo packaging exists
- Asset lifecycle spec for stablecoin and tokenized stock exists
- Stock lifecycle workflow API scaffold exists for `issue`, `allocate`, `restrict`, and `redeem`
- Stock lifecycle demo and transcript scripts exist
- Dual-asset flagship transcript and one-command runner exist

Remaining:
- Clear partner-facing guidance on when to use adapter mode vs zkTLS mode
- Customer-owned sandbox onboarding path and engagement packet
- Make the dual-asset flagship artifact the primary item in default public and enterprise packaging

Newly completed in this stage:
- Dual-asset flagship artifact is now the primary public-pack item
- Identity reference path now has a one-command runner, transcript generator, and verified local mock-backed transcript
- Holdings reference path now has a one-command runner, transcript generator, and verified local mock-backed transcript

## Stage 6: Production Handoff Package

Status: `Next`

- Harden persistence / backups / migrations
- Harden secrets / config provenance / preflight
- Observability / reconcile dashboards / alerts
- Adapter certification contract for partner teams
- Control mapping / threat model / production runbooks

## Current Best Next Milestone

 Tighten the customer sandbox onboarding path and extend reference coverage from mock-backed examples toward customer-owned providers and partner systems.
