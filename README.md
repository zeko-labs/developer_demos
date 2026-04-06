# Zeko Developer Demos

A monorepo of end-to-end demos for building zero-knowledge applications on Zeko and Mina.

This repository is meant to be practical. Each demo is a working reference for a different product or protocol pattern: private markets, agent payments, order books, provenance, and privacy-preserving consumer apps.

## What’s in this repo

### `agent_coordination_protocol-financial_intelligence`
A privacy-preserving agent marketplace and payment flow.

Includes:
- request / accept / deliver / attest lifecycle
- wallet-connected payments
- relayer and credits paths for smoother UX
- verifiable performance and settlement patterns

### `perfect-weather_prediction_market`
A private weather prediction market on Zeko.

Includes:
- hosted market frontend
- oracle worker and tx-prover services
- wallet-signed bet and claim flows
- event-driven market state and zk-backed settlement

### `private_order_book`
A private order book exchange demo.

Includes:
- note-backed trading flows
- public-anonymous and private-dark order types
- off-chain matching with on-chain settlement anchoring
- reference zkApp and matching infrastructure

### `private-tokenized-asset-protocol`
A tokenized asset protocol demo for private and programmable asset flows.

Includes:
- app and package structure for multi-part protocol development
- supporting infra and scripts
- examples of more complex repo organization around a Zeko app

### `proof_of_prayer`
A private prayer journal and community prayer wall.

Includes:
- client-side encrypted prayer content
- wallet and non-wallet submission paths
- sponsored anchoring and moderation flows
- proof-of-participation style product patterns

### `proof_over_hype_ai_image_provenance`
A provenance-oriented AI media demo.

Includes:
- image provenance and metadata flows
- attestable claims patterns
- example frontend and backend wiring for verifiable media UX

## How to use this repo

This is a monorepo of independent demos, not a single app.

The normal workflow is:

1. Clone the repository.
2. Choose one demo folder.
3. Read that demo’s local `README.md` and `docs/`.
4. Install dependencies for that demo.
5. Configure its environment variables.
6. Run only that demo’s services.

## Recommended prerequisites

Before running most demos, have these ready:

- Node.js 20+
- `pnpm`
- Git
- An Auro wallet for Mina / Zeko flows
- Access to Zeko testnet endpoints if the selected demo requires them

Optional, depending on the demo:
- Docker / Docker Compose
- Rust toolchain
- additional API keys or attestation / oracle credentials

Not every demo needs the same setup. The demo-specific README is the source of truth.

## Quick start

```bash
git clone https://github.com/zeko-labs/developer_demos.git
cd developer_demos
```

Then pick a demo, for example:

```bash
cd perfect-weather_prediction_market
pnpm install
cp .env.example .env
pnpm build
pnpm dev
```

If a demo uses multiple services, follow that demo’s local docs instead of assuming a single `dev` command is enough.

## Repo structure

At a high level, most demos follow some variation of:

- `src/` application or service code
- `public/` frontend assets
- `docs/` setup notes and operational guidance
- `scripts/` helper scripts
- `skills/` or agent-oriented workflow instructions where relevant
- `deploy/` or infra-specific deployment material where relevant

Some demos are intentionally lightweight. Others include multiple services, external integrations, or more advanced protocol references.

## Choosing a demo

If you want to explore:

- agent payments and attestations: `agent_coordination_protocol-financial_intelligence`
- private prediction markets: `perfect-weather_prediction_market`
- private trading systems: `private_order_book`
- programmable asset flows: `private-tokenized-asset-protocol`
- privacy-preserving consumer apps: `proof_of_prayer`
- provenance / media verification: `proof_over_hype_ai_image_provenance`

## Notes

- Treat each demo as its own product surface.
- Do not assume environment variables, ports, or services are shared across demos.
- Some demos include experimental or reference-only components that are not required for the default local run path.
- Demos are reference examples for developers, and are not audited. Each team is responsible for their own deployment and audit of any code from this repo that is used in production.

## Troubleshooting

Start with the local docs for the specific demo you are running.

Good places to check first:
- that demo’s `README.md`
- that demo’s `docs/`
- environment variable examples
- wallet / network configuration
- service-specific deployment notes
