# Agent Execution Escrow

`agent_execution_escrow` is a standalone prototype for Zeko-native agent transaction control.

## Network Profile

Testnet and record-only mode remain the compatibility defaults. For mainnet, use a separate environment profile with `ZEKO_NETWORK_ID=mainnet`, official mainnet endpoints, fresh verifier/deployer/sponsor keys, and a fresh intent zkApp deployment. Do not reuse testnet sync artifacts. See [Zeko Mainnet Readiness](../docs/zeko-mainnet-readiness.md).

The core thesis is simple: most AI agent protocols are control-plane native. They expose SDKs, MCP servers, and hosted verification, but durable trust still lives in one backend. This project keeps compatibility with Nava-style agent transaction flows while moving the state and lifecycle authority into a Zeko-native environment.

## What This Unlocks

- Private agent transaction flows with proof artifacts instead of backend-only state
- Zeko-native verifier quorum for approval, using Mina signatures checked by the zkApp
- Proof-checked lifecycle transitions for `PENDING -> APPROVED -> EXECUTED -> SETTLED`
- Compatibility with existing app, agent, API, and MCP-style integration patterns
- A clean path to eventual Ethereum settlement without making Ethereum the real-time trust surface

## Why Zeko Helps

Zeko is the special sauce because it can hold the trust and state layer, not just the UX layer.

- Nava-style systems are strong control planes, but the operator still owns final verification state
- Zeko lets lifecycle state live in a zkApp instead of only in backend storage
- Native Mina signatures are cheap enough to verify in-circuit for small verifier quorums
- That gives us a more decentralized and trust-minimized approval path without paying the cost of proving EVM signatures inside the circuit

## What Works Today

The current build supports:

- agent transaction creation and status APIs
- Platform arbiter evaluation and proof artifact generation
- Optional external wallet verifier challenges
- Zeko-native verifier registry and native signing payloads
- Quorum approval relayed into a live Zeko zkApp
- Proof-checked lifecycle authority inside the zkApp
- Ethereum as the intended final settlement rail

The standalone zkApp project lives in [zkapp-test](./zkapp-test).

## Agent Skills

This demo includes local skill docs for agents or contributors working on the main subsystems:

- `agent-intent-api`: API-compatible intent ingestion, status, and execution flow
- `zeko-native-verifier-quorum`: registered verifier keys, signing payloads, and threshold approval
- `intent-zkapp-lifecycle`: per-intent zkApp sync and proof-checked lifecycle transitions
- `private-intent-artifacts`: prompt hashing, payload sealing, and compact proof artifacts

Start with [skills/README.md](./skills/README.md).

## Quickstart

```bash
cd developer_demos/agent_execution_escrow
npm install
cp .env.example .env
npm start
```

Default server:

- `http://127.0.0.1:4520`

The server now loads `.env` when present, but it no longer hard-fails if the file is missing.

## Main API

Core transaction routes:

- `GET /`
- `GET /verification-services`
- `POST /transactions`
- `GET /transactions/:requestHash`
- `GET /transactions/:requestHash/approval-status`
- `GET /transactions/:requestHash/verification-status`
- `POST /transactions/:requestHash/execute`
- `POST /transactions/:requestHash/settle`

External wallet verifier routes:

- `POST /transactions/:requestHash/verifier-challenge`
- `POST /transactions/:requestHash/verifier-attestations`
- `GET /transactions/:requestHash/verifier-attestations`

Zeko-native verifier routes:

- `GET /zeko/verifier-registry`
- `GET /transactions/:requestHash/zeko-verifier-payload`
- `POST /transactions/:requestHash/zeko-verifier-attestations`

## Native Verifier Flow

1. Create a transaction with `approvalAuthority` set to `zeko_native_verifiers`
2. Read the verifier payload from `GET /transactions/:requestHash/zeko-verifier-payload`
3. Have registered Zeko verifiers sign the returned fields
4. Submit those signatures to `POST /transactions/:requestHash/zeko-verifier-attestations`
5. Relay the quorum into the zkApp, which verifies signatures and threshold before setting `APPROVED`

Example verifier policy:

```json
{
  "verificationPolicy": {
    "requiredExternalApprovals": 2,
    "approvalAuthority": "zeko_native_verifiers"
  }
}
```

Example registry config:

```bash
ZEKO_NATIVE_VERIFIERS='[
  {"verifierId":"zeko-risk-node-1","zekoPublicKey":"B62q...","role":"independent_verifier"},
  {"verifierId":"zeko-risk-node-2","zekoPublicKey":"B62q...","role":"independent_verifier"},
  {"verifierId":"zeko-risk-node-3","zekoPublicKey":"B62q...","role":"independent_verifier"}
]'
```

## ZKApp State

In `ZEKO_SUBMIT_MODE=zkapp`, each intent is mirrored into a Zeko zkApp with this state:

1. `intentHash`
2. `statementHash`
3. `approvalCommitment`
4. `status`
5. `requiredVerifierApprovals`
6. `observedVerifierApprovals`
7. `approvalDomainCommitment`
8. `lastUpdatedAt`

The zkApp enforces:

- monotonic timestamps
- monotonic verifier approval counts
- valid lifecycle progression
- quorum before `APPROVED`, `EXECUTED`, or `SETTLED`
- native Mina-signature quorum checks when `approvalAuthority=zeko_native_verifiers`

## Current Limits

- Each zkApp lifecycle change requires proving and a Zeko transaction, so it is heavier than a backend write
- The current design is optimized for high-value checkpoints such as approval, execution, and settlement
- Ethereum settlement is still modeled as the final rail, not yet fully bridged end to end
- We intentionally avoid in-circuit EVM `secp256k1` verification for now because that is the real overhead cliff

## Project Notes

- Runtime state is local-only and ignored for git by default
- Repo-local agent skill docs live in [skills/README.md](./skills/README.md)
- The Nava critique and breakpoint analysis is in [NAVA_BREAKPOINTS.md](./NAVA_BREAKPOINTS.md)
- The Zeko zkApp workspace is documented in [zkapp-test/README.md](./zkapp-test/README.md)
- The project is licensed under Apache-2.0 in [LICENSE](./LICENSE)
