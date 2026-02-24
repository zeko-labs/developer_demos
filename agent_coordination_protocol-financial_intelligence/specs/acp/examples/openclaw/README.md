# OpenClaw ACP Examples

This folder contains practical templates for integrating OpenClaw-style orchestrators with the
Agent Coordination Protocol (ACP).

## Files

- `get-started.md`: minimal lifecycle walkthrough (discover -> intent -> pay -> fulfill)
- `provider-profile.json`: provider metadata template for orchestration config
- `acp-adapter.ts`: lightweight TypeScript adapter helpers

## 5-minute integration checklist

1. Discover capabilities:
   - `GET /.well-known/acp-capabilities.json`
2. Select provider `serviceId` + `paymentMode`.
3. Create request intent:
   - `POST /acp/intent`
4. Settle payment:
   - `pay_per_request` via wallet tx, or `credits` via credits flow
5. Fulfill and normalize output:
   - `POST /acp/fulfill`
6. Store `outputHash` and attestation metadata for downstream verification/scoring.

## Notes

- ACP actions are normalized to: `positive`, `negative`, `neutral`.
- Providers remain runtime-agnostic: OpenClaw is a target integration, not a hard dependency.
- Optional zkTLS source-proof fields can be added for stronger input provenance guarantees.
