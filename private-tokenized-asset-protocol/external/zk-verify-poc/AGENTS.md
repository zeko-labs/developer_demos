# AGENTS.md

## Mission
Implement the zkVerify PoC as a CLI-first cryptographic validation pipeline with strict in-circuit ECDSA verification.

## Cold Start Order
When picking up this repo without prior context, read in this order:
1. `AGENTS.md`
2. `TASKLIST.md`
3. `PRD.md`
4. `README.md`

## Project Exploration Map
Use this map before editing so the right files are touched first:
1. Moon project and task graph:
`/.moon/workspace.yml`, `/moon.yml`, `/poc/moon.yml`, `/mock-server/moon.yml`, `/tlsnotary/moon.yml`
2. Mock server slice:
`/mock-server/server.ts`, `/mock-server/tests/server.spec.ts`
3. TLSNotary slice:
`/tlsnotary/src/bin/notary.rs`, `/tlsnotary/src/bin/prover.rs`, `/tlsnotary/src/lib.rs`
4. TS extraction/proving/deploy slice:
`/poc/*.ts`, `/poc/lib/*.ts`, `/poc/circuits/eligibility.ts`, `/poc/contracts/VerificationRegistry.ts`, `/poc/tests/*.spec.ts`
5. Pipeline orchestration:
`/run-poc.sh`, `/README.md`, `/TASKLIST.md`

## Non-Negotiable Workflow
Scope: this workflow is mandatory for source code changes (runtime, business logic, and tests).  
For chore/tooling/config/docs-only changes (for example Moon/proto config, hooks, workspace metadata, docs), this workflow is optional unless explicitly requested.

1. For source code changes, update `TASKLIST.md` to `IN_PROGRESS` before touching implementation files for that step.
2. RED first: add/adjust tests that fail for the intended behavior.
3. Record RED evidence in `TASKLIST.md` (command + failure summary).
4. GREEN second: implement the minimal code to make RED pass.
5. Record GREEN evidence in `TASKLIST.md` (command + pass summary).
6. REFACTOR third (optional): improve code without changing behavior.
7. For source code changes, update `TASKLIST.md` immediately after each sub-step. Do not batch updates.

## TDD/BDD Enforcement
- For source code tests, all test names must use BDD style: `Given ... When ... Then ...`.
- No source-level feature is complete unless RED and GREEN evidence exists.
- If source behavior code exists without prior RED coverage, create a backfill RED task and do not mark the item `DONE`.
- `DONE` status for source work requires: tests passing + relevant validation commands passing.

## Tasklist Discipline
- `TASKLIST.md` is the execution source of truth.
- moon tasks are command runners only; they do not replace planning status.
- Every major source code action must map to a tasklist item.
- Chore/tooling/config/docs-only actions may be executed without creating or updating tasklist items.
- Keep one explicit active pointer (`NEXT_TASK_ID`) in `TASKLIST.md` at all times.
- Remove stale status docs instead of adding parallel trackers.

## Toolchain and Quality Gates
- Use latest `node` and `pnpm` via `proto`.
- Use `moon` for all operator commands; do not invoke `pnpm` or `cargo` directly when a moon task exists.
- Moon project targets:
  - `workspace:*` for repo orchestration
  - `poc:*` for TypeScript proving/deploy pipeline
  - `mock-server:*` for HTTPS fixture server
  - `tlsnotary:*` for Rust notary/prover
- Use pnpm workspace + catalog as the dependency source of truth:
  - `/pnpm-workspace.yaml`
  - `/poc/package.json`
- TypeScript validation must run with:
  - `tsgo` for type checking
  - `oxlint` for linting
  - `oxfmt` for formatting
- Required validation command: `moon run workspace:validate`.
- Required end-to-end runner: `moon run workspace:run`. Before running, verify the `.env` file exists at the repo root.

## Security and Secrets
- Never commit private keys.
- Keep `.env` and private key files git-ignored.
- Allowed committed artifacts: templates and non-sensitive/public outputs only.

## Hard Constraints
- Full ECDSA path only; no automatic fallback execution.
- Fail fast with clear diagnostics when secp256k1 attestation assumptions are not met.
