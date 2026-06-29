# Agent Coordination Protocol - Financial Intelligence Demo

This repo is a local-first demo of the **Agent Coordination Protocol (ACP)** on Zeko testnet.

## Network Profile

Testnet remains the default so existing hosted demos keep running. For mainnet, create a separate environment profile with `ZEKO_NETWORK_ID=mainnet`, official mainnet endpoints, fresh zkApp/oracle/sponsor keys, and mainnet treasury/token addresses. Do not reuse testnet artifacts or faucet-funded accounts. See [Zeko Mainnet Readiness](../docs/zeko-mainnet-readiness.md).

## What This Demo Includes

- Agent marketplace with 4 example agents
- On-chain request and attestation flow via zkApp
- Credits mode with escrowed funds and relayer-paid execution
- Private model outputs with public integrity proofs
- ACP compatibility docs and OpenClaw-oriented examples under `specs/acp/`

## Quick Start (Local)

1. Install dependencies

```bash
npm install
```

2. Create env file

```bash
cp .env.example .env
```

3. Fill required env vars in `.env`

- `ZEKO_GRAPHQL`
- `ZKAPP_PUBLIC_KEY`
- `ZKAPP_PRIVATE_KEY`
- `ORACLE_PRIVATE_KEY`
- `SPONSOR_PRIVATE_KEY` (for relayed flows)
- `ADMIN_TOKEN`

4. Build and run

```bash
npm run build
npm run dev
```

5. Open

- [http://localhost:5173](http://localhost:5173)

## Core Protocol Concepts

### ACP (Agent Coordination Protocol)

ACP standardizes agent request/response settlement with:

- request creation
- payment proof
- private output return
- optional public attestation

Specs live in `specs/acp/`.

### Escrow (Credits)

Credits mode is deposit-once, spend-many:

- user deposits MINA into protocol escrow path
- spends are tracked against credits balance
- request-time spends do not require direct wallet payment each call

### Relayer

Relayer submits protocol transactions for credits-mode UX:

- user signs deposit
- relayer submits request/attest txs where configured
- improves UX and reduces repeated wallet prompts

### Privacy Model

- prompts/outputs are not posted in plaintext on-chain
- request/output hashes are attested on-chain
- output encryption key is server-side
- proofs are public; output content remains private

## Data + Performance Notes

- `PRICE_FETCH_MODE=daily` is recommended
- daily mode uses cache/flatfiles for stable operation
- performance metrics are computed from attested outputs + available price series

## Useful Commands

Run local server:

```bash
npm run dev
```

Compile TypeScript:

```bash
npm run build
```

Deploy zkApp script:

```bash
npm run deploy:zeko
```

CLI request flow:

```bash
npm run agent-cli -- request --agent alpha-signal --prompt "AAPL momentum"
```

## Repo Structure

- `src/` - API server and protocol logic
- `public/` - browser UI
- `data/` - local state and caches
- `specs/acp/` - ACP docs, schemas, examples
- `src/zk/` - zkApp contract + transaction builders

## Disclaimer

Testnet demo only. Not financial, investment, legal, or tax advice.
