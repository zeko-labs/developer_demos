# zkTLS Improvements Added In This Market

This note summarizes the practical zkTLS / TLSNotary improvements we added while turning the original weather-attestation source flow into a production-ish market oracle. It is written so upstream maintainers can quickly see what changed, why it mattered, and which pieces may be worth documenting or upstreaming.

## What changed beyond the original source demo

The original source demo was useful as a starting point for proving that a weather HTTPS response could be attested and consumed. In this repo, we extended that into a full oracle lifecycle that had to survive hosted deployment, repeated resolution, stale days, and user-facing claims. The biggest additions were not just cryptographic. They were operational, policy, and recovery improvements around the attestation flow.

### 1. Strict policy verification at the app layer

We added an explicit verifier layer that checks:

- `server_name`
- exact `request_path`
- attestation freshness
- future skew
- optional strict requirement for a TLSN envelope

Relevant files:

- [`/tmp/private-prediction-market-main/src/tlsn-verifier.ts`](/tmp/private-prediction-market-main/src/tlsn-verifier.ts)
- [`/tmp/private-prediction-market-main/src/oracle-adapter.ts`](/tmp/private-prediction-market-main/src/oracle-adapter.ts)

This made it possible to treat zkTLS as an enforceable oracle policy instead of just a demo artifact.

### 2. Support for both forecast and historical observation inputs

The original flow was forecast-oriented. We added support for two weather input shapes:

- forecast payloads via `properties.periods`
- station observations via `features[].properties.temperature.value`

Relevant files:

- [`/tmp/private-prediction-market-main/src/oracle-adapter.ts`](/tmp/private-prediction-market-main/src/oracle-adapter.ts)
- [`/tmp/private-prediction-market-main/src/resolve-daily-market-zeko.ts`](/tmp/private-prediction-market-main/src/resolve-daily-market-zeko.ts)

This matters because market creation and market resolution are not the same data problem. Forecasts are good for creating future markets. Historical resolution often needs date-specific observations.

### 3. Historical backfill when the original archived attestation is missing

We added a recovery path for overdue markets where the original archived forecast attestation no longer exists. In that case, the resolver can fetch official NWS observations for the exact market date and build a historical resolution input from that.

Relevant files:

- [`/tmp/private-prediction-market-main/src/resolve-daily-market-zeko.ts`](/tmp/private-prediction-market-main/src/resolve-daily-market-zeko.ts)
- [`/tmp/private-prediction-market-main/src/weather-attest.ts`](/tmp/private-prediction-market-main/src/weather-attest.ts)

This was essential once markets rolled out of the short forecast window.

### 4. Per-date attestation archival

We added archival by both timestamp and market date, so the oracle can later ask for:

- "the attestation captured at time T"
- or "the attestation that contains market date YYYY-MM-DD"

Relevant file:

- [`/tmp/private-prediction-market-main/src/weather-attest.ts`](/tmp/private-prediction-market-main/src/weather-attest.ts)

This ended up being one of the most useful practical improvements because rolling forecast APIs are not durable historical sources by themselves.

### 5. Separate live and historical freshness windows

We split freshness policy into:

- a short live freshness window for current oracle sync
- a much larger historical window for overdue market resolution

Relevant file:

- [`/tmp/private-prediction-market-main/src/resolve-daily-market-zeko.ts`](/tmp/private-prediction-market-main/src/resolve-daily-market-zeko.ts)

Without this, old markets failed forever with "attestation too old" even when the correct historical input existed.

### 6. Oracle policy binding to on-chain contract state

The market contract stores oracle policy fields:

- `oracleSourceHash`
- `oracleRequestPathHash`

We had to extend the historical fallback so that it still satisfies the contract's configured policy, even when using backfilled observation data.

Relevant files:

- [`/tmp/private-prediction-market-main/src/fast-contract.ts`](/tmp/private-prediction-market-main/src/fast-contract.ts)
- [`/tmp/private-prediction-market-main/src/resolve-weather-market-zeko.ts`](/tmp/private-prediction-market-main/src/resolve-weather-market-zeko.ts)
- [`/tmp/private-prediction-market-main/src/oracle-adapter.ts`](/tmp/private-prediction-market-main/src/oracle-adapter.ts)

This was a subtle but important productization step. Off-chain recovery logic still has to align with on-chain oracle policy.

### 7. Recovery from stale hosted state during resolution

We found that overdue resolution could fail even with correct weather input if the hosted resolver built witnesses from stale local state while the live chain root had already moved. We added a resync-and-retry path for that exact case.

Relevant files:

- [`/tmp/private-prediction-market-main/src/resolve-weather-market-zeko.ts`](/tmp/private-prediction-market-main/src/resolve-weather-market-zeko.ts)
- [`/tmp/private-prediction-market-main/src/sync-state-zeko.ts`](/tmp/private-prediction-market-main/src/sync-state-zeko.ts)

This was not a zkTLS bug in the narrow sense, but it was essential to making the zkTLS-backed oracle path reliable in a hosted environment.

### 8. Better TLSNotary runtime hardening

The weather attestation runner now includes several pragmatic hardening steps:

- preflight request attempts
- larger receive buffer patching for big weather responses
- forcing HTTP/1.0 for deterministic connection close in the prover path
- binary rebuild detection
- archived status output and latest attestation output

Relevant file:

- [`/tmp/private-prediction-market-main/src/weather-attest.ts`](/tmp/private-prediction-market-main/src/weather-attest.ts)

These changes are the sort of thing that makes a source demo survive real usage.

### 9. Hosted service separation

We ended up separating:

- market service
- oracle worker
- tx-prover

and moved the heavy zkTLS / TLSNotary runtime into the oracle-oriented deployment path.

Relevant files:

- [`/tmp/private-prediction-market-main/render.yaml`](/tmp/private-prediction-market-main/render.yaml)
- [`/tmp/private-prediction-market-main/deploy/Dockerfile.oracle`](/tmp/private-prediction-market-main/deploy/Dockerfile.oracle)
- [`/tmp/private-prediction-market-main/deploy/start-oracle-worker.sh`](/tmp/private-prediction-market-main/deploy/start-oracle-worker.sh)

This was important for both compute cost and reliability. The oracle path is background lifecycle work; it should not sit inside the hot web tier.

## What might be worth upstreaming or documenting better

If upstream wants to spruce up the original docs, these are the most useful additions:

1. Explain the difference between live attestations and historical recovery inputs.
2. Document per-date attestation archival as a first-class pattern.
3. Call out exact `request_path` binding as part of the oracle security model.
4. Add a section on hosted runtime issues:
   - stale state
   - cold starts
   - large response handling
   - when TLSNotary is only one piece of the end-to-end reliability story
5. Show how to pair strict live zkTLS with a clearly documented historical backfill policy.

## Should this become a real developer tool?

Yes.

The work here is now beyond a one-off agent skill. It is starting to look like a reusable developer tool for:

- zkTLS weather attestation generation
- strict verification
- per-date archival
- historical recovery
- contract-policy-aware oracle statement building

The cleanest form would be a small standalone package or toolkit with:

- a CLI
- typed attestation verification helpers
- archive lookup helpers
- historical backfill helpers
- adapters for common weather-style API response shapes

The current skill is still useful for guided debugging and onboarding, but the implementation now has enough reusable substance that it would be reasonable to extract it into a bonafide developer tool.
