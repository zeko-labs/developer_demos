---
name: protocol-dapp-starter
description: Build a production-lean protocol app scaffold with clear API boundaries, environment-driven runtime config, and reproducible local runbooks. Use when starting a new protocol repo or refactoring an existing app for shipping readiness.
---

# Protocol Dapp Starter

Use this skill when the user asks to spin up or restructure a protocol application quickly.

## Outcomes
- One server entrypoint, one client entrypoint, one worker entrypoint.
- `package.json` scripts for each process.
- `.env.example` with only required knobs and safe defaults.
- Copy/paste runbook in README.

## Workflow
1. Map runtime components:
- API service
- UI service
- background worker(s)
- optional adapter/relay services

2. Standardize scripts:
- `app:serve`
- `worker:*`
- `adapter:*` (if applicable)
- `build:*` for type-safe modules

3. Define config contracts:
- Add env vars to `.env.example`.
- Ensure each env var is actually consumed in code.
- Expose effective runtime config in `/status`.

4. Wire operational endpoints:
- `/health` minimal process liveness
- `/status` rich operational snapshot

5. Add a short runbook:
- startup order
- health checks
- restart commands
- common failure fixes

## Constraints
- Prefer simple HTTP/JSON boundaries between components.
- Keep secrets in env only.
- Persist critical state to `data/` with deterministic file names.

## Done Checklist
- Can bootstrap in a clean terminal with documented commands.
- Process status is inspectable without reading logs.
- Restarting services does not silently drop critical state.
