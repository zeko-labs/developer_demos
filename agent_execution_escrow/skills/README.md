# Agent Skills

This demo includes repo-local skills for AI agents or contributors working on agent execution escrow on Zeko.

## Included Skills

- `agent-intent-api`
  Builds or modifies the API-compatible control plane for agent intent creation, status reads, and execution flow.
- `zeko-native-verifier-quorum`
  Handles registered verifier keys, Mina signing payloads, attestation intake, and quorum enforcement.
- `intent-zkapp-lifecycle`
  Owns the per-intent zkApp state model, lifecycle proving path, and sync scripts.
- `private-intent-artifacts`
  Covers prompt hashing, payload sealing, proof artifact construction, and public/private data boundaries.

## Which Skill To Use

- Use `agent-intent-api` when changing HTTP routes, response envelopes, or compatibility behavior.
- Use `zeko-native-verifier-quorum` when changing who can approve an intent and how quorum is proven.
- Use `intent-zkapp-lifecycle` when changing on-chain state, proving, or lifecycle transitions.
- Use `private-intent-artifacts` when changing what stays private, what is hashed, and what is published.

## Why These Skills

These four skills match the real separation of concerns in this demo:

- app-facing transaction UX
- decentralized verifier approval
- Zeko-native lifecycle authority
- privacy-preserving artifacts

Together they explain what this product actually does: it turns agent execution into a verifier-gated, proof-checked escrow flow instead of a backend-only workflow.
