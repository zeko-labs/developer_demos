# Zeko AI Runtime

A standalone Zeko-native runtime for verifiable AI execution, receipts, privacy, credits, and operator routing.

The core idea was inspired by public AI protocol work like OpenGradient, but we fundamentally rearchitected the protocol to run natively on Zeko so builders get:

1. Sealed private inputs and client-encrypted outputs instead of plaintext-by-default coordinator state.
2. Membership-first lane routing with off-box failover instead of a monolithic coordinator trust boundary.
3. Faster credits and receipt settlement UX by pushing heavier proof work into checkpoint and background paths.

We reverse-engineered leading AI protocol primitives, then rebuilt the useful parts as original Zeko-native infrastructure with faster credits UX, stronger operator isolation, sealed private inputs, and a cleaner trust boundary. This project is not affiliated with OpenGradient.

What it includes:

- fast off-chain inference with configurable receipt settlement modes
- Zeko-shaped request and output settlement payloads
- real Zeko testnet request/output transaction builders and optional sponsor submission
- Zeko-native agent registry and usage-credits primitives for builders
- sealed private-input lane with redacted prompt persistence
- threshold attestations instead of a single settlement signer
- client-encrypted outputs with X25519 + AES-GCM
- membership-first operator routing and isolation auditing
- fast credits checkpoint path for lean builder UX
- packaged compatibility client plus builder/operator starter folders
- commitment-first DA relay payload generation
- attached future Ethereum settlement envelope for later EIP-4844 export
- a source-based critique of where current AI protocol designs break and which assumptions look fragile

## Builder Package

The repo now doubles as a releaseable builder package surface:

```bash
npm install zeko-ai-builder-kit
```

Stable entrypoints:

- `zeko-ai-builder-kit` or `zeko-ai-builder-kit/sdk` for the native builder SDK
- `zeko-ai-builder-kit/compat` for the legacy-shaped adapter
- `zeko-ai-builder-kit/crypto` for local X25519 envelope helpers

Packaging and migration references:

- [docs/migration-guide.md](docs/migration-guide.md)
- [docs/builder-api.openapi.json](docs/builder-api.openapi.json)
- [docs/blog-zeko-native-ai-stack.md](docs/blog-zeko-native-ai-stack.md)
- [docs/blog-introducing-zeko-ai-runtime.md](docs/blog-introducing-zeko-ai-runtime.md)

## Agent Skills

This repo now documents the runtime-specific agent skills it actually supports:

- [skills/README.md](skills/README.md)
- [skills/native-inference-builder.md](skills/native-inference-builder.md)
- [skills/private-inference-builder.md](skills/private-inference-builder.md)
- [skills/credits-balance-operator.md](skills/credits-balance-operator.md)
- [skills/lane-operator-failover.md](skills/lane-operator-failover.md)
- [skills/compatibility-adapter.md](skills/compatibility-adapter.md)

These are intentionally runtime-scoped. Higher-level coordination belongs in ACP, approval and escrow belong in Nava, and broader trust or identity layers belong in SantaClawz.

## Why This Is Distinct

- private inputs are sealed locally and outputs can be encrypted to the client before storage
- operator routing is membership-first, lane-aware, and already hardened for off-box failover
- credits have a fast path that preserves builder UX while batching heavier settlement work in the background
- builders keep one coordinator URL even when settlement lanes are split across operators
- compatibility is kept at the edge instead of making an SDK, MCP server, or foreign backend the trust boundary

## Project Layout

- [src/server.ts](src/server.ts)
- [src/compat/client.ts](src/compat/client.ts)
- [src/zk/agentContractV2.ts](src/zk/agentContractV2.ts)
- [skills/README.md](skills/README.md)
- [docs/zeko-ai-runtime.md](docs/zeko-ai-runtime.md)
- [docs/opengradient-breakpoints.md](docs/opengradient-breakpoints.md)
- [docs/ai-protocol-breakpoints.md](docs/ai-protocol-breakpoints.md)
- [docs/migration-guide.md](docs/migration-guide.md)
- [docs/blog-zeko-native-ai-stack.md](docs/blog-zeko-native-ai-stack.md)
- [docs/blog-introducing-zeko-ai-runtime.md](docs/blog-introducing-zeko-ai-runtime.md)
- [scripts/smoke-encrypted.mjs](scripts/smoke-encrypted.mjs)

## Commands

```bash
npm run build
npm run dev
npm run start
npm run release:check
npm run release:pack
npm run smoke:sdk
npm run smoke:builder:conformance
npm run smoke:compat
npm run smoke:private
npm run smoke:credits:fast
npm run contract:builder
npm run operators:audit
npm test
npm run smoke:encrypted
npm run zkapp:deploy
npm run zkapp:deploy:v1
npm run zkapp:deploy:v2
npm run auth:enable
npm run sponsor:enable
npm run operators:bootstrap
npm run operators:activate:remote
npm run operators:issue:local-isolation
npm run operators:package:remote
npm run smoke:live
npm run smoke:live:v1
npm run smoke:live:v2
npm run smoke:agent-live
npm run smoke:credits
npm run smoke:credits:spend
npm run smoke:credits:operator
npm run smoke:credits:deposit-monitor
npm run bench:v2
npm run bench:v2:request
npm run bench:v2:registry
npm run bench:v2:credits-update
npm run bench:v2:credits-spend
```

## Environment

Copy `.env.example` to `.env` if you want to override defaults.

Important defaults:

- Zeko testnet GraphQL: `https://testnet.zeko.io/graphql`
- Zeko archive: `https://archive.testnet.zeko.io/graphql`
- local port: `5180`
- tx fee: `100000000`

For the default `v2` threshold lane, set:

- `ZKAPP_V2_PUBLIC_KEY` and `ZKAPP_V2_PRIVATE_KEY`
- optionally `SPONSOR_PRIVATE_KEY` for shared server-side submission
- optionally split fee payers by lane with `ZEKO_AI_REQUEST_SPONSOR_PRIVATE_KEY`, `ZEKO_AI_OUTPUT_SPONSOR_PRIVATE_KEY`, `ZEKO_AI_REGISTRY_SPONSOR_PRIVATE_KEY`, and `ZEKO_AI_CREDITS_SPONSOR_PRIVATE_KEY`
- legacy `OPENGRADIENT_*` sponsor aliases still work if you are migrating an older local setup

For the legacy `v1` compatibility lane, set:

- `ZKAPP_PUBLIC_KEY` and `ZKAPP_PRIVATE_KEY`

Optional coordinator HTTP auth:

- low-level operator auth env names still live in `.env.example` as legacy aliases while the public package and SDK surface move to neutral naming
- keep `/health` open if you want unauthenticated liveness checks; auth applies to `/api/*` only when one of the inbound env vars is configured
- `npm run auth:enable` generates local and remote env snippets under `data/opengradient/http-auth/` so you can turn on shared API-key or bearer-token auth without hand-assembling the values
- `npm run auth:issue:builder` issues a hashed builder credential into `data/opengradient/http-auth/builders.json` plus a per-builder client env snippet under `data/opengradient/http-auth/builders/`
- builder credentials are scoped and quota-aware, so the same coordinator can expose read/write surfaces to outside builders without giving them operator control-plane mutation rights
- SDK clients, SDK smokes, and `examples/node-builder/` call `loadCoordinatorEnv()` so generated auth snippets are discovered automatically from `ZEKO_AI_COORDINATOR_ENV_FILE`, a single builder env file, or the generated local SDK env snippet
- `GET /api/auth/me` shows the authenticated principal plus current builder usage, remaining rate-limit budget, and remaining daily quota budget when builder auth is active
- `npm run smoke:builder:conformance` verifies the public builder contract with a constrained builder key; set `ZEKO_AI_BUILDER_CONFORMANCE_LIVE_SETTLEMENT=true` when you want the conformance run to submit a live default `v2` inference receipt to Zeko
- `GET /api/request-status/:token` gives builders a polling-token view of inference progress so they do not need to inspect raw inference records directly
- `GET /api/private-lane/config` publishes the current sealed-input public key so builders can encrypt prompts locally before submission
- `POST /api/infer/private` and `POST /api/infer/private/live` keep plaintext prompts out of the normal stored inference record while preserving the same receipt and settlement flow
- `/api/compat/reference/*` exposes the legacy protocol-shaped model, inference, receipt, and chat-completion routes while still settling through the native Zeko `v2` path
- `POST /api/mcp` exposes a thin MCP wrapper for route discovery, inference creation, and status reads without moving the trust boundary away from the coordinator
- the package now exposes `zeko-ai-builder-kit/compat` for the compatibility adapter client and `zeko-ai-builder-kit/crypto` for local X25519 envelope helpers
- `npm run release:check` validates the semver/package metadata, typed subpath exports, and `npm pack --dry-run` contents so the builder-facing install surface stays publishable
- `npm run release:pack` runs the same release validation and then produces a local tarball
- [docs/builder-api.openapi.json](docs/builder-api.openapi.json) captures the current builder-facing coordinator surface for SDKs, adapters, and external integrations
- [docs/migration-guide.md](docs/migration-guide.md) shows the intended install/import path for native builders, compatibility clients, and local sealing helpers

Useful transaction endpoints:

- `GET /api/zeko/v1/config`
- `GET /api/zeko/config`
- `GET /api/zeko/v2/config`
- `GET /api/zeko/v1/preflight`
- `GET /api/zeko/preflight`
- `GET /api/zeko/v2/preflight`
- `POST /api/zeko/status`
- `GET /api/coordination/state`
- `GET /api/operators`
- `GET /api/operators/membership`
- `GET /api/operators/policy`
- `GET /api/operators/health`
- `GET /api/operators/isolation/audit`
- `GET /api/operators/routing`
- `GET /api/operators/routing/:lane`
- `GET /api/operators/:id`
- `POST /api/operators/register`
- `POST /api/operators/:id/heartbeat`
- `POST /api/operators/:id/status`
- `GET /api/agents`
- `POST /api/agents`
- `POST /api/agents/:id/zeko/register-tx`
- `POST /api/agents/:id/zeko/register-submit`
- `POST /api/agents/:id/zeko/live-submit`
- `POST /api/agents/:id/zeko/v1/register-tx`
- `POST /api/agents/:id/zeko/v1/register-submit`
- `POST /api/agents/:id/zeko/v1/live-submit`
- `POST /api/agents/:id/zeko/v2/register-tx`
- `POST /api/agents/:id/zeko/v2/register-submit`
- `POST /api/agents/:id/zeko/v2/live-submit`
- `POST /api/credits/deposit-intent`
- `GET /api/credits/deposit-monitors`
- `GET /api/credits/deposit-monitors/:id`
- `POST /api/credits/deposit-monitor`
- `POST /api/credits/deposit-monitor/process`
- `POST /api/credits/spend-intent`
- `GET /api/credits/balance`
- `POST /api/credits/confirm`
- `GET /api/credits/operator/queue`
- `GET /api/credits/operator/queue/:id`
- `POST /api/credits/operator/enqueue`
- `POST /api/credits/operator/process`
- `POST /api/credits-tx`
- `POST /api/credits-submit`
- `POST /api/credits/v1/tx`
- `POST /api/credits/v1/submit`
- `POST /api/credits/v2/tx`
- `POST /api/credits/v2/submit`
- `GET /api/inferences/:id/zeko-v1-payloads`
- `GET /api/inferences/:id/zeko/live-settlement`
- `GET /api/inferences/:id/zeko/v1/live-settlement`
- `GET /api/inferences/:id/zeko/v2/live-settlement`
- `POST /api/inferences/:id/zeko/v1/request-tx`
- `POST /api/inferences/:id/zeko/v1/output-tx`
- `POST /api/inferences/:id/zeko/v1/request-submit`
- `POST /api/inferences/:id/zeko/v1/output-submit`
- `POST /api/inferences/:id/zeko/v1/live-submit`
- `POST /api/inferences/:id/zeko/request-tx`
- `POST /api/inferences/:id/zeko/output-tx`
- `POST /api/inferences/:id/zeko/request-submit`
- `POST /api/inferences/:id/zeko/output-submit`
- `POST /api/inferences/:id/zeko/live-submit`
- `GET /api/inferences/:id/zeko-v2-payloads`
- `POST /api/inferences/:id/zeko/v2/request-tx`
- `POST /api/inferences/:id/zeko/v2/output-tx`
- `POST /api/inferences/:id/zeko/v2/request-submit`
- `POST /api/inferences/:id/zeko/v2/output-submit`
- `POST /api/inferences/:id/zeko/v2/live-submit`
- `POST /api/infer/live`
- `POST /api/infer/private`
- `POST /api/infer/private/live`
- `POST /api/infer/v1/live`
- `POST /api/infer/v2/live`

Deployment:

- `npm run zkapp:deploy` deploys the default threshold-verifying `AgentRequestContractV2` to Zeko testnet
- `npm run zkapp:deploy:v1` deploys the legacy `AgentRequestContract` compatibility lane
- `npm run zkapp:deploy:v2` deploys the threshold-verifying `AgentRequestContractV2` explicitly
- if `ZKAPP_PRIVATE_KEY` is omitted, the script generates or reuses a local key at `data/deployments/agent-request.zkapp-private-key.txt`
- if `ZKAPP_V2_PRIVATE_KEY` is omitted, the v2 deploy script generates or reuses a local key at `data/deployments/agent-request-v2.zkapp-private-key.txt`
- the latest deploy metadata is written to `data/deployments/agent-request.latest.json`
- the latest v2 deploy metadata is written to `data/deployments/agent-request-v2.latest.json`
- the runtime will reuse that stored deployment automatically if env vars are not set

Sponsor mode:

- `npm run sponsor:enable` securely stores a sponsor key at `data/deployments/sponsor-private-key.txt`
- `npm run operators:bootstrap` provisions separate local lane fee payers, funds them from the shared sponsor treasury, writes a second operator bootstrap bundle under `data/opengradient/operators/`, and updates `data/opengradient/operator-registry.json`
- `npm run operators:activate:remote` turns the paused remote bundle into an active runtime split by generating a launch script and env file, marking the remote operator active, and releasing the selected local lanes into `data/deployments/archive/`
- `npm run operators:issue:local-isolation` generates a hardened local coordinator env snippet plus launch script so the primary can explicitly disable remotely owned lanes under `membership-first` routing instead of relying on shared sponsor fallback
- the remote activation and packaging flags are documented in `.env.example`; the public story is lane isolation and policy-driven routing, not an inherited external env surface
- `npm run operators:package:remote` exports a portable off-box bundle with `dist/`, seeded lane-owned state, vendored runtime dependencies, layered env files, launch and verification scripts, a Dockerfile, a systemd unit, and a `.tgz` archive plus SHA256 checksum under the runtime data dir
- `npm run operators:promote:orb` pushes that archive into an OrbStack VM, creates the target machine automatically when needed, installs Node if needed, writes the remote `runtime.local.env`, installs the systemd unit, starts the remote operator as a real second host, and updates the local activation/registry/membership files to the promoted endpoint
- `npm run operators:lockdown:remote` verifies the off-box remote is healthy, then quarantines the local bootstrap/export artifacts that still contain the remote lane secrets and records that custody handoff in the operator registry
- `npm run operators:policy:issue` issues a signed operator membership policy so admission and failover are driven by policy instead of self-advertised operator claims
- `ZEKO_AI_ROUTE_STRATEGY=membership-first` makes the signed membership policy, not local hot-key presence, the actual lane-routing authority
- lane-specific stored keys can also live at `data/deployments/{request,output,registry,credits}-sponsor-private-key.txt`
- lane-specific keys now take precedence over the shared `SPONSOR_PRIVATE_KEY` fallback so explicit lane separation is sticky once provisioned
- runtime settlement only needs the zkApp public key; deploy/rekey flows are the only places that still need the zkApp private key
- `POST /api/agents/:id/zeko/live-submit` sponsor-submits an agent registration and waits for the agent root to appear on-chain
- default agent registry routes now point at the threshold-verifying `v2` zkApp
- `POST /api/inferences/:id/zeko/request-submit` and `POST /api/inferences/:id/zeko/output-submit` will use that stored sponsor key automatically on the default `v2` lane
- `POST /api/inferences/:id/zeko/live-submit` sponsor-submits both default `v2` receipts for an existing inference and can wait for the roots to appear on-chain
- `POST /api/infer/live` creates an inference, sponsor-submits both default `v2` receipts, and persists the live settlement record in `data/opengradient/inferences.json`
- `npm run smoke:live` runs the same default `v2` threshold flow against the deployed zkApp
- `npm run smoke:agent-live` runs the same default `v2` threshold flow for the agent registry
- `POST /api/credits-tx` and `POST /api/credits-submit` now point at the default `v2` threshold credits lane
- `npm run smoke:credits` verifies the live `v2` credits-update path by settling credits and nullifier roots on-chain
- `npm run smoke:credits:spend` verifies the live `v2` credits-spend path, including the payout branch
- `npm run smoke:credits:operator` verifies the async `v2` operator lane by enqueueing a spend intent, sponsor-submitting it server-side, and waiting for settlement
- `npm run smoke:credits:deposit-monitor` verifies the wallet-funded deposit flow by broadcasting a real `depositMina > 0` tx, monitoring the new credits root, and auto-confirming the ledger
- the local node now self-registers in `data/opengradient/operator-registry.json` with lane capability metadata so builders can discover which fee payer is active for each settlement lane
- the primary coordinator now exposes `/api/operators/routing` and keeps the canonical app state locally while delegating only the actual registry or credits sponsor submission to the active lane owner
- `data/opengradient/operator-membership.json` now acts as the signed admission and failover policy when present, so operators cannot self-register new lanes outside the approved membership set
- `/api/operators/membership` exposes the verified membership records and admitted lane owners so builders can distinguish governance policy from runtime health
- `/api/operators/policy` and `/api/operators/health` now make that routing decision auditable by exposing the freshness threshold, lane-selection rules, operator heartbeats, and route availability state
- `npm run smoke:operator:failover` temporarily pauses the current remote lane owner, verifies the coordinator reroutes to the admitted backup, then restores the original owner so operator failover can be rehearsed without changing settlement code
- `npm run smoke:credits:failover-live` goes one step further by pausing the primary credits owner, routing a small live spend through the backup operator, verifying the backup actually settled it on-chain, and then restoring the primary owner
- the failover smokes now load `data/opengradient/http-auth/sdk.local.env` with builder fallback disabled by default, so operator-control tests do not accidentally inherit a builder-scoped credential when a single builder env file exists locally
- the local operator ID is stable across restarts via the runtime data dir unless you explicitly override it
- the bootstrap flow also prepares a paused non-local operator bundle with its own per-lane funded public keys so another operator can be brought online without reusing the local treasury
- the default activation split moves `registry` and `credits` to the remote operator while the local node keeps `request` and `output`; the activation env file lets you override that cut when you need a different lane plan
- the exported remote bundle now supports a clean override layer via `runtime.local.env`, so the handoff host can set its public endpoint and coordinator URL without editing the generated base env in place
- the exported bundle also includes `healthcheck.sh`, `verify-coordinator-sync.sh`, `docker-run.sh`, and `remote-operator.service` so the same runtime can be brought up bare-metal or in a container without a new code path
- `operators:promote:orb` uses a preconfigured OrbStack VM target, `host.docker.internal` as the coordinator endpoint inside the VM, and converts the exported bundle into a systemd-managed remote runtime
- because the exported bundle already vendors app dependencies, the Orb promotion path only needs a minimal Node runtime on the VM; it does not need a full `npm install`
- when the local primary still has a shared sponsor fallback configured, restart it with `ZEKO_AI_DISABLED_SPONSOR_LANES=registry,credits` after off-box promotion so the remote VM remains the sole active owner of those lanes
- the activation flow now materializes that restart overlay for you at `data/opengradient/operators/<local-operator-id>.local-isolation.env` plus a matching `*.local-isolation.launch.sh` helper
- `operators:lockdown:remote` is intentionally a separate step so it does not change the happy-path demo flow; after you run it, the live demo still works, but the local machine no longer retains the packaged remote secrets in their normal locations
- after lockdown, local re-promotion convenience is intentionally reduced: the remote host keeps serving, but rebuilding or re-exporting the same remote bundle from macOS now requires restoring secrets from quarantine or reissuing them
- once the remote host is confirmed healthy, hard custody isolation becomes an operational choice: remove or lock down the original machine's copies of the remote bootstrap and exported secrets if you want true single-host control of those lanes
- routed live submission now works through the primary endpoint even when the primary intentionally does not own `registry` or `credits`, so builders can keep one coordinator URL while still getting real fee-payer isolation underneath
- `POST /api/inferences/:id/zeko/v1/live-submit` and `POST /api/infer/v1/live` retain the legacy single-signer-compatible lane
- `npm run smoke:live:v1` exercises the legacy `v1` path
- `POST /api/inferences/:id/zeko/v2/live-submit` and `POST /api/infer/v2/live` are the explicit versioned aliases for the default threshold lane
- `npm run smoke:live:v2` exercises that same threshold flow explicitly

Credits mode:

- `POST /api/credits/deposit-intent` prepares default `v2` threshold payloads and updated credits roots for a wallet-funded deposit tx
- `POST /api/credits/deposit-intent` now also returns `pendingDepositKey` and a `monitorHint` so clients can hand the broadcast tx hash back for async confirmation
- `POST /api/credits/deposit-monitor` registers a wallet-funded deposit tx for background confirmation once the target root appears on Zeko
- `GET /api/credits/deposit-monitors` and `POST /api/credits/deposit-monitor/process` expose the deposit watcher lane directly
- `POST /api/credits/spend-intent` consumes an internal credits balance for a request and prepares default `v2` threshold credits/nullifier root updates
- `POST /api/credits/spend-intent` also accepts `enqueue`, `processNow`, `waitForSettlement`, and `idempotencyKey` so builders can hand the spend to the server-side operator lane instead of synchronously managing settlement themselves
- `POST /api/credits/spend-intent/fast` is the lean builder path: debit the ledger immediately, queue a checkpoint batch, and let the operator settle the root update in the background
- `POST /api/credits-tx` builds the unsigned Zeko tx for the default `v2` credits lane
- `POST /api/credits-submit` sponsor-submits default `v2` credits updates or spends when `depositMina` is `0`
- `GET /api/credits/operator/queue` and `POST /api/credits/operator/process` expose the async server-side settlement lane for `v2` zero-deposit credits updates and spends
- `POST /api/credits/operator/enqueue` is the generic queue entrypoint for builder-managed `v2` credits payloads
- deposit intents are intentionally not sponsor-queued because `depositMina > 0` must still be funded by the wallet owner
- `payloadV1` and explicit `/api/credits/v1/*` routes preserve the legacy single-signer credits lane
- the operator lane now defaults to background processing every few seconds when sponsor capability is present, and the deposit monitor defaults to background polling for root confirmation

V2 threshold contract:

- [src/zk/agentContractV2.ts](src/zk/agentContractV2.ts) upgrades the single-oracle settlement path to a fixed 2-of-3 on-chain attester model
- `npm run bench:v2` benchmarks the local proving/compile cost of `v1` versus `v2`
- the split bench commands focus the measurement on one path at a time:
  - `npm run bench:v2:request`
  - `npm run bench:v2:registry`
  - `npm run bench:v2:credits-update`
  - `npm run bench:v2:credits-spend`
- default builder UX now points at `v2` for inference, agent registry, and credits; `v1` is preserved as a versioned compatibility lane

Example live receipt request:

```bash
curl -sS -X POST http://127.0.0.1:5180/api/infer/live \
  -H 'content-type: application/json' \
  -d '{
    "modelId": "verifiable-echo",
    "prompt": "settle this inference live on zeko",
    "inputs": { "source": "builder-api" },
    "waitForSettlement": true
  }'
```

That endpoint creates the inference, sponsor-submits both default `v2` Zeko receipt transactions, waits for the request/output roots to appear in zkApp state, and returns the persisted `liveSettlement` record with the transaction hashes.

Example live agent registration:

```bash
curl -sS -X POST http://127.0.0.1:5180/api/agents \
  -H 'content-type: application/json' \
  -d '{
    "name": "Research Router",
    "ownerPublicKey": "B62...",
    "treasuryPublicKey": "B62...",
    "capabilities": ["routing", "research"]
  }'
```

Then sponsor-settle it:

```bash
curl -sS -X POST http://127.0.0.1:5180/api/agents/research-router/zeko/live-submit \
  -H 'content-type: application/json' \
  -d '{ "waitForSettlement": true }'
```

Example builder SDK usage:

```ts
import {
  CoordinatorClient,
  loadCoordinatorEnv,
  resolveCoordinatorAuth,
  resolveCoordinatorBaseUrl
} from 'zeko-ai-builder-kit';

loadCoordinatorEnv();

const client = new CoordinatorClient({
  baseUrl: resolveCoordinatorBaseUrl(),
  auth: resolveCoordinatorAuth(),
  timeoutMs: 15_000,
  retry: { maxAttempts: 4 }
});

const auth = await client.getAuthMe();
const routing = await client.getRouting();
const registryRoute = await client.getLaneRoute('registry');
const creditsQueue = await client.getCreditsOperatorQueue();

const live = await client.submitAgentLive('research-router', {
  version: 'v2',
  body: { waitForSettlement: true },
  idempotencyKey: 'builder-live-agent-1'
});

const creditsSpend = await client.enqueueCreditsSpendAndWait(
  {
    ownerPublicKey: process.env.ZEKO_AI_OWNER_PUBLIC_KEY!,
    requestId: `builder-credits-${Date.now()}`,
    amountMina: 0.01,
    enqueue: true,
    processNow: true,
    waitForSettlement: false,
    idempotencyKey: `builder-credits-${Date.now()}`
  },
  {
    timeoutMs: 120_000,
    pollIntervalMs: 3_000
  }
);
```

SDK notes:

- the package root now exports a tiny `CoordinatorClient` from `src/sdk/`
- `zeko-ai-builder-kit/compat` exports `CompatClient` so the compatibility edge can live in its own import path
- `zeko-ai-builder-kit/crypto` exports the same X25519 envelope helpers used by the private lane
- the client supports either `x-api-key` or bearer-token auth
- `loadCoordinatorEnv()` auto-loads generated coordinator credentials without overriding explicitly set environment variables
- `getAuthMe()` lets a builder inspect the authenticated principal plus current quota/rate-limit state from the coordinator itself
- `getPrivateLaneConfig()`, `sealPrivateInferenceRequest()`, `createPrivateInference()`, and `createPrivateLiveInference()` let builders use the sealed-input lane without hand-rolling local crypto
- `getInferenceStatus()` and `waitForInferenceStatus()` let builders poll opaque request-status tokens instead of walking raw inference records
- compatibility helpers now cover `getCompatModels()`, `createCompatInference()`, `getCompatInference()`, `getCompatInferenceStatus()`, `getCompatInferenceReceipt()`, `createCompatChatCompletion()`, and MCP tool calls through `mcpInitialize()`, `mcpListTools()`, and `mcpCallTool()`
- GETs retry automatically on transient failures; POSTs retry when you provide an `idempotencyKey` or opt into `retryUnsafe`
- async credits helpers now cover queue snapshots, queue-item polling, deposit monitor polling, checkpoint-batch snapshots, lane-route waiting, and the new `enqueueCreditsSpendFast()` path so builders do not have to hand-roll coordinator watch loops
- `npm run smoke:sdk` verifies health, signed membership, routing policy, operator health, and lane routing against a coordinator URL
- `npm run smoke:sdk:async` verifies the SDK async control-plane helpers against the live credits lane
- `npm run smoke:private` verifies sealed private inputs, redacted persistence, and encrypted output recovery against a running coordinator
- `npm run smoke:builder-auth` verifies scoped builder auth, scope denials, and coordinator-side rate limiting in an isolated local smoke environment
- `npm run smoke:builder:conformance` verifies a real constrained builder key against the live coordinator, including auth introspection, route discovery, model access, inference creation, attribution-filtered reads, credits queue visibility, and expected permission denials
- `npm run contract:builder` validates live request and response payloads against the checked-in OpenAPI builder contract
- `npm run smoke:compat` verifies the legacy protocol compatibility shim, callback delivery, status-token polling, and the thin MCP wrapper against a running coordinator
- `npm run operators:audit` checks shared fallback usage, duplicate lane keys, route-policy mismatches, and unavailable admitted lanes against a running coordinator
- `npm test` is the default repeatable non-live builder suite; it resets the local builder-usage counters, validates the contract, runs builder conformance, runs the compatibility smoke, and verifies the sealed private lane in one pass
- `examples/node-builder/` is the minimal starter for outside builders using the package export directly
- `starters/native-builder/`, `starters/compat-builder/`, and `starters/operator-runtime/` are the copyable infra starters for builders and operators

## Notes

- MCP and SDK are treated as optional client layers, not the trust boundary.
- The strongest current path here is decentralized settlement plus encrypted storage, not fully trustless large-model execution.
- For true end-to-end trustless execution, the next real upgrades are zkML for small deterministic models or verified TEE/MPC/FHE execution for larger ones.
- In this local workspace, `node_modules` is symlinked to the already-installed dependency tree from the original demo so the standalone project can build immediately without a fresh download.
- In this sandbox, binding a local port is blocked, so import-mode and build/preflight verification are more reliable than `app.listen()` tests.
