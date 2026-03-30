---
name: prod-runbook-debugger
description: Troubleshoot live protocol services quickly using deterministic checks for ports, env, chain sync, settlement queues, and process health. Use when users report runtime failures or inconsistent behavior.
---

# Prod Runbook Debugger

Use this skill for operational debugging and restart guidance.

## Triage Order
1. process/port conflicts
2. env var correctness
3. chain connectivity and account visibility
4. pending queue growth (orders/settlements/DA)
5. UI/SDK mismatch

## Standard Checks
- `lsof` on expected ports
- `/health` and `/status`
- recent audit/fairness records
- latest settlement batches
- wallet sync freshness in real-funds mode

## Restart Pattern
- resolve PID conflicts with concrete numeric PID
- restart dependent services in order:
  1. relay/adapters
  2. API engine
  3. workers
  4. bots/load generators

## Error Translation
For each error, provide:
- likely cause
- exact fix command
- verification command

## Anti-patterns
- Never tell user to run placeholder commands like `kill <PID>`.
- Never assume symbol-based markets are unique.
- Never hide stale-balance errors; auto-sync or surface explicit remediation.
