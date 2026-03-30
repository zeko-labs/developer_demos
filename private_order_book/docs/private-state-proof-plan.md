# Private State Proof Plan

This market should stay fast on order entry. The design target is:

- order entry: off-chain and immediate
- matching: off-chain and immediate
- note selection: off-chain and immediate
- proofs: batched and asynchronous
- on-chain writes: settlement-root commits only

## Goals

1. Keep note-funded trading UX as fast as it is now.
2. Reduce trust in server-side note bookkeeping.
3. Preserve public market data:
   - public anonymous orders visible by price/size
   - private dark orders hidden pre-trade
   - post-trade prints still public
4. Anchor enough state on-chain that withdrawals and settlement can be audited.

## Current Anchors

The settlement zkApp already anchors:

- `settlementRoot`
- `bookRoot`
- `noteRoot`
- `nullifierRoot`
- `sequencingRoot`

These are updated on-chain at batch commit time. The current zkApp path now uses
`commitBatchWithProof(...)`, which verifies the batch private-state proof before
anchoring the next note/nullifier roots.

The operator tooling can now also inspect a Merkle-backed snapshot of the live
engine state for:

- active notes
- spent nullifiers
- sequencing receipts

See:

- `/Users/evankereiakes/Documents/Codex/private-order-book/zkapp/private-state-merkle.ts`
- `pnpm zkapp:inspect-private-state-merkle`
- `GET /api/darkpool/operator/private-state-merkle`

## Next Circuit Boundary

The next proving layer should cover **private note state transitions**, not full matching.

That means proving:

1. input notes existed under a prior note root
2. the nullifiers for those notes were not previously used
3. output notes were formed correctly
4. totals net correctly for the batch
5. the resulting `noteRoot` and `nullifierRoot` are the ones anchored on-chain

This is the right balance:

- strong privacy/state integrity
- no per-order proving latency
- no on-chain order book

The current lean implementation now uses a private-state journal and proves only
the touched entries in the note/nullifier state for each batch:

- note spends are proven against the previous note tree
- nullifier inserts are proven against the previous nullifier tree
- note outputs are proven as fresh inserts into the next note tree

That keeps the proving surface small and stable even as order flow grows.

## Statement Shape

See:

- `/Users/evankereiakes/Documents/Codex/private-order-book/zkapp/private-state.ts`

Core types there:

- `PrivateNoteCommitment`
- `PrivateNoteSpend`
- `PrivateStateRoots`
- `PrivateStateTransitionPublicInput`
- `PrivateStateTransitionPublicOutput`
- `PrivateStateTransitionWitness`
- `SequencingReceipt`

These define the data model for:

- note commitments
- note nullifiers
- batch transition hash
- sequencing metadata

## Recommended Batch Proving Flow

1. Match orders off-chain.
2. Build a settlement batch with fills and payout obligations.
3. Build a private-state witness bundle:
   - spent notes
   - produced notes
   - prior note/nullifier roots
   - sequencing receipt hash
4. Generate one proof for the batch.
5. Commit:
   - `batchHash`
   - `bookRoot`
   - `noteRoot`
   - `nullifierRoot`
   - `sequencingRoot`
   - `privateStateTransitionHash` as the prover-facing batch commitment

The next upgrade should use real Merkle witnesses derived from the same snapshot
that now powers operator inspection. That keeps the proof inputs aligned with the
state the engine is already maintaining.

Status:

- note/nullifier Merkle witnesses: done in the lean batch path
- sequencing root witness enforcement: still future work
- full matching fairness proof: still future work

For the larger-machine, proof-heavy deployment path, see:

- `/Users/evankereiakes/Documents/Codex/private-order-book/docs/full-mode-implementation.md`

## Withdrawals

Withdrawals should use the same transition model as trading:

- spend notes
- create change note if needed
- emit a withdrawal payout obligation
- include withdrawal state transition in the next batch proof

That avoids a separate trust model for note redemptions.

## Fairness

Private orders need stronger sequencing guarantees.

Recommended next step:

- issue signed sequencing receipts per accepted order
- include sequencing receipt hashes in batch transition hashes
- optionally anchor sequencing checkpoints periodically

This keeps the matcher off-chain while narrowing operator discretion.

## Performance

To keep the market fast:

- batch size target: `8-32` fills
- batch timer target: `10-20s`
- prove in background workers
- never block order entry on proof completion

## Deployment Order

1. Keep current off-chain matcher and note UX.
2. Run continuous on-chain settlement worker.
3. Add note-root persistence beside nullifier-root tracking.
4. Generate proof witness artifacts for each batch.
5. Add private-state batch prover.
6. Extend zkApp commit path to verify the proof-backed state transition.
   Status: done in the lean batch path.
7. Keep strengthening the proof boundary without touching hot-path latency:
   - sequencing receipt witness enforcement
   - stronger fairness constraints
   - optional note-tree compression / batching optimizations
