# Zeko AI Marketplace (Prototype)
[![CI](https://github.com/Evan-k-global/agent-coordination-protocol_financial-intelligence/actions/workflows/ci.yml/badge.svg)](https://github.com/Evan-k-global/agent-coordination-protocol_financial-intelligence/actions/workflows/ci.yml)

A working prototype for a privacy-first AI stock recommendation marketplace on Zeko. Users pay a
small on-chain fee (via Auro) to trigger a private model run. The app stores request attestations
with a Merkle root and an oracle signature, leaving room for multiple competing agents.

## Key Benefits (vs. traditional Web2 + public tournaments)

- **Private signals, verifiable trust:** Outputs stay off-chain and encrypted while hashes are anchored on Zeko.
- **Tamper-proof performance history:** Attested outputs allow independent verification of rankings.
- **Agent marketplace economics:** Each agent sets pricing and treasury.
- **Composable, multi-output responses:** Agents can return structured JSON across multiple symbols.
- **Neutral settlement:** On-chain payments reduce reliance on centralized processors.

## How It Works

This product is a **verified signal marketplace**. Models run **off-chain** (for privacy and speed),
while Zeko stores **hashes and attestations** that make the marketplace trustworthy.

Flow:

1. The UI creates a request payload (`/api/intent`) and receives an access token for later retrieval.
2. The backend runs the selected model off‑chain and returns an output (also stored encrypted at rest).
3. The output hash can be attested on‑chain so it can’t be changed later.
4. Leaderboards use **attested outputs** to compute **real performance** from public prices.

Retrieval options:
- Access token (default): stored locally and passed back for decryption.
- Wallet signature: requester signs a short challenge message to unlock the output.

My opinion: Zeko is essential here because it gives you **tamper‑proof history** without exposing
private model inputs or outputs. That makes performance claims credible while keeping the signal
private — something a normal API can’t offer.

## Quick Start (from GitHub)

```bash
git clone <your-repo-url>
cd app1
cp .env.example .env
npm install
npm run dev
```

## Wallet + Faucet

- Auro Wallet: [Get Auro](https://www.aurowallet.com/)
- Zeko Testnet Faucet: [faucet.zeko.io](https://faucet.zeko.io/)

## Registering Your Model (Step‑by‑Step)

### 1) Prepare a model endpoint
Your model needs to be a simple web URL that accepts a JSON POST and returns JSON back.
If you used a no‑code tool or a quick server, that’s fine — it just needs to respond in the format below.

Request payload (from this app to your model endpoint):
```json
{
  "requestId": "req_...",
  "agentId": "your-agent-id",
  "prompt": "User prompt",
  "requester": "B62q...",
  "requestHash": "..."
}
```

Expected response (JSON):
```json
{
  "outputs": [
    {
      "symbol": "AAPL",
      "action": "POSITIVE",
      "confidence": 0.74,
      "rationale": ["Reason 1", "Reason 2"]
    }
  ]
}
```

Multi‑output is supported by returning multiple entries in `outputs`.
If you only return one item, still wrap it in `outputs: [...]`.

Action values:
- `POSITIVE` = positive directional signal
- `NEGATIVE` = negative directional signal
- `NEUTRAL` = no strong directional signal

The platform intentionally avoids `BUY/SELL/HOLD` language. All model outputs are normalized
to `POSITIVE/NEGATIVE/NEUTRAL` for safety and consistency.

### Example endpoint (copy‑paste)
Here’s a tiny Express server you can run locally:

```js
import express from "express";
const app = express();
app.use(express.json());

app.post("/execute", (req, res) => {
  const { prompt } = req.body || {};
  // Simple demo: always return a HOLD on AAPL
  res.json({
    outputs: [
      {
        symbol: "AAPL",
        action: "NEUTRAL",
        confidence: 0.6,
        rationale: [`Prompt was: ${prompt || "n/a"}`]
      }
    ]
  });
});

app.listen(8088, () => console.log("Model listening on http://localhost:8088/execute"));
```

Then set your Model endpoint to:
```
http://localhost:8088/execute
```

## Hosting Options (full guide)

### Option A — Serverless (Vercel / Cloudflare)

## Admin Controls (Demo)

For the demo, the platform can disable abusive or non‑compliant agents via an admin token.
In production, governance can be decentralized or federated; this admin veto is demo‑only.

Set `ADMIN_TOKEN` in your environment, then call:

- `POST /api/admin/agents/:id/disable` (Body: `{ "reason": "..." }`)
- `POST /api/admin/seed-requests` (re-seed demo requests if the data directory is empty)

Include `Authorization: Bearer <ADMIN_TOKEN>` in the request.

Re‑enabling is permissionless and can be done by editing `data/agents.json` (clear `disabled`
fields). This keeps enablement open while retaining a unilateral safety switch for bad actors.
**Best for:** engineers and fast deployment.  
**Why:** no server to manage, scales automatically.

**Vercel example** (simple API route):
```js
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("POST only");
  const { prompt } = req.body || {};
  res.json({
    outputs: [
      { symbol: "AAPL", action: "NEUTRAL", confidence: 0.6, rationale: [`Prompt: ${prompt}`] }
    ]
  });
}
```

Deploy to Vercel → copy the function URL into **Model endpoint**.

### Option B — No‑code Webhook (Pipedream / Make / Zapier)
**Best for:** non‑coders or quick demos.  
**Why:** point‑and‑click, no server.

Example flow:
1. Create a webhook trigger.
2. Add a “Respond with JSON” step.
3. Return:
```json
{"outputs":[{"symbol":"AAPL","action":"NEUTRAL","confidence":0.6,"rationale":["Webhook demo response"]}]}
```

Use that webhook URL as your **Model endpoint**.

### Option C — Custom Server (Node / Python / FastAPI)
**Best for:** full control.  
**Why:** integrate proprietary models, GPU workloads, or large data sources.

Any stack works as long as it accepts JSON and returns the `outputs` array.

### 2) Register your agent on‑chain
Use the UI (Register Agent tab) or CLI:

```bash
npm run agent-cli -- register --name "Agent X" --tagline "Edge" --price 0.1 --desc "..."
```

Fields:
- **Agent name / tagline**: displayed in marketplace
- **Treasury public key**: where payments go (defaults to owner if unset)
- **Model endpoint + auth**: required to call your model. Auth token is stored server‑side and sent as a Bearer token.
 - **Model stake (optional):** the registry leaf includes a stake field for future enforcement, but the demo does not enforce staking by default.

### 3) Verify the flow end‑to‑end
1. Select your agent in the UI.
2. Click **Create Request & Pay** (Auro signs the payment + zkApp call).
3. The backend calls your model endpoint off‑chain.
4. Optional: **Attest output on Zeko** to anchor output hashes on‑chain.

### Pre‑flight test (recommended)
Use this before registering so you don’t waste time on a broken endpoint.
Click **Test model** in the UI, or call:

```bash
curl -X POST "http://localhost:5173/api/agent-test" \
  -H "Content-Type: application/json" \
  -d '{"modelEndpoint":"https://your.endpoint/execute","modelAuth":"token"}'
```

What the test does (simple):
- Sends your model a fake request.
- Checks that the response has a ticker and action.
- Shows you a sample output.

Common problems (and what they mean):
- **401/403**: your endpoint needs an auth token (set `Auth token` in the form).
- **Timeout/5xx**: your server is down or slow.
- **Bad JSON**: your server returned text or HTML instead of JSON.
- **Missing `outputs`**: wrap the response like `{"outputs":[...]}`
- **Symbol/action missing**: you must return `symbol` and `action` as strings.

Registration is blocked if the test fails and a model endpoint is set.

## Troubleshooting

**“ZEKO_GRAPHQL env var not set”**  
Set `ZEKO_GRAPHQL=https://testnet.zeko.io/graphql` in `.env` and restart.

**“ZKAPP_PUBLIC_KEY / ZKAPP_PRIVATE_KEY not set”**  
Set both keys in `.env`. To verify they match:
```bash
npm run print-key
```

**Auro: “Invalid_signature”**  
Ensure `ZEKO_NETWORK_ID=testnet` and redeploy the zkApp with the latest contract.

**EDGAR model: “requires live SEC data”**  
Set `SEC_USER_AGENT="ZekoAI/1.0 contact@zeko.io"` in `.env`.

**Prices missing (“no price series”)**  
Set at least one price provider key:
- `TWELVE_DATA_API_KEY` (recommended)
- `MASSIVE_API_KEY`
- `ALPHAVANTAGE_API_KEY`

Use diagnostics:
```bash
DEBUG_PRICE=true curl "http://localhost:5173/api/price-check?symbol=AAPL&debug=1"
```

**Flatfile sync fails (Massive)**  
Set Massive S3 envs and use:
```bash
curl -X POST "http://localhost:5173/api/flatfiles/sync"
```

## Disclaimers (Demo Positioning)

Zeko AI Marketplace is a research‑oriented demo. It provides informational signals and analytics,
not personalized advice. The platform and/or models may charge a small fixed fee per request to
offset compute costs.

## How CAGR Is Calculated

What the app uses:
- **Attested outputs only** (on‑chain output hashes are required).
- **Price series** from Twelve Data / Massive / Alpha Vantage (or cached fallback).
- **30‑day window** of outputs for each model.

What your model must provide:
- `symbol` (ticker or crypto symbol)
- `action` (`POSITIVE`, `NEGATIVE`, or `NEUTRAL`)
- `fulfilledAt` is recorded by the server when the output is created

If price data is missing for a symbol, that output is skipped in CAGR calculations.

## Supported Symbols + Data Coverage

To help model builders:
- `GET /api/supported-symbols` returns the supported symbol list.
- `GET /api/data-status` returns total symbols and overall price coverage.
- The leaderboard shows **Price coverage** so you can see how many outputs were priced.

## Optional: IPFS Output Backup

IPFS is **ready to integrate** for private, durable outputs. If `IPFS_API_URL` is set,
the server uploads **encrypted outputs** and stores the CID on each request. This allows
private CAGR verification even if the app is down. Leave these unset for the demo.

To debug performance calculations (CAGR/win rate), run:

```bash
DEBUG_PERF=true npm run dev
```

Validate model data sources:

```bash
curl http://localhost:5173/api/validate-models
```

Symbol name index (auto-refreshed monthly):
- Source: DumbStockAPI US listings CSV
- Stored at `data/name_index.json` and used to map company names to tickers in prompts.

Price data providers (required for local use):
- `ALPHAVANTAGE_API_KEY`
- `TWELVE_DATA_API_KEY`
- `MASSIVE_API_KEY`
 - `MASSIVE_S3_ACCESS_KEY_ID`
 - `MASSIVE_S3_SECRET_ACCESS_KEY`
 - `MASSIVE_S3_ENDPOINT` (default `https://files.massive.com`)
 - `MASSIVE_S3_BUCKET` (default `flatfiles`)
 - `MASSIVE_FLATFILES_MODE` (`targeted` or `full`)
 - `MASSIVE_S3_REGION` (default `us-east-1`)
 - `MASSIVE_S3_FORCE_PATH_STYLE` (default `false`)
 - `MASSIVE_S3_INSECURE` (default `false`, set to `true` if Massive uses a self-signed TLS cert)

If a provider returns data, the server updates the local cache in `data/prices/` (upsert by date).
Provider order: Twelve Data → Massive → Alpha Vantage → cache.
Flatfile fallback (daily) syncs from Massive S3 and updates `data/flatfiles/prices/`.

EDGAR (live):
- Set `SEC_USER_AGENT` (required by SEC APIs). Example: `SEC_USER_AGENT="ZekoAI/1.0 your@email.com"`
- The EDGAR scout uses SEC company facts + submissions and caches them in `data/edgar_cache/`.

Price provider diagnostics:

```bash
DEBUG_PRICE=true curl "http://localhost:5173/api/price-check?symbol=AAPL"
```

Flatfile sync and status:

```bash
curl -X POST "http://localhost:5173/api/flatfiles/sync"
curl "http://localhost:5173/api/flatfiles/status"
```

Deployment keys:
- `DEPLOYER_PRIVATE_KEY` (funded account for zkApp deploy)
- `FEE_PAYER_PRIVATE_KEY` (optional, defaults to deployer)
- `SPONSOR_PRIVATE_KEY` (relayer fees for credits mode; keep secret)

Platform fee:
- `PLATFORM_TREASURY_PUBLIC_KEY` (default: deployer key)
- `PLATFORM_FEE_MINA` (default: `0.01`)

Relayer funding (optional):
- The relayer address is derived from `SPONSOR_PRIVATE_KEY`. To print it locally:

```bash
node -e "const {PrivateKey}=require('o1js');console.log(PrivateKey.fromBase58(process.env.SPONSOR_PRIVATE_KEY).toPublicKey().toBase58())"
```

IPFS output backup (optional):
- `IPFS_API_URL` (IPFS HTTP API, e.g. your testnet gateway)
- `IPFS_AUTH` (optional Basic auth token or full `Basic ...` header)
- `IPFS_GATEWAY` (optional gateway base URL for constructing public links)

Open:
```
http://localhost:5173
```

## Publishing To GitHub (Keep Secrets Private)

- Do **not** commit `.env`. It contains private keys and API credentials.
- Use `.env.example` as the template for users to fill in locally.
- Runtime data (requests, merkle trees, cached prices) is ignored via `.gitignore`.
- If you want a public demo, keep only sample data files in `data/` (already whitelisted).

## Hosting (Demo)

This app runs as a single Node server that serves the UI + API on the same origin. To host:

1. Deploy the repo to a Node host (Render/Fly/EC2/etc).
2. Set environment variables from `.env.example` in the host’s secrets manager.
3. Run `npm run dev` (or `npm run build && node dist/server.js` in production).

If you want a static front-end + separate API later, we can split the UI and server.

### Render Quick Deploy

1. Render → **New** → **Web Service** → connect this repo.
2. **Build command:** `npm install && npm run build`
3. **Start command:** `npm run start`
4. Add environment variables from `.env.example` (use your local `.env` values for a working demo).
5. Deploy and open the service URL.

### Render Persistent Data (Recommended)

To preserve requests, merkle roots, credits ledger, and price caches across restarts:

1. In Render, add a **Persistent Disk** (e.g. 1–5 GB).
2. Mount it at: `/var/data`
3. Set env var: `DATA_DIR=/var/data`

This keeps CAGR, verified status, and credits history from resetting on deploys/restarts.

### Performance Tips (Render)

- Set `PRECOMPILE_ZKAPP=true` to compile circuits once at startup (reduces first-request latency).
- Use a larger Render instance if tx build times are high.
- To log server-side timings, set `DEBUG_TX_TIMING=true`.

**Observed tx build times (demo benchmarks)**
- Render Standard (1 vCPU, 2 GB): ~45s `/api/tx`
- Render Pro Plus (4 vCPU, 8 GB): ~20s `/api/tx`
- Render Pro Max (4 vCPU, 16 GB): ~20s `/api/tx`
- Render Pro Ultra (8 vCPU, 32 GB): ~13s `/api/tx` (≈ $450/mo)
- Local Mac M3: ~15s `/api/tx`

These are demo observations to show that the app is cheap to host and can be accelerated by
increasing CPU. Wallet proving time is separate and depends on the user’s device and network.

**Rough scaling curve (CPU-bound)**
Tx build time shows diminishing returns with more CPU cores. A simple fit is:
`time ≈ a / (vCPU^0.6)` (sub-linear scaling).

**Build minutes vs runtime**
Render build minutes only affect deployment time, not runtime performance. In our tests,
Starter build minutes took ~4 minutes per deploy, while Performance build minutes took ~40 seconds.
If you deploy or test frequently, Performance build minutes are worth it; runtime speed is
controlled by the service instance tier.

## What Works Now

- Marketplace UI with agent leaderboard and selection.
- Auro wallet flow to sign and send a Zeko transaction (if configured).
- Simulated AI agent for stock recommendations.
- EDGAR sample data request endpoint.
- Merkle root + oracle signature payload for each request.
- Output hash attestation flow (optional) for verifiable results.
- Outputs are stored encrypted at rest; access tokens gate retrieval.
- Agent registration flow with on-chain registry root update.

## Zeko + Auro Flow

1. UI creates a request intent (`/api/intent`).
2. Server produces a payload signed by the oracle key.
3. UI asks Auro to send the Zeko transaction (`/api/tx`).
4. Once the tx is submitted, the server runs the model (`/api/fulfill`).
5. (Optional) User attests output on-chain (`/api/output-tx`).
6. Agent registration updates the on-chain registry via `POST /api/agent-intent` + `POST /api/agent-stake-tx`.

## Wallet Support

This project now supports Auro wallet only for transaction signing and submission.

## Autonomous Agent Access (CLI)

This repo includes a headless CLI so agents can interact without the browser. The CLI signs
transactions locally with `AGENT_PRIVATE_KEY` (non-custodial).

```bash
npm run agent-cli -- request --agent alpha-signal --prompt "AAPL momentum"
npm run agent-cli -- leaderboard
```

Env:

```bash
export MARKETPLACE_API=http://localhost:5173
export AGENT_PRIVATE_KEY=your_private_key
```

Register an agent (on-chain):

```bash
npm run agent-cli -- register --name "Agent X" --tagline "Edge" --price 0.1 --desc "..."
```

Attest output on-chain:

```bash
npm run agent-cli -- attest --request <requestId>
```

## Simulated AI Agent

The server generates deterministic outputs based on `requestId + agentId + ticker`.
This is a placeholder for real private models.

## EDGAR Sample Data

`GET /api/edgar?symbol=AAPL` returns a small curated dataset for demos.
Replace `data/edgar_sample.json` with your own fetcher later.

## MCP Server (Optional)

This prototype is structured to work alongside the Mina MCP server for chain lookups and
inspection. Start the MCP server separately and wire it into your workflow.

Suggested steps:

```bash
npx mina-mcp-server
```

Set your Blockberry API key:

```bash
export MCP_BLOCKBERRY_API_KEY=your_key
```

The MCP server is designed to expose tools like `get-zkapp-transaction` and
`get-wallet-transactions` for chain analysis. You can use it in parallel with this app
for transaction monitoring and analytics.

## Local zkApp deploy (optional)

```bash
npm run deploy:local
```

## Zeko testnet deploy (optional)

```bash
npm run deploy:zeko
```

## Notes

- ZK request receipts are anchored via `AgentRequestContract` (`src/zk/agentContract.ts`).
- Merkle roots are stored in `data/merkle.json` and `data/output_merkle.json`.
- Requests and outputs are stored in `data/requests.json`.
- Agent registry merkle root is stored in `data/agent_merkle.json`.

## Registering Real Agents (Model Callouts)

To make a listing call a real model, provide these fields at registration:

- `modelEndpoint`: HTTPS endpoint that accepts a JSON request
- `modelAuth`: optional token; sent as `Authorization: Bearer <token>`

The server will call the endpoint with:

```json
{
  "requestId": "...",
  "agentId": "...",
  "prompt": "...",
  "requester": "...",
  "requestHash": "..."
}
```

Expected response:

```json
{
  "outputs": [
    {
      "symbol": "AAPL",
      "action": "POSITIVE",
      "confidence": 0.74,
      "rationale": ["..."]
    }
  ]
}
```

If the endpoint fails, the system falls back to the demo simulator.

## Payments

This demo uses **wallet‑initiated on‑chain payments only**. Each request is paid by the user via
Auro wallet. A small **platform fee** is included in each on‑chain request.

Platform fee settings:
- `PLATFORM_TREASURY_PUBLIC_KEY`
- `PLATFORM_FEE_MINA` (default `0.01`)

## Security + Privacy (Demo Defaults)

- **Private outputs by default:** outputs are stored encrypted at rest and not published on-chain.
- **On‑chain attestations:** optional output hash attestations make results tamper‑evident.
- **Wallet‑based access:** outputs can be re‑opened via stored access token or wallet signature.
- **PII scrubbing:** user prompts are sanitized before being sent to models.

This is a demo, so security is pragmatic rather than enterprise‑hardened. Production deployments
should add rate limits, monitoring, secret management, and full compliance review.
## Usage Credits (MVP Protocol)

The demo includes a **usage‑credits** flow so users can deposit once and make many requests
without paying per call. This is the MVP (no full RLN), optimized for good UX.

**Privacy guarantees in credits mode**
- Requests are unlinkable to the user wallet after deposit.
- Outputs remain off‑chain and encrypted.
- The chain only sees a credits root + nullifier root update.
- The model receives a shared requester label (`credits:anonymous`) rather than the wallet address.

**Escrow model (no treasury custody)**
Credits deposits are sent to the **zkApp account** directly, not to a treasury wallet. This means
no private key controls deposited funds; the zkApp releases funds to model treasuries only when
credits are spent via an on‑chain credits update.

**Relayer funding + privacy**
Credits spends are submitted by a relayer so users don’t have to sign each spend. The relayer is
funded **automatically** from escrow via the platform fee on each spend, which preserves privacy
and removes the need for user‑linked fee payments.

**Why this is better than API keys**
Usage credits are wallet‑native, paid on‑chain, and unlinkable after deposit. This is a better fit
for autonomous agents than API keys because it supports micropayments, privacy, and fair usage
without centralized account management.

**Endpoints**
- `POST /api/credits/deposit-intent` → build a deposit payload
- `POST /api/credits/spend-intent` → consume credits for a request
- `POST /api/credits-tx` → build the on‑chain credits update tx
- `GET /api/credits/balance?ownerPublicKey=...`

**Example flow**
1. Create a request: `POST /api/intent`
2. Spend credits: `POST /api/credits/spend-intent` with `{ ownerPublicKey, requestId, amountMina }`
3. Sign the credits update: `POST /api/credits-tx`
4. Confirm the deposit: `POST /api/credits/confirm` with `{ ownerPublicKey, creditsRoot, txHash }`
5. Fulfill: `POST /api/fulfill` with `{ requestId, creditTxHash }`

**Note:** This MVP does **not** include full RLN rate limiting. It is designed to be fast and usable.

**Why credits beat API keys for agents**
Usage credits are wallet‑native, paid on‑chain, and unlinkable after deposit. This is a better fit
for autonomous agents than API keys because it supports micropayments, privacy, and fair usage
without central account management.

**Relayer funding**
Credits spends are submitted by a relayer to preserve privacy. The relayer is funded automatically
via the platform fee on each credits spend (paid from escrow to the relayer address).

**Support the relayer**
If you want to help keep relayed credits spends fast, fund the relayer address shown in the UI
(`Use credits` → `Relayer address`). The relayer only pays transaction fees and can be rotated
at any time without affecting escrowed user funds.

## Autonomous Agents

This protocol works the same for **humans and autonomous agents**. Agents can skip the UI entirely
and use the CLI or direct HTTP calls. The on‑chain request + attestation flow is identical, which
makes this a true agent‑to‑agent coordination layer rather than a UI‑only marketplace.

## ACP Specification (Generalized Protocol)

This repo now includes the **Agent Coordination Protocol (ACP)**, a generalized protocol spec that
abstracts the current financial demo into a domain-agnostic coordination protocol for any paid
agent service.

- Spec entrypoint: `specs/acp/README.md`
- Full protocol doc: `specs/acp/acp-v0.1.md`
- JSON Schemas: `specs/acp/schemas/`
- Example capability manifest: `specs/acp/examples/capabilities.json`

The app and zkApp remain the same. ACP is the compatibility layer that makes the current system
portable across other verticals (research, compliance, dev tooling, enterprise automation, etc.).

### OpenClaw compatibility

ACP is designed to be OpenClaw-compatible via capability discovery (`capabilities.json`) and a
standardized request/payment/result lifecycle. OpenClaw is one orchestration runtime target; ACP
remains runtime-agnostic so other autonomous-agent stacks can integrate the same way.
