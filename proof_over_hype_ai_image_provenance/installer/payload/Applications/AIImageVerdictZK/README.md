# AI Image Verdict ZK (Demo)

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

## Run the app

```bash
cd app
npm install
npm run dev
```

## One-click setup (no keys bundled)

```bash
cd app
./setup.sh
```

Then open `.env` and paste your keys, and run:

```bash
npm run dev
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

### Option B: Detect AI Image

```bash
export AI_DETECTOR_PROVIDER=detectaiimage
export AI_DETECTOR_KEY=your_api_key_here
```

The server POSTs the image bytes to the detector and uses its result.

## ZK proof oracle key

- `ORACLE_PRIVATE_KEY` (optional): Base58 o1js private key used to sign verdicts.
  If not set, the server generates a random key each run.

## Local zkApp (for testing)

```bash
cd app
npm run deploy:local
```

This spins up a local blockchain, deploys the zkApp, and prints the keys in the console.

## Zeko Ethereum Sepolia deploy (real chain)

1. Get testnet sETH in your Auro wallet and export the private key.
2. Generate a fresh zkApp key for the contract.
3. Set the environment variables.
4. Deploy.

Example:

```bash
cd app
npm run keygen
export DEPLOYER_PRIVATE_KEY=your_auro_private_key
export ZKAPP_PRIVATE_KEY=your_new_zkapp_private_key
export ZEKO_GRAPHQL=https://sepolia.zeko.io/graphql
export ZEKO_NETWORK_ID=testnet
export TX_FEE=200000000
npm run deploy:zeko
```

When the deploy succeeds, it prints `ZKAPP_PUBLIC_KEY`. Set that in the app server to enable
submissions:

```bash
export ZKAPP_PUBLIC_KEY=your_deployed_contract_address
export SUBMITTER_PRIVATE_KEY=your_auro_private_key
export ZEKO_GRAPHQL=https://sepolia.zeko.io/graphql
export ZEKO_NETWORK_ID=testnet
export TX_FEE=200000000
npm run dev
```

Click **Submit to Zeko** in the UI. The server signs and submits the transaction.
Use **Check Status** to fetch transaction status from the Zeko GraphQL endpoint.

## Auro signing (optional)

If the user has Auro Wallet installed, the UI enables **Sign Proof (Auro)** and uses the wallet
`signMessage` API to sign the proof JSON. This is a demonstration of wallet signing.

**Submit with Auro** (recommended) builds an unsigned transaction on the server, adds the zkApp
signature (requires `ZKAPP_PRIVATE_KEY`), and asks the Auro wallet to sign and submit it.

To avoid nonce-precondition race conditions, the app clears the fee payer nonce precondition and
uses full commitment on the fee payer update (the "non-magic" flow).

## Zeko/o1js MCP helper

If you want to query Zeko network data from an MCP-enabled assistant, configure the o1js-compatible MCP helper:
`https://github.com/ronykris/mina-mcp-server`.
