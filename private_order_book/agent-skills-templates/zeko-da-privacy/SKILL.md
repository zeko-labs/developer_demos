---
name: zeko-da-privacy
description: Integrate application data publishing with Zeko-oriented DA relay patterns while preserving privacy through encrypted payloads and commitment-first anchoring. Use for DA adapter work, privacy reviews, and docs updates.
---

# Zeko DA Privacy

Use this skill when the user asks to publish protocol data to DA and keep private orderflow confidential.

## Default Policy
- Publish commitments on-chain.
- Publish encrypted payloads to DA.
- Keep raw order details out of plaintext DA payloads unless explicitly required.

## Integration Pattern
1. App computes canonical commitment hash for state/event batch.
2. App encrypts DA payload (AES-GCM recommended).
3. App sends payload + metadata to relay endpoint.
4. Relay stores receipt + forwards to chain DA interface.
5. App stores returned DA reference in batch metadata.

## Privacy Requirements
- `DA_REQUIRE_ENCRYPTION=true` in production paths.
- `DA_INCLUDE_ORDER_SNAPSHOT=false` by default.
- Explicitly document metadata leakage (timing, traffic shape, batch cadence).

## API Expectations
- `POST /publish` accepts encrypted envelope + commitment.
- `GET /health` reports relay mode and forwarding status.
- `GET /records` provides recent publication receipts.

## Documentation Requirements
Always include two sections:
1. "What is private"
- payload contents, trader identities (if blinded), internal notes.
2. "What is still public"
- commitments, timestamps, settlement metadata, potential traffic analysis.

## Encrypted Rollup Note
If user asks for private balances:
- State that app-layer encryption is not enough for full balance privacy.
- Recommend encrypted rollup/state transition model where balances and transfers remain hidden in-circuit.
