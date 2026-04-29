---
name: historical-proof-verifier
description: Verify Merkle proof validity independently from latest on-chain root and report verified versus anchored states clearly.
---

# Historical Proof Verifier

Use this skill when valid past proofs appear as "not verified" after tree growth.

## Trigger signals

- `matches=false` while proof data looks correct.
- User confusion between historical validity and latest-root alignment.

## Procedure

1. Compute proof validity from image hash, verdict, and witness path.
2. Compare reconstructed root with proof root.
3. Compare proof root with current on-chain root.
4. Return separate flags:
   - `verified`: proof is cryptographically valid
   - `anchored`: proof root equals current chain root
5. Render UX statuses distinctly:
   - `Verified` (anchored)
   - `Verified (historical)` (verified but not anchored to latest root)

## Validation

- Older valid proofs are not mislabeled as invalid.
- API and UI semantics stay consistent (`verified` controls verdict display).

## Notes

- "Current root mismatch" is expected in append-only systems; it is not proof corruption.
