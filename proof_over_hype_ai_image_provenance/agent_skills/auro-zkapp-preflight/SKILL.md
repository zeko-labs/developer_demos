---
name: auro-zkapp-preflight
description: Preflight checks for Auro + zkApp submissions on Zeko, including network, fee payer, authorization kind, nonce, and mempool state.
---

# Auro zkApp Preflight

Use this skill before invoking `window.mina.sendTransaction(...)`.

## Trigger signals

- Wallet confirm hangs or times out.
- `Authorization kind does not match the authorization`.
- Tx built server-side but rejected in wallet.

## Procedure

1. Verify wallet network matches app network (`testnet`/`zeko`).
2. Verify fee payer account in wallet is intended signer.
3. Fetch chain nonce for fee payer and check mempool pending tx count.
4. Ensure tx payload contains required account updates and authorization fields.
5. Confirm zkApp permissions on-chain allow the intended state update path.
6. Confirm fee is integer nanomina and reasonable for current network.

## Validation

- Pre-submit endpoint returns nonce and pending count.
- Tx payload passes auth-kind sanity checks.
- Wallet confirms and tx hash is produced.

## Notes

- If there is pending fee payer traffic, submit races are expected; retry policy is required.
- Network/account mismatch is the most frequent wallet timeout cause.
