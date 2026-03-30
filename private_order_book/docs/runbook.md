# Runbook

## Local Protocol Run

### Install

```bash
cd /Users/evankereiakes/Documents/Codex/private-order-book
pnpm install
cp .env.example .env
pnpm build:zkapp
```

### Deploy zkApp

For a fresh contract:

```bash
source .env
pnpm zkapp:deploy
```

### Start API/UI

```bash
source .env
pnpm darkpool:serve
```

Open:
- `http://127.0.0.1:8791/darkpool`
- `http://127.0.0.1:8791/partner`

## Optional Separate Local Processes

If you want to run the pieces separately instead of using embedded loops:

### Proof precompute worker

```bash
source .env
pnpm settlement:worker:proofs
```

### On-chain settlement worker

```bash
source .env
pnpm settlement:worker:onchain
```

### DA relay

```bash
source .env
pnpm da:relay
```

### Replay / bot flow

```bash
pnpm replay:demo
pnpm bot:arb
```

## Operational Checks

### Health / status

```bash
curl http://127.0.0.1:8791/api/darkpool/status
curl "http://127.0.0.1:8791/api/darkpool/fairness/audit?limit=200"
```

### zkApp state

```bash
source .env
pnpm zkapp:get-state
```

### Private state inspection

```bash
source .env
pnpm zkapp:inspect-private-state-merkle
pnpm zkapp:build-private-state-witness
pnpm zkapp:prove-private-state
```

## Suggested Demo Test Flow

1. sync wallet on-chain
2. deposit and auto-mint notes
3. place public limit orders
4. place private orders
5. execute market orders against resting liquidity
6. withdraw a small amount
7. verify settlement batches continue moving

## Transaction Flow Summary

1. user connects wallet
2. user deposits on-chain to the vault
3. server verifies deposit and mints private note balance
4. user signs off-chain order authorization
5. matcher executes off-chain
6. note spends / outputs / sequencing are journaled
7. settlement batch is created
8. proof is precomputed ahead of commit
9. settlement worker submits payouts if needed and commits batch to zkApp
10. user can withdraw note-backed collateral back to wallet
