# Self-Hosting Guide

## Deployment Model

TAP is designed to be deployed by each institution in their own environment.

Recommended baseline:
- API Gateway + supporting services in private network
- managed database for persistence
- external secret manager for credential env materialization
- CI pipeline for schema/tests/transcript validation

## Minimum Setup

1. Clone repo and copy `.env.example` to `.env`.
2. Configure role keys (`TAP_API_KEYS_JSON`).
3. Configure partner provider credentials and lifecycle metadata.
4. Seed tenant provider config + policy versions.
5. Run transcript pack and verify outputs.

## Hardening Defaults

- enable outbound allowlist per provider
- use OAuth2 and mTLS where supported
- require maker-checker for issuance
- enable credential diagnostics checks in pre-deploy gates

## Rollup Integration

Integrate TAP with your private/permissioned rollup control plane by wiring:
- settlement submission hooks,
- finality sync hooks,
- event reconciliation APIs.
