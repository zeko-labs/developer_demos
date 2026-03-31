# Full Mode Production Gaps

This document is intentionally blunt.

The advanced/full path in this repo is real and useful, but it is still an
advanced implementation path, not a turnkey production deployment.

Use this checklist to understand what is already in place and what an
infrastructure-heavy team should still close before calling it production-ready.

## Already In Place

- separate advanced settlement contract
- private-state proof program
- proof-capable commit path
- remote proof worker entry point
- explicit advanced deploy/get-state/commit scripts
- isolated on-chain order book reference path
- clear separation from the lean demo/runtime path

## Gaps To Close Before Production

### 1. Durable proof job state

Current repo state:

- proof artifacts and job coordination are still lighter-weight than a true
  production queue and storage model

Production expectation:

- durable job status
- clear ownership/claiming of jobs
- persistent artifact references
- retry-safe state transitions

Recommended implementation:

- Postgres for proof jobs and batch status
- mounted disk or object storage for proof artifacts

### 2. Commit/payout idempotency audit

Current repo state:

- payout handling has been hardened substantially
- but full mode still deserves a dedicated retry/idempotency audit as its own
  production readiness step

Production expectation:

- repeated worker restarts cannot duplicate payouts
- partial failures cannot leave a batch in an ambiguous state
- commit retries reuse prior payout records safely

### 3. Advanced-path end-to-end validation

Current repo state:

- the advanced path is implemented and scriptable
- but the repo does not yet present a “fully validated production advanced
  deployment” claim

Production expectation:

- one documented end-to-end advanced batch flow
- proof generation timing captured on real machines
- commit success confirmed under repeated runs

### 4. Bounded batch enforcement under load

Current repo state:

- the proof boundary is intentionally scoped
- but full mode still depends on keeping witness growth bounded

Production expectation:

- explicit limits for spends, outputs, and nullifier updates
- safe batch splitting before proving
- no silent growth of witness size as traffic rises

### 5. Monitoring and alerting

Current repo state:

- the demo/runtime exposes useful status surfaces
- but full mode should not rely on ad hoc observation

Production expectation:

- proof queue depth monitoring
- proof latency monitoring
- payout success/failure monitoring
- commit success/failure monitoring
- stalled batch alerts

### 6. Clear operator procedures

Current repo state:

- advanced scripts exist
- but the operational handoff is still more engineer-readable than ops-ready

Production expectation:

- one bring-up checklist
- one recovery checklist
- one rollback/fallback checklist

See:

- `./full-mode-runbook.md`

## What Is Not A Gap

These are not missing because they are out of scope for the design:

- proving the matching engine on-chain
- decentralized matching
- decentralized sequencing
- fully trustless order-flow privacy

Those are different architecture choices, not unfinished tasks in this path.

## Honest Summary

A strong team can absolutely take this full path and build on it today.

What they are getting is:

- a real advanced implementation path
- a coherent proof-heavy settlement architecture
- enough code and scripts to continue with confidence

What they are not getting is:

- a fully productized production deployment out of the box

That distinction should stay explicit.
