---
name: zeko-wallet-connect
description: Use this skill when connecting a browser client to Auro on Zeko, reading the active account and network, requesting signatures, sending signed transactions, or debugging wallet connection and signing failures.
---

# Zeko Wallet Connect

Use this skill for browser-to-wallet flows on Zeko Ethereum Sepolia.

## Focus

- Detect Auro and fail clearly if it is missing.
- Read the active public key and active network before building a transaction.
- Build unsigned transactions server-side, sign client-side, then submit through the wallet.
- Treat wallet transport, signature, and network mismatches as first-class errors.

## Workflow

1. Read runtime config from `/api/config`.
2. Detect Auro in the browser and request account access.
3. Confirm the wallet is on the expected network before asking for a signature.
4. Call the server transaction builder endpoint.
5. Ask the wallet to sign and submit.
6. Poll status or fetch the resulting request state.

## Repo touchpoints

- Browser UI: `/Users/evankereiakes/Documents/Codex/app1/public/app.js`
- Server config: `/Users/evankereiakes/Documents/Codex/app1/src/server.ts`
- zk transaction builders: `/Users/evankereiakes/Documents/Codex/app1/src/zk`

## Required inputs

- `ZEKO_GRAPHQL`
- `ZKAPP_PUBLIC_KEY`
- Client access to Auro

## Common failures

- `ZEKO_GRAPHQL env var not set`
- Auro pointed at the wrong network
- wallet account differs from fee payer or requester
- tx build is slow and the user believes the wallet stalled
- upstream RPC returns `502` or nonce-related errors

## Output

Return a connected wallet state, an accepted transaction hash, or a precise error with the failing step.
