# ZK Mission Authorization Protocol 0.1

## Purpose

Agent Mission-Bound Auth is a task-bound control protocol for delegated and autonomous agents.

It answers:

> Is this exact agent, representing this exact principal, approved to perform this exact action, against this exact resource, right now?

The protocol combines enterprise identity, task-bound approval, x402 payment, checkpoint enforcement, and Zeko anchoring.

## Actors

- **Agent**: autonomous or delegated software actor.
- **Represented principal**: user, organization, or service the agent acts for.
- **Mission authority**: service that issues agent passports and mission approvals.
- **Approver**: human, policy engine, IdP, or governance system approving a mission.
- **Domain app**: application performing the actual work or side effect.
- **Verifier**: party checking passports, approvals, bundles, receipts, or Zeko roots.

## Discovery

Mission authorities publish:

```text
GET /.well-known/agent-authorization.json
GET /.well-known/mission-authority-jwks.json
```

The first document describes protocol endpoints and capabilities. The second publishes public signing keys for offline verification.

## Agent Passport

`agent-passport-v1` identifies:

- `agentId`
- `agentIdentifier`
- represented principal
- vouching parties
- agent key binding
- mission-authority JWS

The passport is portable and can be verified offline.

## Mission

`mission-bound-agent-auth-v1` is a task-bound scope object.

It defines:

- agent
- represented principal
- natural-language task
- dataset/resource
- operation
- allowed tools
- allowed OAuth/resource scopes
- allowed payment rails
- spend and data-egress constraints
- required checkpoints
- expiry

## Approval

`mission-approval-v1` binds an approver to a mission.

It includes a mission snapshot so a domain app can verify the approval without querying the original server. It is signed as ES256 JWS and may include a Zeko anchor reference.

## Checkpoints

Recommended checkpoints:

- `before_payment_offer`
- `before_private_compute`
- `before_external_side_effect`
- `after_receipt`

Domain apps call:

```text
POST /api/mission/verify-checkpoint
```

or verify the approval offline using the JWKS and enforce equivalent policy locally.

## Bundle

`zk-mission-bundle-v1` is the portable handoff object containing:

- agent passport
- mission
- approval
- auth commitments
- payment receipt
- domain receipt
- Zeko references

The `bundleHash` is the canonical audit handle.

## Zeko Anchoring

Zeko roots provide independent auditability:

- `authRoot`: mission approval / authorization commitments
- `receiptRoot`: execution receipt commitments
- `datasetRoot`: optional committed dataset registry

Production deployments should anchor both:

```text
Before action: approval commitment
After action: execution receipt commitment
```

## Non-Goals

The protocol does not define domain-specific work. Apps still own their own private compute, trading, procurement, email, code execution, or payment semantics.

The included private-compute UI is a tutorial harness, not part of the protocol.
