# Zeko AI Runtime

This runtime reverse-engineers the useful parts of current AI protocol design and maps them onto a Zeko testnet stack that already exists locally in Codex.

The public starting point was inspiration from OpenGradient-style protocol ideas, but the resulting system is fundamentally rearchitected for Zeko-native execution, routing, privacy, and settlement.

It is an independent runtime and architecture study, not an affiliated release from any external protocol team.

The three design reasons are straightforward:

1. Privacy: sealed inputs and client-encrypted outputs are first-class instead of plaintext coordinator state.
2. Coordination: lane-aware operator routing and failover are part of the core runtime instead of hidden backend policy.
3. UX and capital efficiency: fast credits and delayed heavy settlement keep the builder path lean.

It now also includes a stronger trust-minimization path:

- threshold attestations instead of a single settlement signer
- client-encrypted outputs using X25519 plus AES-GCM
- commitment-first DA relay payloads compatible with the local Zeko DA privacy pattern
- an explicit position that MCP and SDK are optional client layers, not the trust boundary
- agent registry and usage-credits primitives exposed directly as builder infrastructure
- a default `v2` zkApp path that verifies a fixed 2-of-3 attester set on-chain instead of relying on a single oracle signature
- a retained `v1` compatibility lane for builders who still want the older single-signer receipt shape
- a tiny coordinator SDK with lane discovery, optional API-key or bearer auth, and retry-aware coordinator calls for builders

## Runtime Skill Layer

This repo should document runtime-facing agent skills, not every higher-level product behavior.

That means the skills here focus on:

- native inference submission and receipt handling
- private inference with sealed inputs
- credits metering and fast-path spending
- lane routing, isolation, and failover operations
- compatibility adapters that preserve legacy client shapes

The documented skill set lives under [../skills/README.md](../skills/README.md). It is intentionally distinct from the coordination, escrow, and broader trust layers that belong in ACP, Nava, and SantaClawz.

## What Was Preserved

- Fast-path AI execution stays off-chain.
- Settlement happens after execution, not inline with every request.
- Each inference carries a verifiable receipt.
- Settlement mode controls how much data is exposed.
- A future Ethereum settlement envelope stays attached to every receipt, even though the live ledger is Zeko testnet today.

## What Was Reverse-Engineered From Existing AI Protocols

Official sources reviewed:

- <https://www.opengradient.ai/>
- <https://docs.opengradient.ai/about/>
- <https://docs.opengradient.ai/learn/architecture/>
- <https://docs.opengradient.ai/learn/onchain_inference/llm_execution.html>
- <https://docs.opengradient.ai/learn/onchain_inference/da.html>
- [opengradient-breakpoints.md](opengradient-breakpoints.md)
- [ai-protocol-breakpoints.md](ai-protocol-breakpoints.md)

The main product ideas inferred from those materials are:

1. AI requests should execute quickly on specialized nodes, not inside the consensus path.
2. The verification layer should record proofs or attestations after execution completes.
3. Settlement visibility should be configurable:
   - `SETTLE_INDIVIDUAL`
   - `SETTLE_BATCH`
   - `SETTLE_INDIVIDUAL_WITH_METADATA`
4. The chain is a verification and settlement layer, not the execution substrate for the model itself.
5. The long-term destination is Ethereum-style verifiable settlement, even when other infrastructure components are separate.

## Better Than MCP/SDK Alone

OpenGradient is one clear public reference for SDK and x402-style access. That is useful, but an SDK or MCP server should not be the thing we trust.

The more permissionless shape is:

1. Standard transport:
- plain HTTP or x402-style payment-gated HTTP
- wallet-verifiable signatures
- transport-agnostic receipts

2. Decentralized settlement:
- multiple attesters or validators sign a receipt digest
- Zeko stores only the commitment roots and batch links
- Ethereum export stays possible later

3. Private data handling:
- output is encrypted to the client before storage or DA publication
- only ciphertext and commitments are published off-chain
- on-chain surfaces carry hashes, roots, and attestation digests

MCP still has a role, but mostly for:

- analytics
- indexing
- agent tooling
- retrieval and monitoring

That means MCP becomes a convenience layer, not a control point.

## Zeko Mapping

### Reference protocol inference nodes

Mapped to model endpoints or deterministic local mock models.

### Reference protocol settlement ledger

Mapped to Zeko testnet receipt roots. The prototype stores:

- request Merkle root
- output Merkle root
- oracle-signed request payload
- oracle-signed output payload
- threshold attestation bundle over the final receipt digest

Those payloads are intentionally shaped to match the existing local `AgentRequestContract` request/output submission methods.

### Reference protocol settlement modes

Mapped directly to receipt metadata:

- `SETTLE_INDIVIDUAL`: individual request/output receipt
- `SETTLE_BATCH`: eligible for batch export and later Ethereum DA packaging
- `SETTLE_INDIVIDUAL_WITH_METADATA`: same receipt path, but explicitly designed for public metadata visibility

### Reference protocol TEE attestation

For now there are two layers:

- existing single-signer payloads for compatibility with the local zkApp methods
- a new threshold attestation bundle for the more decentralized path

This is still not the same as true TEE verification. It is a settlement decentralization upgrade, not a cryptographic proof that the large model executed honestly.

The architecture is intentionally compatible with replacing the placeholder later with:

- a real TEE quote verifier
- a zk proof
- or a hybrid TEE-plus-proof receipt

## Privacy Upgrade

The prototype can now encrypt outputs to a client-controlled X25519 public key.

That gives us:

- encrypted storage
- encrypted DA publication
- hash-only on-chain settlement

What it does **not** give us is fully private inference execution. The model runner still sees the plaintext prompt unless execution moves to:

- zkML for small deterministic models
- TEEs with quote verification
- MPC
- FHE

## Ethereum Later, Zeko Now

Every inference receipt includes a `futureEthereum` envelope with:

- target chain
- intended settlement mode
- EIP-4844 DA intent
- optional settlement contract slot
- batch placeholders

That keeps the data model aligned with the existing Zeko-to-Ethereum thinking already present locally in the litepaper and DA notes:

- Zeko commits receipts today.
- Later, settled receipts or batches can be exported into an Ethereum blob-equivalence flow instead of redesigning the application model.

## Local Components Reused

This prototype intentionally reuses existing Codex work:

- Zeko skill defaults and testnet endpoints
- `AgentRequestContract` semantics from the existing agent marketplace demo
- local Zeko troubleshooting conventions in `ZEKO_KNOWLEDGE_BASE.md`
- future Ethereum settlement concepts from the local Zeko litepaper work

## Prototype Surface

The new server lives at:

- `src/server.ts`

Main endpoints:

- `GET /health`
- `GET /api/architecture`
- `GET /api/trustless-design`
- `GET /api/ai-protocol-critique`
- `GET /api/crypto/generate-client-keypair`
- `GET /api/zeko/v1/config`
- `GET /api/zeko/config`
- `GET /api/zeko/v2/config`
- `GET /api/zeko/v1/preflight`
- `GET /api/zeko/preflight`
- `GET /api/zeko/v2/preflight`
- `POST /api/zeko/status`
- `GET /api/coordination/state`
- `GET /api/operators/membership`
- `GET /api/operators/policy`
- `GET /api/operators/health`
- `GET /api/operators/routing`
- `GET /api/operators/routing/:lane`
- `GET /api/agents`
- `POST /api/agents`
- `GET /api/agents/:id`
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
- `GET /api/models`
- `POST /api/models`
- `POST /api/infer`
- `POST /api/infer/v1/live`
- `POST /api/infer/live`
- `POST /api/infer/v2/live`
- `POST /api/crypto/decrypt`
- `GET /api/inferences`
- `GET /api/inferences/:id`
- `GET /api/inferences/:id/zeko-v1-payloads`
- `GET /api/inferences/:id/zeko-payloads`
- `GET /api/inferences/:id/zeko-v2-payloads`
- `GET /api/inferences/:id/zeko/v1/live-settlement`
- `GET /api/inferences/:id/zeko/live-settlement`
- `GET /api/inferences/:id/zeko/v2/live-settlement`
- `GET /api/inferences/:id/relay-payload`
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
- `POST /api/inferences/:id/zeko/v2/request-tx`
- `POST /api/inferences/:id/zeko/v2/output-tx`
- `POST /api/inferences/:id/zeko/v2/request-submit`
- `POST /api/inferences/:id/zeko/v2/output-submit`
- `POST /api/inferences/:id/zeko/v2/live-submit`
- `GET /api/batches`
- `POST /api/batches`

Default routing now points at `v2` for the leanest builder UX:

- `/api/zeko/*` means the threshold-verifying `v2` zkApp unless the path explicitly says `/v1/`
- `/api/infer/live` is the default `v2` live flow
- `/api/inferences/:id/zeko/*` is the default `v2` settlement surface
- `/api/agents/:id/zeko/*` is the default `v2` registry surface
- `/api/credits-tx` and `/api/credits-submit` are the default `v2` credits surface
- `/api/credits/operator/*` is the async `v2` credits operator lane for zero-deposit updates and spends
- `/api/credits/deposit-monitor*` is the async `v2` wallet-funded deposit confirmation lane
- explicit `/v1/` routes remain available for compatibility and comparison
- `/api/operators/routing` is the coordinator-facing discovery surface that tells builders which operator currently owns each sponsor lane
- `/api/operators/membership` exposes the signed operator admission and failover policy when one is present
- `/api/operators/policy` publishes the coordinator's routing rules, including the stale-heartbeat threshold for remote operators
- `/api/operators/health` exposes per-operator freshness plus route availability so builders can gate on healthy lanes instead of trusting implicit coordinator state
- when `registry` or `credits` live on a remote operator, the coordinator now keeps the canonical local state and forwards only the raw sponsor submission step to the active lane owner instead of forcing builders to switch hosts

## Builder Package

The repo root now exports a small `CoordinatorClient` package from `src/sdk/`.

What it gives builders:

- one coordinator URL even when registry and credits are remote-owned
- lane discovery through `/api/operators/routing`
- signed operator membership visibility through `/api/operators/membership`
- explicit routing policy and operator freshness visibility through `/api/operators/policy` and `/api/operators/health`
- optional `x-api-key` or bearer-token auth headers
- generated auth env discovery through `loadCoordinatorEnv()`
- retry semantics with timeout control
- safe POST retries when an `idempotencyKey` is supplied
- async queue and deposit-monitor polling helpers so builders can watch credits workflows without reimplementing coordinator state machines

Legacy low-level operator auth env aliases:

- `OPENGRADIENT_HTTP_API_KEYS`
- `OPENGRADIENT_HTTP_BEARER_TOKENS`
- `OPENGRADIENT_OUTBOUND_API_KEY`
- `OPENGRADIENT_OUTBOUND_BEARER_TOKEN`
- `OPENGRADIENT_BUILDER_AUTH_PATH`
- `OPENGRADIENT_BUILDER_USAGE_PATH`
- `ZEKO_AI_COORDINATOR_ENV_FILE` for the builder-facing SDK, with `OPENGRADIENT_COORDINATOR_ENV_FILE` still accepted as a legacy alias

Operational helpers:

- `npm run auth:enable` generates reusable env snippets for coordinator, remote operator, and SDK clients
- `npm run auth:issue:builder` issues a hashed builder credential plus a builder-local SDK env snippet and attaches scopes, request limits, and optional daily quota budgets to that credential
- SDK clients and smokes load generated credentials from `ZEKO_AI_COORDINATOR_ENV_FILE`, from the only builder env file when exactly one exists, or from the generated local SDK env snippet
- `npm run operators:policy:issue` issues a signed operator membership file from the current operator registry snapshot while preserving existing lane ordering by default
- `OPENGRADIENT_OPERATOR_POLICY_{REQUEST,OUTPUT,REGISTRY,CREDITS}_ORDER` can pin explicit per-lane primary, backup, and standby ordering as comma-separated operator IDs
- `npm run operators:issue:local-isolation` derives the local coordinator's retained lanes from activation or membership state and emits a restart overlay that disables remotely owned lanes under `membership-first` routing
- `OPENGRADIENT_REMOTE_DATA_DIR` lets a same-machine loopback standby run against an isolated runtime state directory instead of sharing the coordinator-local `data/opengradient/`
- `OPENGRADIENT_REMOTE_COORDINATOR_ENDPOINT` and `OPENGRADIENT_REMOTE_STANDBY_MODE=true` make activated hot-standby runtimes self-sync back to the primary coordinator without competing for credits background processing
- `npm run operators:package:remote` exports the freshest remote activation by default, or a specific operator when `OPENGRADIENT_REMOTE_OPERATOR_ID` or `OPENGRADIENT_REMOTE_ACTIVATION_PATH` is set
- `npm run operators:promote:orb` promotes the freshest packaged bundle by default, auto-creates the target Orb machine when needed, updates the local activation/registry/membership state to the promoted endpoint, or targets a specific operator when `OPENGRADIENT_ORB_REMOTE_OPERATOR_ID` or `OPENGRADIENT_ORB_BUNDLE_MANIFEST_PATH` is set
- `npm run operators:lockdown:remote` locks down the freshest remote activation by default, or a specific operator when `OPENGRADIENT_REMOTE_OPERATOR_ID` or `OPENGRADIENT_REMOTE_ACTIVATION_PATH` is set; pass `OPENGRADIENT_REMOTE_LOCKDOWN_COORDINATOR_ENDPOINT` plus an API key or bearer token when the coordinator requires auth
- `npm run smoke:operator:failover` pauses the currently selected remote lane owner, verifies routing moves to the admitted backup, and restores the original owner
- `npm run smoke:credits:failover-live` verifies the backup operator can actually settle a live credits spend on-chain before restoring the primary owner
- both failover smokes now force operator-style SDK env loading with builder fallback disabled so they keep using the coordinator control-plane credential even when builder env snippets exist locally
- `npm run smoke:sdk:async` exercises the builder package against the live credits control plane, including route wait helpers and queue-item polling
- `npm run smoke:builder-auth` verifies scoped builder auth, denied control-plane writes, and coordinator-side rate limiting in isolation
- `npm run smoke:builder:conformance` verifies the public builder contract with a constrained live builder credential and can optionally submit a live default `v2` inference receipt when `ZEKO_AI_BUILDER_CONFORMANCE_LIVE_SETTLEMENT=true`
- `GET /api/request-status/:token` exposes builder-visible polling tokens, and `callbackUrl` plus `callbackMode` on inference creation let builders receive signed status callbacks without reading raw inference JSON directly
- `GET /api/private-lane/config` publishes the current X25519 sealed-input key for builders, and `/api/infer/private*` keeps plaintext prompts out of the normal coordinator record
- `/api/compat/reference/*` now exposes the legacy protocol-shaped model, inference, receipt, status, and chat-completion routes backed by the same native Zeko `v2` settlement path
- `POST /api/mcp` is a thin JSON-RPC/MCP wrapper over auth introspection, model listing, route discovery, inference creation, and request-status reads; it is a compatibility layer, not the trust boundary
- `ZEKO_AI_ROUTE_STRATEGY=membership-first` makes the signed operator membership file the routing authority instead of defaulting to any local hot key
- `GET /api/operators/isolation/audit` exposes shared-fallback usage, duplicate lane-key ownership, and route-policy mismatches so operators can harden real isolation without changing the code path again
- `POST /api/credits/spend-intent/fast` is the lean credits UX path and queues checkpoint settlement instead of forcing builders into synchronous spends
- `npm run contract:builder` validates live request and response payloads against `docs/builder-api.openapi.json`
- `npm run smoke:compat` verifies the compatibility shim, callback delivery, token polling, and MCP wrapper against a live coordinator
- `npm run smoke:private` verifies sealed private prompts and encrypted output recovery against a live coordinator
- `npm run operators:audit` fails only on error-level isolation findings so it can be used as an operator preflight
- `npm test` is the repeatable non-live suite and resets the fixture builder-usage counters before running contract validation plus builder, compatibility, and private-lane smokes
- `docs/builder-api.openapi.json` is the machine-readable builder API contract for SDKs, adapters, and legacy compatibility layers
- `examples/node-builder/` is the minimal external-builder starter for route discovery and live coordinator calls
- `starters/native-builder/`, `starters/compat-builder/`, and `starters/operator-runtime/` package the native, compatibility, and operator entry points as small reusable folders

## Honest Limitations

- It does not claim genuine TEE verification yet.
- It can now build real unsigned receipt transactions and optionally sponsor-submit them to Zeko testnet, but only if the zkApp and sponsor keys are configured.
- It now also supports live agent registry settlement and threshold-verified credits flows on `v2`, but the credits path still relies on off-chain ledger bookkeeping plus signed root updates rather than a fully private proof system.
- The spend branch is heavier than the plain credits-update branch because it also executes payout sends, so high-frequency micro-spends should still be batched or server-proved instead of treated like synchronous client-local work.
- Deposit intents still need a wallet-funded tx because `depositMina > 0` cannot be sponsor-submitted safely; the operator lane is intentionally focused on the fast zero-deposit update/spend path, while the deposit monitor handles asynchronous confirmation after broadcast.
- The new `v2` contract is deployed alongside `v1` and is now the default live zkApp across inference, registry, and credits.
- It does not publish EIP-4844 blobs yet.
- Threshold attestations improve settlement decentralization, but not execution integrity by themselves.
- It is a faithful architecture adaptation, not a full clone of OpenGradient’s chain or protocol.
