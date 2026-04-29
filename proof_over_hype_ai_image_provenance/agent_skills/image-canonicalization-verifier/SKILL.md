---
name: image-canonicalization-verifier
description: Deterministic website-image extraction and deduplication for stable hashing and verification, including srcset and resize variant normalization.
---

# Image Canonicalization Verifier

Use this skill when URL-based image verification produces duplicates or inconsistent hashes.

## Trigger signals

- Multiple apparent copies of same image (different width/resize params).
- Verification fails even when user selected "same image".
- Page URL fetch returns HTML instead of direct image bytes.

## Procedure

1. Extract image candidates from:
   - `img src`
   - lazy attributes (`data-src`, `data-original`, etc.)
   - `srcset` and `source` tags
   - embedded JSON payloads when present
2. Normalize candidate URLs:
   - strip known resize/quality params
   - collapse common resize path variants
3. Deduplicate by normalized key.
4. Prefer highest-resolution candidate from `srcset` where available.
5. Require explicit image selection in UI before analyze/verify.

## Validation

- Image list shows unique candidates, not resize duplicates.
- Selected image hash is stable across retries.
- Verify flow uses chosen image URL exactly.

## Notes

- For web images, byte-level equality can still differ by CDN transformations over time.
