# Private Order Book

ShadowBook is a private order book / dark pool demo built on Zeko with:
- note-backed private collateral
- public and private order visibility modes
- off-chain matching
- on-chain settlement anchoring through a zkApp
- a lean settlement zkApp as the default hosted path

## Network Profile

Testnet remains the default so existing hosted deployments keep running. For mainnet, use a separate environment profile with `ZEKO_NETWORK_ID=mainnet`, official mainnet endpoints, fresh settlement zkApps, real asset/token addresses, production withdrawal policy, and faucet settings disabled. See [Zeko Mainnet Readiness](../docs/zeko-mainnet-readiness.md).

## What Works

- wallet sync from on-chain balances
- deposit -> private note mint
- limit and market orders
- public book and private off-book orders
- withdrawals back to wallet
- settlement batching and zkApp root commits
- local operator tooling and proof inspection
- an advanced proof-heavy contract kept in-repo as a reference path for partner builds

## Quick Start

```bash
cd private-order-book
pnpm install
cp .env.example .env
pnpm build:zkapp
pnpm darkpool:serve
```

Open:
- [Trading UI](http://127.0.0.1:8791/darkpool)
- [Partner Frontend Example](http://127.0.0.1:8791/partner)

## Recommended Runtime Modes

### Local dev

Run the API/UI only:

```bash
pnpm darkpool:serve
```

### Demo / hosted single service

Run the server with the embedded settlement loop and lean zkApp path:

```bash
pnpm render:start
```

### Advanced proving later

If you want extra proof capacity later, keep the main service running and add:

```bash
pnpm settlement:worker:proofs:remote
```

That remote proof agent fetches the next pending proof job snapshot, builds the proof locally, and uploads the proof artifact back. The advanced proof-heavy contract remains available in `zkapp/advanced-contract.ts` as a reference path rather than the hosted default.

## Key Docs

- [Render deployment and runtime topology](./docs/deployment.md)
- [Architecture and extensibility](./docs/architecture.md)
- [Competitive architecture and privacy landscape](./docs/competitive-architecture-landscape.md)
- [Protocol runbook and local operations](./docs/runbook.md)
- [API and SDK reference](./docs/api.md)
- [SDK specification](./docs/sdk-spec.md)
- [Fee model](./docs/fee-model.md)
- [Blog explainer](./docs/blog-explainer.md)
- [Private-state proof roadmap](./docs/private-state-proof-plan.md)
- [Full-mode implementation path](./docs/full-mode-implementation.md)
- [Full-mode runbook](./docs/full-mode-runbook.md)
- [Full-mode production gaps](./docs/full-mode-production-gaps.md)
- [On-chain order book reference path](./docs/onchain-orderbook-reference.md)

## Agent Skills

This repo also ships reusable agent skills in `agent-skills/`:

- `zeko-non-magic-tx`: wallet-signed Zeko / Auro zkApp transaction handling
- `shared-liquidity-sdk`: many frontends, one liquidity engine, explicit `frontendId` routing
- `trading-ui-composer`: dense trading UI composition and execution-safe interaction design
- `prod-runbook-debugger`: live protocol triage, restart order, and status-driven debugging
- `zeko-da-privacy`: commitment-first DA publishing and encrypted payload privacy

## System Model

- client:
  - wallet connect
  - deposit signing
  - off-chain order authorization
  - UI rendering
- market server:
  - notes
  - matching
  - batching
  - APIs
- proof path:
  - precompute proofs ahead of commit
  - optionally on a separate machine
- settlement path:
  - payout handling
  - zkApp commit

Short version:
- matching stays fast and off-chain
- proving stays off the request path
- chain is used for settlement verification and root anchoring

## Notes

- This repo is demo-ready, not final trust-minimized production infrastructure.
- The top-level README stays intentionally high level; detailed ops live in `docs/`.
