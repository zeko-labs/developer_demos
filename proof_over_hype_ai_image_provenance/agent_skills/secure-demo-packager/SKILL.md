---
name: secure-demo-packager
description: Package a public zk demo safely with BYOK, per-IP limits, optional captcha, and secret-safe repository hygiene.
---

# Secure Demo Packager

Use this skill when preparing public demos that call paid detector APIs.

## Trigger signals

- Need public link without exposing private API keys.
- Concern about quota abuse or bot traffic.

## Procedure

1. Keep secrets out of git (`.env`, key files, local state artifacts).
2. Provide `.env.example` placeholders only.
3. Implement per-IP daily limits for shared demo keys.
4. Add BYOK path in UI (user-supplied detector credentials).
5. Keep captcha support optional behind env flags.
6. Display transparent UX messaging:
   - remaining demo quota
   - reset interval
   - BYOK bypass behavior
7. Validate hosted env variables in deployment platform.

## Validation

- Fresh clone runs without embedded secrets.
- Public demo degrades gracefully under limits.
- Users can continue with BYOK without admin intervention.

## Notes

- Hosted free tiers may block dynamic requests; verify platform limits before launch.
