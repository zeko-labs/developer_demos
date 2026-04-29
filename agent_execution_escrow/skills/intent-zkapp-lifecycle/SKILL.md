---
name: intent-zkapp-lifecycle
description: Use when changing the per-intent zkApp, lifecycle proving logic, or the sync path that mirrors agent transaction state onto Zeko.
---

# Intent zkApp Lifecycle

Use this skill when the change touches the Zeko-native state machine.

## Focus

- Define or modify per-intent zkApp state.
- Keep lifecycle progression proof-checked.
- Sync backend transaction snapshots into reproducible zkApp updates.
- Preserve approval threshold and timestamp invariants.

## Workflow

1. Update state or lifecycle rules in `zkapp-test/src/NavaIntentZkApp.ts`.
2. Keep the sync bridge aligned in `src/zekoIntentSync.js`.
3. Adjust proving and deployment logic in `zkapp-test/scripts/sync-intent.ts`.
4. Verify lifecycle invariants with `zkapp-test/scripts/check-lifecycle.ts`.
5. Confirm read paths still interpret on-chain state correctly with `zkapp-test/scripts/read-intent.ts`.

## Repo Touchpoints

- `zkapp-test/src/NavaIntentZkApp.ts`
- `src/zekoIntentSync.js`
- `zkapp-test/scripts/sync-intent.ts`
- `zkapp-test/scripts/check-lifecycle.ts`
- `zkapp-test/scripts/read-intent.ts`

## Guardrails

- Never allow backward status transitions.
- Never allow verifier approval counts or timestamps to decrease.
- Fetch fresh zkApp state before proving updates.
- Keep the lifecycle model aligned with `PENDING -> APPROVED -> EXECUTED -> SETTLED`.

## Output

Return a Zeko-native lifecycle that enforces the trust boundary in-chain instead of leaving it to backend state alone.
