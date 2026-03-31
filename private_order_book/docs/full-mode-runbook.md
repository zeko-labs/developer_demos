# Full Mode Runbook

This runbook is the shortest practical guide for a team that wants to stand up
the proof-heavy settlement path on serious infrastructure.

It is intentionally separate from the lean demo/runtime path.

## What Full Mode Means Here

Full mode keeps:

- off-chain order entry
- off-chain matching
- off-chain batch construction

But changes settlement so the batch commit consumes a cached private-state proof
and the advanced contract verifies that proof on-chain.

Use this path when you have:

- a larger machine or dedicated prover host
- durable shared state
- a team that can operate a long-lived proving service

Do not use this path for:

- Render demo hosting
- the default market showcase
- small single-service deployments

## Required Scripts

These are the intended full-mode entry points:

```bash
pnpm build:zkapp
pnpm zkapp:deploy:advanced
pnpm zkapp:get-state:advanced
pnpm settlement:worker:proofs:remote
pnpm zkapp:commit-next:advanced
```

## Minimum Service Topology

Production-minded full mode should be split into three long-lived roles:

1. market service
- runs `pnpm darkpool:serve`
- handles API/UI/order flow
- creates pending settlement batches

2. prover service
- runs `pnpm settlement:worker:proofs:remote`
- fetches the next pending proof job snapshot
- builds the proof artifact off the hot path

3. settlement service
- runs the advanced commit path
- consumes cached proof artifacts
- submits payouts and commits the verified batch
- should be run under a process supervisor or loop, because the current
  advanced commit command is one-shot per batch

Smallest viable serious deployment:

- one market machine
- one large prover/settlement machine
- shared durable storage for data/proof artifacts

## Suggested Machine Profile

This is not a benchmark guarantee. It is a practical starting point for teams
that want the advanced path to feel real rather than fragile.

### Market service

- 4 vCPU
- 8-16 GB RAM
- long-lived process

### Prover / settlement machine

- 8-16 vCPU
- 32-64 GB RAM
- long-lived process
- local SSD or mounted durable disk for proof artifacts

The advanced path benefits heavily from:

- warm processes
- higher RAM
- not recompiling `o1js` in the request path

## Required Env Policy

Use a separate env profile for full mode.

Minimum policy:

```env
ZKAPP_COMMIT_USE_PROOF=true
REQUIRE_CACHED_PRIVATE_STATE_PROOF=true
ALLOW_INLINE_PRIVATE_STATE_PROVING=false
AUTO_RUN_PROOF_WORKER=false
AUTO_RUN_SETTLEMENT_WORKER=false
```

That policy means:

- the market service does not try to prove inline
- the commit path refuses to run without a cached proof artifact
- proving is always externalized

See:

- `../.env.full.example`

## Bring-Up Sequence

### 1. Prepare env

Copy the advanced env template and fill in real keys/secrets:

```bash
cp .env.full.example .env.full
```

Load that env into the market, prover, and settlement services.

### 2. Build zkApp artifacts

```bash
pnpm build:zkapp
```

### 3. Deploy the advanced contract

```bash
pnpm zkapp:deploy:advanced
```

### 4. Verify advanced state access

```bash
pnpm zkapp:get-state:advanced
```

### 5. Start the market service

```bash
pnpm darkpool:serve
```

### 6. Start the proof worker

```bash
pnpm settlement:worker:proofs:remote
```

### 7. Commit a pending batch with proof

```bash
pnpm zkapp:commit-next:advanced
```

Important:

- `pnpm zkapp:commit-next:advanced` commits one pending batch and exits
- production full mode should run this under a supervisor, loop, or scheduled
  worker process so batches continue draining

## Expected Batch Lifecycle

1. a batch becomes pending in the market service
2. a proof worker picks up the next pending proof job snapshot
3. the worker builds the private-state witness
4. the worker writes/uploads a proof artifact
5. the settlement committer loads that artifact
6. payouts are submitted if required
7. the advanced zkApp verifies the proof and commits the batch

## Operational Rules

To keep full mode practical:

- never prove in the request path
- never let the settlement committer build proofs inline
- never mix advanced contract deploys with the lean contract address
- never treat local JSON as the long-term source of truth for proof jobs

## Recommended Smoke Test

A team evaluating this path should confirm:

1. one deposit flow works
2. one trade creates a pending settlement batch
3. one remote proof worker produces an artifact
4. one advanced commit succeeds on-chain
5. payout tx hashes and batch commit hashes are both recorded

That is the minimum convincing end-to-end proof-heavy path.

## What This Runbook Does Not Promise

This runbook makes the advanced path operable. It does not claim:

- turnkey production readiness
- decentralized matching
- trustless sequencing
- automatic HA orchestration

Those are separate layers and should be evaluated honestly.
