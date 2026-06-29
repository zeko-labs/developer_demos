# AI Image Verdict ZK (Demo)

[![CI](https://github.com/Evan-k-global/Proof_over_Hype_AI-image-provenance/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Evan-k-global/Proof_over_Hype_AI-image-provenance/actions/workflows/ci.yml)

**Local Demo Quick Start**
1. `cp .env.example .env`
2. Fill in your own keys in `.env`
3. `npm install`
4. `npm run dev`
5. Open `http://localhost:5173`

**Public Demo limits**
- Public demo usage is limited to **3 analyses per IP per day for shared API keys**.
- Users can bypass limits by supplying their own detector API keys in the UI.
- Optional hCaptcha support is available for public demos.

## Network Profile

Testnet remains the default for provenance anchoring demos. For mainnet, use a separate environment profile with `ZEKO_NETWORK_ID=mainnet`, official mainnet endpoints, a fresh provenance zkApp, production oracle/submission keys, and separate keychain/env values. Do not reuse packaged testnet artifacts. See [Zeko Mainnet Readiness](../docs/zeko-mainnet-readiness.md).

**Demos**
- `assets/demo_app.png`
- `assets/Proof_over_Hype-demo.mov`

Detector API keys can be obtained from (or any preferred service):
- Sightengine: https://sightengine.com

A minimal demo app that:

- Accepts a web page URL
- Extracts image URLs from the page
- Runs a real AI-image detector (or falls back to a heuristic)
- Generates a ZK proof (o1js) that an oracle signed the verdict
- Optionally signs the proof payload with an Auro wallet (front-end only)
- Can submit the proof to a Zeko zkApp on testnet (server-side signer)

## What the proof asserts

This demo does **not** prove that a model is correct inside the circuit. Instead, it proves that a
trusted oracle signed a verdict for a specific image hash. This is the practical way to bridge
real-world classifiers to ZK: the model runs off-chain, and the circuit verifies the signed result.

## Merkle root anchoring (history)

Each attested image is added to a Merkle tree off-chain, and the **root** is stored on-chain. This
lets anyone verify historical entries without storing all hashes on-chain. The tree is stored in
`data/merkle.json` and anchored via the zkApp state.

Note: changing the zkApp state layout (e.g. adding `merkleRoot`) requires **redeploying** the zkApp.

## Run the app

Prereqs:
- Node.js 20+ installed
- npm (comes with Node)

Terminal steps (from scratch):
1) Open Terminal
2) Go to the project folder:

```bash
cd /Users/evankereiakes/Documents/Codex/app
```

3) Install dependencies:

```bash
npm install
```

4) (Optional) Set detector keys:

```bash
export AI_DETECTOR_PROVIDER=sightengine
export AI_DETECTOR_USER=your_api_user
export AI_DETECTOR_SECRET=your_api_secret
```

5) Start the server:

```bash
npm run dev
```

6) Open the app in your browser:

```
http://localhost:5173
```

If you prefer a single command after the first install, you can just run:

```bash
npm run dev
```

## Required: Use your own keys

This repo **never** ships private keys or API keys. You must supply your own:

- AI detector API keys (Sightengine)
- Zeko/Mina keys (oracle, deployer, submitter, zkApp)

## Optional: Captcha (public demo)

For public demos, you can enable hCaptcha:

```bash
export HCAPTCHA_SITE_KEY=your_site_key
export HCAPTCHA_SECRET=your_secret
```

If hCaptcha is not set, the demo will run without it (and rely on IP limits).

Create your `.env` from the template:

```bash
cp .env.example .env
```

Then fill in your keys. Do **not** commit `.env` to git.

If you prefer, you can store private keys in the macOS Keychain:

```bash
npm run set-keychain
```

The app will read from Keychain if env vars are missing.

## One-click setup (no keys bundled)

```bash
cd app
./setup.sh
```

Then open `.env` and paste your keys, and run:

```bash
npm run dev
```

## macOS .pkg installer

Build the installer:

```bash
cd app
./make_pkg.sh
```

Install by double-clicking `dist/AIImageVerdictZK.pkg`. After install, run:

```
/Applications/AIImageVerdictZK/Start App.command
```

Open `http://localhost:5173`.

## AI detector setup (real checker)

By default, the server falls back to a heuristic. To use a real detector, set **one** of these:

### Option A: Sightengine (recommended)

```bash
export AI_DETECTOR_PROVIDER=sightengine
export AI_DETECTOR_USER=your_api_user
export AI_DETECTOR_SECRET=your_api_secret
```

The server sends the image URL to Sightengine's `genai` model.

The server uses Sightengine’s `genai` model for AI image detection.

## ZK proof oracle key

- `ORACLE_PRIVATE_KEY` (optional): Base58 Mina private key used to sign verdicts.
  If not set, the server generates a random key each run.

## Local zkApp (for testing)

```bash
cd app
npm run deploy:local
```

This spins up a local blockchain, deploys the zkApp, and prints the keys in the console.

## Zeko testnet deploy (real chain)

1. Get testnet MINA in your Auro wallet and export the private key.
2. Generate a fresh zkApp key for the contract.
3. Set the environment variables.
4. Deploy.

Example:

```bash
cd app
npm run keygen
export DEPLOYER_PRIVATE_KEY=your_auro_private_key
export ZKAPP_PRIVATE_KEY=your_new_zkapp_private_key
export ZEKO_GRAPHQL=https://testnet.zeko.io
export ZEKO_NETWORK_ID=zeko
export TX_FEE=200000000
npm run deploy:zeko
```

When the deploy succeeds, it prints `ZKAPP_PUBLIC_KEY`. Set that in the app server to enable
submissions:

```bash
export ZKAPP_PUBLIC_KEY=your_deployed_contract_address
export SUBMITTER_PRIVATE_KEY=your_auro_private_key
export ZEKO_GRAPHQL=https://testnet.zeko.io
export ZEKO_NETWORK_ID=zeko
export TX_FEE=200000000
npm run dev
```

Click **Submit to Zeko** in the UI. The server signs and submits the transaction.
Use **Check Status** to fetch transaction status from the Zeko GraphQL endpoint.

## Redeploy after Merkle upgrade

Adding the Merkle root to the zkApp state changes the on-chain layout, so you must redeploy:

1. Generate a new zkApp key:

```bash
cd app
npm run keygen
```

2. Fund the new `ZKAPP_PUBLIC_KEY` with 1 MINA (Zeko testnet).
3. Deploy:

```bash
export ZEKO_NETWORK_ID=testnet
export TX_FEE=100000000
npm run deploy:zeko
```

4. Update your `.env` with the new `ZKAPP_PUBLIC_KEY` and `ZKAPP_PRIVATE_KEY`.
   You can use:

```bash
npm run set-keys
```

### Optional: store private keys in macOS Keychain

Instead of keeping private keys in `.env`, you can store them in the macOS Keychain:

```bash
npm run set-keychain
```

The app will read from Keychain if the env vars are missing.

### Clear a key from .env

```bash
npm run clear-env-key
```

### Clear all keys from .env

```bash
npm run clear-env-all
```

### Clear Keychain entries

```bash
npm run clear-keychain
```
5. Reset the local Merkle tree to the empty root:

```bash
cat > data/merkle.json <<'EOF'
{
  "height": 20,
  "nextIndex": 0,
  "leaves": []
}
EOF
```

## GitHub publishing (safe by default)

This repo is safe to publish if you keep secrets out of git:

1. Ensure `.env` is not committed (already in `.gitignore`).
2. Use `.env.example` for placeholders.
3. Never commit `data/merkle.json` or `data/proofs.json` (already ignored).


## Troubleshooting: Auro signer “magic” nonce bug

If you see errors like:

- `Account_nonce_precondition_unsatisfied`
- `Authorization kind does not match the authorization (expected Proof)`
- `Invalid_fee_excess`

…this is usually caused by the **default o1js transaction “magic”** which injects account
preconditions (especially fee payer nonce constraints) that don’t match the state in Auro or the
network. The fix is to build a **non‑magic fee payer update** and use **full commitment**, which
removes brittle nonce constraints and makes the transaction Auro‑friendly.

**What fixed it in this repo**

- Clear fee payer nonce preconditions
- Set `useFullCommitment` to `true`
- Ensure the zkApp nonce is explicitly required
- Avoid implicit “magic” transaction assumptions

This logic is already implemented in:

- `src/server.ts` (build + submit paths)

**Tips and lessons learned**

- Always fetch the **current on‑chain nonce** right before building a tx.
- Auro uses the fee payer nonce you provide, so avoid “magic” nonce preconditions.
- If you switch zkApp state layout (e.g., add Merkle root), **redeploy** the zkApp.
- If verification fails, confirm the **stored proof root** vs **current on‑chain root**:
  historical proofs remain valid, but may not match the latest root.

**Useful resources**

- o1js zkApps docs: https://docs.o1labs.org/o1js
- Zeko overview: https://docs.zeko.io/introduction/what-is-zeko.html
- Auro wallet: https://github.com/aurowallet

## Auro signing (optional)

If the user has Auro Wallet installed, the UI enables **Sign Proof (Auro)** and uses the wallet
`signMessage` API to sign the proof JSON. This is a demonstration of wallet signing.

Submissions are **signed in the browser** via Auro. The server builds the unsigned transaction,
adds the zkApp signature (requires `ZKAPP_PRIVATE_KEY`), and Auro signs and sends it.

If `ZKAPP_PUBLIC_KEY` is missing, the app derives it from `ZKAPP_PRIVATE_KEY` (env or Keychain).

To avoid nonce-precondition race conditions, the app clears the fee payer nonce precondition and
uses full commitment on the fee payer update (the "non-magic" flow).

## Mina MCP server

If you want to query Mina network data from an MCP-enabled assistant, configure the Mina MCP server:
`https://github.com/ronykris/mina-mcp-server`.
