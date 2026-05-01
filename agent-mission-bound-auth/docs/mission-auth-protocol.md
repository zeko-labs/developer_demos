# Mission Authorization Protocol

Agent Mission-Bound Auth is the control plane for task-bound autonomous agents.

It closes the gap between enterprise OAuth, MCP-style resource authorization, x402 payment, and Zeko-verifiable execution receipts.

## What This Protocol Owns

- Agent identity: an agent passport says who the agent is, who it represents, and who vouches for it.
- Mission scope: a task-bound authorization object defines the specific work, resources, tools, rails, budget, and expiry.
- Approval: a signed approval object binds a human, enterprise policy engine, or identity provider to the mission.
- Enforcement: every meaningful checkpoint asks whether the current action is inside the approved mission.
- Receipt linkage: compute/action receipts include mission, auth, policy, data, output, and payment commitments.
- Zeko anchoring: mission approvals and execution receipts can be anchored as roots or commitments.

## What Domain Apps Own

- The domain-specific action: private compute, procurement, trading, email, calendar, code execution, or payments.
- Their own resource policy: which datasets, tools, or side effects exist.
- Their own proof of work: the output hash, result commitment, or domain-specific verifier.

## Boundary

```text
Agent / enterprise IdP / SAML / OIDC
        ↓
Agent passport
        ↓
Mission proposal
        ↓
Approval
        ↓
Checkpoint enforcement
        ↓
x402 payment
        ↓
Domain app execution
        ↓
Zeko receipt root
```

The protocol answers:

> Is this exact agent, representing this principal, approved for this exact task, using this exact tool/resource/payment rail, right now?

Domain apps answer:

> What work did I perform, and what domain-specific proof or output commitment did I produce?

## Why This Is Different

OAuth/OIDC proves identity and broad authorization.

AAuth gives agents cryptographic HTTP identity and mission concepts.

MCP Auth gives resource-server OAuth plumbing.

Stripe ACP/SPT and x402/MPP address payments.

This protocol binds them into an auditable task envelope and anchors the envelope on Zeko, so approvals and execution can be independently checked after the fact.

## Discovery

Protocol-aware apps discover this control plane at:

```text
/.well-known/agent-authorization.json
```

The discovery document advertises passport, mission, approval, checkpoint verification, x402, and Zeko receipt capabilities.

## Portable Bundle

The portable handoff object is `zk-mission-bundle-v1`.

It can contain:

- `agentPassport`
- `mission`
- `approval`
- `auth`
- `payment`
- `receipt`
- `zeko`

The bundle hash is the stable unit another application can persist, sign, or anchor.

## Adapter Pattern

External apps should call:

```text
POST /api/mission/verify-checkpoint
```

before side effects such as email, trading, procurement, file export, or private-data compute.
