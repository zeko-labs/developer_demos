---
name: agent-intent-api
description: Use when implementing or modifying the API-compatible control plane for agent execution escrow on Zeko, especially intent ingestion, transaction status projection, and execute or settle routes.
---

# Agent Intent API

Use this skill when working on the app-facing intent API for agent execution escrow.

## Focus

- Create and normalize transaction intents.
- Keep verification and approval status readable through stable routes.
- Preserve compatibility with Nava-style transaction and verification flows.
- Make execution and settlement transitions easy to consume without exposing Zeko internals.

## Workflow

1. Normalize request input and verification policy in `src/navaCompatibility.js`.
2. Persist transaction state and local artifacts in `src/store.js`.
3. Expose or update routes in `src/server.js`.
4. Keep `GET /verification-services` and transaction read APIs aligned with the current approval model.
5. If lifecycle semantics change, verify the projected state still syncs correctly into the zkApp path.

## Repo Touchpoints

- `src/server.js`
- `src/navaCompatibility.js`
- `src/store.js`

## Guardrails

- Keep the API surface additive and predictable.
- Do not make clients trust the server for approval quorum when `approvalAuthority=zeko_native_verifiers`.
- Preserve Ethereum-oriented settlement metadata even while Zeko is the active trust layer.
- Keep public response objects deterministic and easy for other agents to consume.

## Output

Return a stable agent-intent API that lets builders use familiar request and approval flows while the trust layer runs on Zeko.
