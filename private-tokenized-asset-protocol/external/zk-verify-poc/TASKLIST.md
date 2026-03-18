# TASKLIST

Last updated: 2026-03-11
Status legend: `TODO`, `IN_PROGRESS`, `DONE`, `BLOCKED`

## Usage Contract (Mandatory)
1. Move the target task to `IN_PROGRESS` before editing implementation files.
2. RED first: add or adjust tests and capture failing evidence.
3. GREEN second: implement the minimal fix and capture passing evidence.
4. REFACTOR third: optional cleanup without behavior changes.
5. Update this file immediately after each RED/GREEN step with command evidence.

## Active Pointer
- `NEXT_TASK_ID`: `T-233`

## Open Work Queue
- `T-232` `DONE` Add bank-balance mock fixture path and bank disclosure/proving mode alongside employer mode.
  - RED:
    - `2026-03-11` `~/.proto/shims/moon run mock-server:test --force` failed in `mock-server/tests/server.spec.ts` because `BANK_ACCOUNT_RECORD` and `INELIGIBLE_BANK_ACCOUNT_RECORD` were undefined in `mock-server/server.ts`.
    - `2026-03-11` `~/.proto/shims/moon run poc:test --force` failed in `poc/tests/extract-fields.spec.ts` and `poc/tests/prove-input.spec.ts` because `buildDisclosedFields()` only parsed employee payloads and `assertEligibilityPolicy()` still enforced employer-only salary/tenure/status rules.
  - GREEN:
    - `2026-03-11` `~/.proto/shims/moon run mock-server:test --force` passed with 7/7 tests after adding `/api/v1/accounts/balance` fixtures and routing in `mock-server/server.ts`.
    - `2026-03-11` `~/.proto/shims/moon run poc:test --force` passed with 45/45 tests after adding bank-aware disclosure aliases, profile-aware policy validation, and correcting the pinned trusted notary key constants.
- `T-233` `IN_PROGRESS` Make shell runners honor `MOON_BIN` so external bank-mode orchestration works when `moon` is not on PATH.
- `T-233` `DONE` Make shell runners honor `MOON_BIN` so external bank-mode orchestration works when `moon` is not on PATH.
  - RED:
    - `2026-03-12` TAP `zktls-bank` live source-collect returned `502 upstream_unavailable` with `./run-poc.sh: line 127: moon: command not found` because `run-poc.sh` and friends hardcoded `moon` instead of using an overrideable binary path.
    - `2026-03-12` After fixing the runner path, TAP `zktls-bank` live source-collect still returned `502 upstream_unavailable` at `poc:prove` with `notary public key does not match trusted key`, showing the PoC trusted-key pin was stale relative to the configured `TLSNOTARY_SIGNING_KEY_HEX`.
  - GREEN:
    - `2026-03-12` `~/.proto/shims/moon run poc:test --force` passed with 45/45 tests after deriving the trusted notary public key from the configured signing key and honoring `MOON_BIN` in `run-poc.sh`.
    - `2026-03-12` TAP live `zktls-bank` transcript `output/demo-transcripts/zktls-bank-source-collect-demo-2026-03-12T19-21-33Z.md` completed with `passed: 5` and `failed: 0`, including a recorded settlement for `subjectCommitment=subj_zktls_bank_demo_001`.
