---
name: zeko-non-magic-fee-payer
description: Build nonce-safe Zeko transactions by replacing o1js default fee-payer preconditions with full-commitment flow and explicit nonce handling.
---

# Zeko Non-Magic Fee Payer

Use this skill when wallet or server submissions fail with nonce/precondition errors on Zeko testnet.

## Trigger signals

- `Account_nonce_precondition_unsatisfied`
- `Invalid_fee_excess`
- Auro confirm succeeds but tx does not land

## Procedure

1. Fetch fresh fee payer nonce from chain immediately before tx construction.
2. Build transaction with explicit sender and fee.
3. Remove fee payer account nonce precondition.
4. Set fee payer `useFullCommitment` to `true`.
5. Keep zkApp account nonce requirement explicit (`zkapp.account.nonce.requireEquals(...)`).
6. Sign required updates and submit.
7. On nonce race, refetch nonce and retry once with incremented nonce.

## Validation

- Tx JSON has the expected fee payer public key and current nonce.
- No stale nonce constraints remain on fee payer update.
- Submission no longer fails with nonce precondition error.

## Notes

- This is the primary fix for nonce instability in browser-wallet + server hybrid flows.
- Do not rely on implicit o1js "magic" defaults for fee payer updates on Zeko.
