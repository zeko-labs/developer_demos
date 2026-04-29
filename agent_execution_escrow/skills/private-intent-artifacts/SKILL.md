---
name: private-intent-artifacts
description: Use when modifying privacy behavior for agent transaction inputs, proof artifacts, encrypted payloads, or public transaction projections.
---

# Private Intent Artifacts

Use this skill for the privacy layer of agent execution escrow.

## Focus

- Hash prompts and sensitive metadata.
- Seal encrypted payloads for private or confidential modes.
- Build compact proof artifacts and public statements.
- Keep public transaction views useful without leaking private inputs.

## Workflow

1. Determine the requested privacy mode in `src/server.js`.
2. Hash or seal sensitive content with `src/privacy.js`.
3. Build proof artifacts and statement commitments in `src/zekoProof.js`.
4. Project the public transaction shape in `src/navaCompatibility.js`.
5. Persist only the local material needed for replay, sync, or debugging in `src/store.js`.

## Repo Touchpoints

- `src/server.js`
- `src/privacy.js`
- `src/zekoProof.js`
- `src/navaCompatibility.js`
- `src/store.js`

## Guardrails

- Default to hashes or encrypted payloads for private flows.
- Do not leak raw verifier signatures in public transaction projections.
- Keep public artifacts compact, deterministic, and replayable.
- Do not overclaim privacy when funding or settlement legs still remain public.

## Output

Produce privacy-preserving intent artifacts that support verifier review and settlement workflows without turning the backend into the sole privacy boundary.
