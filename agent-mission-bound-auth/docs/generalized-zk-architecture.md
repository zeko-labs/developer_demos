# Generalized ZK Mission-Bound Auth Architecture

This document is a technical disclosure draft for acquisition and patent
counsel review. It is not a filed patent application, legal opinion, or claim
set.

## Field

The architecture relates to authorization, verification, and settlement systems
for delegated and autonomous software agents. More specifically, it describes a
computer-implemented protocol for converting enterprise identity assertions
into mission-scoped agent capabilities, proving runtime possession of a mission
holder key, verifying boundary actions against a task policy, generating
privacy-preserving work receipts, and releasing settlement only when the
receipts and proofs satisfy the mission.

## Problem

Existing OAuth, OIDC, SAML SSO, API key, and resource authorization systems
identify a user or application, but they do not prove that an autonomous agent:

1. represented a specific principal for a specific mission;
2. possessed the approved holder key at the time of action;
3. stayed inside a task, data, tool, domain, budget, rail, and expiry boundary;
4. produced a receipt that can be verified without revealing private data; and
5. tied settlement or payout to a verifiable proof of compliant work.

The missing layer is a mission-bound authorization and proof envelope that sits
between enterprise identity, agent runtimes, private data systems, external
apps, payment rails, and verifiable settlement networks.

## Summary

Agent Mission-Bound Auth provides that layer. The system receives a verified
identity assertion from an identity provider, normalizes provider-specific
claims into canonical mission claims, constructs cryptographic commitments,
binds the mission to an agent or runtime holder key, issues a signed approval,
records boundary events, verifies checkpoints before side effects, prepares a
portable receipt, proves policy compliance using zero-knowledge or signed
commitment proofs, anchors approval and receipt roots, and releases settlement
only when proof and payment bindings match the mission.

The architecture is network-aware but not limited to one payment rail. Zeko is
the native production anchoring and settlement path for this implementation. A
Zeko-compatible network can provide equivalent root anchoring, nullifier
checking, settlement verification, and conditional payout semantics when
approved by Zeko Labs.

## Components

### Identity Issuer

An enterprise identity source such as Auth0, Okta, another OIDC provider, a
SAML-backed broker, or a delegated identity provider authenticates the
represented principal and issues a signed identity assertion.

### Claim Normalizer

A server-side normalizer verifies issuer signature, audience, expiry, token
type, nonce, and tenant configuration. It maps provider-specific claims into a
canonical claim set containing principal identity, organization, agent id,
runtime id, scopes, data access, payment rails, budget, issuer proof digest,
and token hash.

### Mission Authority

The mission authority issues agent passports, mission proposals, approvals,
revocations, and enforcement receipts. It signs portable artifacts and exposes
JWKS so third parties can verify those artifacts offline.

### Holder Runtime

The holder runtime is the agent execution environment or wallet-like component
that controls a mission-bound private key. Boundary events must demonstrate
holder participation through signatures, holder commitments, message
signatures, wallet signatures, ZK-friendly signatures, or equivalent proof of
possession.

### Domain Verifier

The domain verifier is the external application, API, merchant, data service,
private compute service, or agent marketplace that checks whether an action is
permitted before it performs a side effect.

### Trace Recorder

The trace recorder emits an append-only sequence of boundary events. Each event
includes the mission id hash, action type, resource or domain commitment,
payment or side-effect idempotency key, previous event hash, timestamp, holder
proof, and event hash.

### Proof System

The proof system verifies that private boundary events comply with the public
mission policy while revealing only commitments. It may be implemented with a
zero-knowledge circuit, recursive proof, validity proof, signed receipt graph,
or staged migration from signed receipts to ZK proofs.

### Registry And Settlement Network

The registry maintains approval roots, receipt roots, nullifiers, sequence
ordering, and settlement state. The settlement network checks the receipt,
policy, payment authorization, nullifier, and root membership before permitting
release of funds, compute credits, or agent compensation.

## Canonical Data Objects

### Normalized Claim

The normalized claim binds identity-provider output to protocol semantics:

```text
provider
issuer
subject
audience
agentId
runtimeId
organization
scopes
datasetScopes
computeScopes
railScopes
budget
issuedAt
expiresAt
tokenHash
issuerProofDigest
```

### Capability

The capability is a mission-bound right to act. It includes:

```text
capabilityId
issuer
audience
principalHash
agentId
runtimeId
holderKeyCommitment
missionId
allowedDomains
allowedActions
dataScopes
paymentRails
maxSpend
expiry
jti
nullifierSeed
settlementReleaseCondition
```

### Mission Policy

The policy defines the task boundary. It covers action vocabulary, resources,
domains, tools, data egress limits, aggregate-only constraints, budget, payment
rails, checkpoints, expiry, and required receipt fields. The `policyHash` is
computed over canonicalized policy data.

### Approval

The approval binds a mission policy to an approver and authority signature. It
includes the mission snapshot, capability hash, approved checkpoints,
expiration, authority JWS, and anchoring commitment.

### Boundary Event

Each boundary event records:

```text
eventVersion
missionIdHash
capabilityHash
policyHash
eventType
targetDomainHash
resourceHash
actionHash
paymentContextDigest
sideEffectId
idempotencyKey
previousEventHash
observedAt
expiresAt
holderProof
eventHash
```

The `previousEventHash` creates an append-only trace chain. A broken chain
invalidates the receipt.

### Receipt Export

The receipt is a redacted, portable, independently verifiable artifact. It
contains hashes and commitments, not raw prompts, private data, page text,
selectors, credentials, payment secrets, or private vault values.

```text
receiptId
missionIdHash
capabilityHash
policyHash
holderKeyThumbprint
traceHash
latestEventHash
datasetCommitment
outputHash
paymentCommitment
paymentContextDigest
statementHash
proofSystem
verificationKeyHash
nullifier
registryRoot
anchorReference
settlementState
```

### Registry Anchor

The registry anchor records append-only state:

```text
registryVersion
sequence
missionIdHash
capabilityHash
statementHash
payloadDigest
receiptIdHash
nullifier
previousRoot
newRoot
anchoredAt
networkId
registryAddress
txHash
```

## Representative Method

1. Receive an identity assertion from an enterprise identity provider.
2. Verify the assertion against pinned issuer, audience, nonce, expiry, and
   JWKS trust roots.
3. Normalize provider claims into canonical mission and agent claims.
4. Construct stable commitments over normalized claims and salts.
5. Bind a holder key or runtime key to the agent passport and capability.
6. Issue a mission policy containing task, data, tools, domains, rails, budget,
   expiry, checkpoints, and settlement release condition.
7. Sign an approval over the mission policy and capability hash.
8. Anchor the approval commitment or approval root.
9. Before each payment, private compute run, external side effect, or receipt
   finalization, verify the approval and checkpoint context.
10. Record a holder-signed boundary event linked to the prior event hash.
11. Reject replay through idempotency keys, nullifiers, mission execution ids,
    and registry state.
12. Generate a receipt that binds mission, policy, dataset, output, trace,
    payment context, and settlement condition.
13. Prove, using a ZK proof or staged signed-proof system, that the private
    trace complied with the public mission policy.
14. Anchor the receipt commitment or receipt root.
15. Permit settlement release only when the receipt, proof, nullifier, payment
    authorization, and registry root are valid.

## ZK Statement

### Plain English Statement

Given a private sequence of boundary events, prove that every event was
authorized by the holder key, chained to the prior event, within the mission
policy, before expiry, not replayed, tied to the dataset/output commitments,
and bound to the payment commitment and receipt hash.

### Public Inputs

```text
issuerRoot
capabilityHash
policyHash
holderKeyCommitment
traceRoot
latestEventHash
receiptHash
datasetCommitment
outputHash
paymentCommitment
paymentContextDigest
nullifier
registryRoot
expiry
```

### Private Witness

```text
normalizedClaims
claimSalts
missionPolicy
boundaryEvents
domainsAndActions
holderSignatures
eventNonces
policyInclusionMaterial
paymentAuthorizationDetails
datasetOpeningMaterial
```

### Constraints

The proof system checks that:

- capability and policy commitments are derived from canonical data;
- holder proofs verify against the committed holder key;
- each boundary event includes the same mission and capability;
- each event hash chains to the previous event hash;
- each action is included in the allowed action set;
- each target domain or resource is included in the allowed set;
- event timestamps precede capability and approval expiry;
- aggregate spend does not exceed the mission budget;
- data outputs match the declared egress policy;
- payment authorization binds rail, amount, asset, payer, payee, mission,
  policy, receipt, and nullifier;
- the receipt hash is derived from the trace, policy, output, and payment
  commitments; and
- the nullifier is unique for the settlement release condition.

## Settlement Release

Settlement release is a conditional transition, not a simple payment callback.
The settlement verifier checks:

```text
approval commitment is anchored
receipt/root commitment is anchored
receipt hash matches submitted receipt
policy hash matches mission policy
payment context digest matches authorization
nullifier has not been spent
settlement rail is approved for the mission
proof verifies under the expected verification key
```

If all checks pass, the settlement state can transition to
`settlement_release_allowed` and then `settled`. If any check fails, the
settlement state remains `not_ready`, `release_denied`, `duplicate_payment`,
`expired_authorization`, `policy_violation`, or `manual_review`.

## Claim-Drafting Candidates

These are technical concepts for patent counsel to convert into formal claims:

1. A method for transforming an enterprise identity assertion into a
   mission-bound autonomous-agent capability with a holder key commitment.
2. A method for verifying autonomous-agent boundary actions by comparing
   checkpoint context against a signed mission policy and an approval snapshot.
3. A method for generating a privacy-preserving receipt that binds identity,
   mission, policy, private data commitment, output commitment, payment
   authorization, and settlement context.
4. A method for proving in zero knowledge that a private trace of agent actions
   complied with a public mission policy.
5. A method for preventing duplicate settlement of agent work using
   mission-scoped nullifiers and append-only receipt roots.
6. A method for releasing payment or compensation only after a registry verifies
   a mission-bound receipt/root proof.
7. A system in which OIDC or SAML identity, mission approvals, holder proofs,
   ZK receipts, x402 payment context, and verifiable settlement roots are bound
   into one portable authorization envelope.

## Deployment Embodiments

### Sidecar

A sidecar service sits next to an existing application and provides identity
login, claim normalization, mission approval, checkpoint verification, receipt
export, and registry anchoring.

### Embedded SDK

An SDK embeds verifier logic into a domain application so the application can
verify mission approvals and receipts without calling the sidecar for every
decision.

### Registry-First

A registry or settlement contract stores approval roots, receipt roots, and
nullifiers. Applications submit receipt payloads and proofs to the registry
before settlement.

### Private Compute

A private compute service receives a mission approval, runs computation over
private data, emits only output commitments or aggregate outputs, and creates a
receipt whose data and output commitments can be verified without revealing the
underlying private data.

## Security Boundaries

The architecture proves authority, holder participation, policy compliance,
trace integrity, replay resistance, and settlement binding. It does not prove
that an LLM reasoned correctly, that a website fulfilled an order honestly, or
that every DOM event was observed. Domain applications remain responsible for
their own business-specific proof of work and fulfillment attestations.

## Strategic Scope

The generalized protocol is larger than a login flow and larger than a single
demo application. It is an authorization and settlement layer for verifiable
agent work. The canonical implementation uses Zeko-compatible anchoring and
settlement so builders can adopt the protocol while preserving a production
path for proof-carrying receipts and conditional payouts.
