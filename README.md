# Zeko Developer Demos

A collection of practical demos for building zero-knowledge apps and agent systems on Zeko/Mina.

## What this repo includes

- End-to-end ZK app demos (frontend + backend + contract flows)
- Wallet-connected transaction flows (Auro + optional MetaMask Snap paths)
- Practical request/payment/attestation patterns for agent systems

## Featured demos

- `agent_coordination_protocol-financial_intelligence`
  - Privacy-preserving agent marketplace
  - On-chain request/payment/attestation flow
  - Credits + relayer path for better UX/privacy
  - Verifiable performance metrics and proofs feed

- `perfect-weather_prediction_market`
  - Private weather prediction market on Zeko
  - Hosted market, oracle worker, and tx-prover split
  - Wallet-signed bets and claims with zk-backed transactions
  - zkTLS-backed weather resolution and agent integration hooks

- `proof_over_hype_ai_image_provenance`
  - Provenance-oriented AI image workflow
  - Verifiable metadata/claims pattern for generated media

## Core docs and links

### Zeko + Mina
- Zeko Docs: https://docs.zeko.io/
- Mina Docs: https://docs.minaprotocol.com/
- o1Labs / o1js Docs: https://docs.o1labs.org/
- Mina zkApps overview: https://minaprotocol.com/zkapps

### Wallet + faucet
- Auro Wallet: https://www.aurowallet.com/
- Auro Wallet download: https://www.aurowallet.com/download/
- Zeko faucet: https://faucet.zeko.io/

### MetaMask Snap references
- MetaMask Snaps Quickstart: https://docs.metamask.io/snaps/get-started/quickstart
- Mina Portal Snap: https://snaps.metamask.io/snap/npm/mina-portal/
- Mina Snap wiki: https://github.com/sotatek-dev/mina-snap/wiki
- Mina Snap repo: https://github.com/sotatek-dev/mina-snap
- Mina + MetaMask announcement: https://minaprotocol.com/blog/metamask-snaps-integrates-mina-protocol-enabling-metamasks-millions-of-users-to-manage-mina-transactions

## Quick start (generic)

```bash
git clone <repo-url>
cd developer_demos/<demo-folder>
npm install
cp .env.example .env
npm run build
npm run dev
