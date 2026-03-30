---
name: zeko-non-magic-tx
description: Use when building or debugging Zeko wallet-signed zkApp transactions, especially Auro flows that require explicit fee-payer handling, nonce-safe transaction building, or sequencer-backed fee selection.
---

# Zeko Non-Magic Tx

Use this skill for Zeko transaction builders that must survive real wallet signing.

## Core pattern

1. Build the transaction with an explicit sender and fee.
2. Fetch live account state close to build/send time.
3. Normalize the fee payer update:
   - clear fee payer nonce precondition
   - set `useFullCommitment = true`
4. Keep the fee in one place only.
5. Sign only with keys the server actually owns.
6. Leave wallet-owned authorizations empty so the wallet can sign them.

## Fee handling

- Keep fees in raw nanomina internally.
- If the sequencer exposes live mempool fees, prefer a live suggestion over a static fallback.
- If no live fee source is available, fall back to configured `TX_FEE`.
- Do not label a configured fallback as a sequencer-estimated fee.

## Auro-specific cautions

- `Invalid_fee_excess` usually means the fee is specified twice or in conflicting shapes.
- `Authorization kind does not match` usually means a proof/signature boundary is wrong.
- For wallet-submitted zkApp txs, preserve proof-bearing updates and strip wallet-side authorizations.
- For Mina fungible-token transfers, Auro is often more reliable when the transaction is submitted as stringified zkApp JSON through `sendTransaction`, with `feePayer` supplied externally.
- Lumina’s practical Auro workaround is worth preserving: if `transaction.feePayer.body.fee === "0"`, change it to `"1"` before wallet submission.
- For more complex FT transfers, prefer `onlySign: true` in the wallet and submit the signed `zkappCommand` from the backend with the sequencer `sendZkapp` mutation.

## In this repo

- Main implementation: `/Users/evankereiakes/Documents/Codex/private-order-book/src/darkpool-server.js`
- UI submission path: `/Users/evankereiakes/Documents/Codex/private-order-book/public/darkpool.html`
- Reuse this skill before changing fee payer, nonce, or wallet submission behavior.
