---
name: zeko-native-verifier-quorum
description: Use when implementing or modifying Zeko-native verifier approval, including registry parsing, signing payloads, Mina signature checks, and threshold quorum relay into the zkApp.
---

# Zeko Native Verifier Quorum

Use this skill for the decentralized approval lane of the demo.

## Focus

- Register and normalize verifier keys.
- Build the signing payload for Zeko-native approvals.
- Accept and verify Mina signatures from registered verifiers.
- Relay quorum-approved state into the intent zkApp.

## Workflow

1. Load and normalize the verifier registry in `src/zekoNativeVerifier.js`.
2. Build the verifier payload in `src/server.js`.
3. Accept attestations at `POST /transactions/:requestHash/zeko-verifier-attestations`.
4. Verify signatures before increasing observed approvals.
5. Pass the verified quorum into `src/zekoIntentSync.js` and the zkApp lifecycle path.

## Repo Touchpoints

- `src/zekoNativeVerifier.js`
- `src/server.js`
- `src/zekoIntentSync.js`
- `zkapp-test/src/zekoVerifierAttestation.ts`
- `zkapp-test/src/NavaIntentZkApp.ts`

## Guardrails

- Deduplicate verifiers by public key.
- Never accept approval counts from the caller without checking signatures.
- Keep the verifier set root consistent between the API layer and the zkApp.
- Avoid in-circuit EVM `secp256k1` verification unless the architecture is intentionally changing.

## Output

Produce a native verifier approval lane that is more permissionless and trust-minimized than a server-owned approval counter.
