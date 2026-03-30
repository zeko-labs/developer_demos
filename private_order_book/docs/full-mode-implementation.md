# Full Mode Implementation Path

This document describes the **full / proof-heavy settlement path** as an
alternative to the current lean hosted default.

Use this path when:

- you want stronger on-chain verification of private-state correctness
- you are willing to run a larger machine or dedicated prover service
- you accept higher operational complexity than the lean demo/hosted path

Do **not** treat this as the default hosted mode. The lean contract in
`zkapp/contract.ts` is the main deployment path today because it is much
smaller and more reliable operationally.

## Lean vs Full

### Lean default

The current default path:

- matches off-chain
- computes note/nullifier state off-chain
- submits payouts off-chain
- anchors resulting roots on-chain with the lean contract

The chain verifies:

- zkApp authorization
- batch sequencing
- root updates

The chain does **not** verify:

- note membership correctness
- nullifier freshness correctness
- note output correctness
- full private-state transition correctness

### Full mode

The full mode path keeps the same off-chain matcher, but changes settlement so
the chain verifies a proof that the private-state transition was correct.

That means verifying:

1. spent notes existed under the previous `noteRoot`
2. nullifiers were fresh under the previous `nullifierRoot`
3. output notes were inserted correctly
4. batch accounting netted correctly
5. the resulting `noteRoot` and `nullifierRoot` are the correct next state

## Current Code Surfaces

These code paths already exist and are the starting point for full mode:

- advanced contract:
  - `/Users/evankereiakes/Documents/Codex/private-order-book/zkapp/advanced-contract.ts`
- proof program:
  - `/Users/evankereiakes/Documents/Codex/private-order-book/zkapp/private-state-prover.ts`
- proof statement / witness model:
  - `/Users/evankereiakes/Documents/Codex/private-order-book/zkapp/private-state.ts`
- proof input builder:
  - `/Users/evankereiakes/Documents/Codex/private-order-book/zkapp/private-state-artifacts.ts`
- optional proof-capable commit path:
  - `/Users/evankereiakes/Documents/Codex/private-order-book/zkapp/commit-next-batch.ts`
- proof worker paths:
  - `/Users/evankereiakes/Documents/Codex/private-order-book/scripts/private-state-proof-worker.js`
  - `/Users/evankereiakes/Documents/Codex/private-order-book/scripts/private-state-proof-agent.js`

## What Still Needs To Be Done

### 1. Keep the advanced contract as a separate deployment target

Do not merge the advanced proof contract back into the default hosted contract.

Instead:

- keep `zkapp/contract.ts` lean
- keep `zkapp/advanced-contract.ts` as the full-mode contract
- add explicit advanced deploy/get-state scripts if we want to run this path regularly

Recommended follow-up scripts:

- `zkapp:deploy:advanced`
- `zkapp:get-state:advanced`
- `zkapp:commit-next:advanced`

These scripts now exist in `package.json` and are the intended entry points for
the proof-heavy contract path.

That keeps the lean path operationally clean.

### 2. Treat proving as its own long-lived service

Full mode should run proving outside the market request path and outside the
small hosted service profile.

Recommended runtime split:

1. market service
2. prover service
3. settlement/commit service

The prover and settlement service can share a machine if it is large enough,
but they should still be separate long-lived processes.

Minimum production shape for full mode:

- one canonical market service
- one dedicated prover box
- one settlement writer
- shared durable state

### 3. Make proof artifacts first-class durable objects

Right now the repo already supports cached proof artifacts. For production full
mode, we should make them durable and explicit:

- proof job created when a batch becomes pending
- proof artifact stored durably after completion
- settlement commit consumes only completed proof artifacts
- no inline proving in the commit path

Recommended storage:

- Postgres row for proof job status
- object storage or durable disk for proof JSON/artifacts

### 4. Keep payout submission idempotent

Before full mode is considered production-ready, payout submission must stay
safe under prover or commit retries.

Current principle:

- payouts must never be resent just because proving failed or the committer restarted

Required production behavior:

- claim batch
- check for existing payout submission record
- reuse previous payout tx hashes if already submitted
- only mark batch committed after payout verification plus zkApp commit succeed

### 5. Enforce bounded witness size

Full mode stays viable only if the proof surface remains bounded.

Keep and enforce hard caps such as:

- maximum note spend updates per batch
- maximum note output updates per batch
- maximum nullifier updates per batch

If a batch exceeds bounds:

- split it before proving

Do not let witness size grow with unbounded market activity.

### 6. Extend proof coverage deliberately

The current proof model is already the right starting boundary:

- note membership
- nullifier updates
- note outputs

The next likely additions are:

- sequencing receipt witness enforcement
- stronger batch accounting constraints
- optional withdrawal-specific constraints if we want withdrawals proved in the same batch model

Do **not** try to prove the matching engine itself on-chain.

That would add large cost and complexity while undermining the latency profile
we want for this market.

## Production Full-Mode Flow

1. matcher creates a pending settlement batch
2. market service writes a proof job
3. prover service builds Merkle witnesses and produces proof artifact
4. settlement service loads proof artifact
5. settlement service submits payouts if needed
6. settlement service calls advanced zkApp `commitBatchWithProof(...)`
7. chain verifies proof and anchors next roots
8. batch is marked committed locally

## Infra Requirements

Full mode should assume:

- a machine sized for heavy `o1js` compile/prove workloads
- long-lived processes to amortize compile cost
- monitoring for:
  - proof queue depth
  - proof latency
  - commit success/failure
  - payout retry safety
- durable shared state rather than local JSON as the source of truth

For production, prefer:

- Postgres for jobs and market state
- durable object storage or mounted disk for proof artifacts

## Recommended Env / Runtime Policy

When we come back to full mode, the intended policy should be:

- `ZKAPP_COMMIT_USE_PROOF=true`
- `REQUIRE_CACHED_PRIVATE_STATE_PROOF=true`
- `ALLOW_INLINE_PRIVATE_STATE_PROVING=false`

That ensures:

- no inline proving in settlement commit
- no heavy proof generation on the market service
- full mode remains explicit and operationally disciplined

## Recommendation

When we revisit this path:

1. add explicit advanced deploy/commit scripts
2. move proof jobs and artifacts to durable shared storage
3. run the advanced contract only on a dedicated prover/settlement machine
4. keep lean mode as the baseline production/demo fallback

That gives us a fully viable larger-machine implementation path without
reintroducing the full-mode costs into the normal hosted service.
