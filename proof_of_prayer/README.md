# Proof of Prayer

Proof of Prayer is a Zeko + o1js application for private, permanent, community-supported prayer.

## Network Profile

Testnet remains the default for hosted demos and sponsored anchoring experiments. For mainnet, use a separate environment profile with `ZEKO_NETWORK_ID=mainnet`, official mainnet endpoints, a fresh prayer batch zkApp, production sponsor/deployer keys, and reviewed moderation/sponsorship policy. Do not reuse testnet funding or faucet assumptions. See [Zeko Mainnet Readiness](../docs/zeko-mainnet-readiness.md).

Users can:
- write an encrypted private prayer in the browser
- optionally publish an anonymized public version for the community
- submit directly on-chain with Auro
- submit without a wallet and enter a sponsorship queue
- sponsor queued prayers on-chain for others
- track receipts, transaction status, and IPFS records

## What makes it different

Proof of Prayer combines four things that are usually separated:
- private prayer text via client-side encryption
- public community participation via shared prayer cards
- permanent proof via Zeko batch anchoring
- low-friction access via wallet sponsorship for non-wallet users

## Current MVP features

- private and shared prayer submission
- wallet submit path
- non-wallet submit path into a queue
- sponsor batch flow
- community prayer feed with search and religion filters
- my prayers dashboard with decrypt flow
- tx status polling: queued, submitted, confirmed, failed
- IPFS CID actions and batch-root verification
- batch receipts with sponsor attribution
- moderation queue for UI-only hide/approve actions
- local repo skill for Auro/Zeko wallet debugging

## Stack

- `o1js`
- `Zeko`
- `Auro Wallet`
- `Express`
- `TypeScript`
- `Pinata/IPFS` for encrypted payload pinning

## Quick start

```bash
cd proof_of_prayer
cp .env.example .env
npm install
PORT=5174 npm run dev
```

Open:
- `http://localhost:5174`

## Required env

At minimum set these in `.env`:

```bash
ZEKO_GRAPHQL=...
ZEKO_NETWORK_ID=testnet
TX_FEE=100000000
PRAYER_ZKAPP_PRIVATE_KEY=...
PRAYER_ZKAPP_PUBLIC_KEY=...
DEPLOYER_PRIVATE_KEY=...
```

Optional:

```bash
PINATA_JWT=...
PINATA_ENDPOINT=https://api.pinata.cloud/pinning/pinJSONToIPFS
IPFS_GATEWAY=https://gateway.pinata.cloud/ipfs/
ADMIN_KEY=...
```

## Key commands

```bash
npm run dev
npm run build
npm run keygen:prayer
npm run deploy:prayer
```

## Repo notes

- local runtime data lives in `data/` and is gitignored
- secrets in `.env` are gitignored
- inherited `developer_demos/` content is gitignored for this repo
- the repo-local wallet debugging skill lives in `skills/zeko-auro-zkapp-debug/`
- market writeup lives in `docs/market-innovations-and-extensions.md`

## Docs in this repo

- product notes: `NOTES.md`
- wallet debug skill: `skills/zeko-auro-zkapp-debug/SKILL.md`
- market writeup: `docs/market-innovations-and-extensions.md`

## External references

- o1js docs: https://docs.o1labs.org/o1js
- Zeko docs: https://docs.zeko.io/introduction/what-is-zeko.html
- Auro Wallet: https://github.com/aurowallet
- Mina MCP server: https://github.com/ronykris/mina-mcp-server
