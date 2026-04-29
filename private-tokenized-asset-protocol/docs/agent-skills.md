# Agent Skills To Add In This Repo

These are the highest-value agent skills to document for TAP.

The goal is not to create generic coding helpers. The goal is to capture the workflows and judgment that are specific to this repo:

- private tokenized asset operations
- policy-linked proof flows
- customer sandbox onboarding
- zkTLS-backed source integration
- release and transcript packaging

## 1. `tap-flagship-pilot`

Use when an agent needs to run, explain, or validate the main TAP dual-asset pilot.

Should cover:

- how to run `./scripts/run_dual_asset_flagship_pack.sh`
- what the flagship artifact proves
- where the public and private transcript artifacts land
- how to verify whether a failure is UI, API, policy, or transcript related

Why it matters:

- this is the main “show me the protocol works” path
- it should be the default skill for demoing TAP internally or externally

## 2. `tap-customer-sandbox-onboarding`

Use when a bank, issuer, custodian, or consortium wants to adapt TAP to its own sandbox.

Should cover:

- onboarding packet
- mapping kit
- bootstrap templates
- customer-owned dual-asset demo pack
- when to use adapter mode vs zkTLS mode

Why it matters:

- this is the core commercial handoff path
- it turns TAP from a public repo into a real pilot integration process

## 3. `tap-policy-settlement-guard`

Use when working on proof public inputs, policy versioning, settlement acceptance, or stale-policy rejection.

Should cover:

- active policy resolution
- `policyId`, `policyVersion`, `policyHash`, `policySnapshotHash`
- settlement-time policy linkage checks
- failure modes for stale or mismatched proofs

Why it matters:

- this is one of the most important repo-specific logic surfaces
- it is easy to break if the mental model is not explicit

## 4. `tap-zktls-source-integration`

Use when working on external zkTLS-backed source flows.

Should cover:

- relationship between TAP and `external/zk-verify-poc`
- bank vs employment source profiles
- latest artifact ingestion path
- canonical external-proof mapping into TAP
- what is source authenticity vs what is TAP settlement semantics

Why it matters:

- this is one of the most distinctive technical surfaces in the repo
- it is where people are most likely to misunderstand what is “real” vs “reference”

## 5. `tap-proof-runtime`

Use when working on `o1js` proof generation, verification, verifier commands, or runtime mode configuration.

Should cover:

- `PROOF_MODE`
- `ZK_PROVER_BACKEND=o1js`
- prove command wiring
- verifier command wiring
- `zk-o1js-proof` handling
- differences between reference verifier mode and runtime verifier mode

Why it matters:

- this is the heart of TAP’s proof credibility story
- it is also one of the easiest areas to misconfigure

## 6. `tap-issuer-workflows`

Use when working on issuer lifecycle flows for stablecoins and tokenized stocks.

Should cover:

- maker-checker semantics
- stablecoin `mint` and `burn`
- stock `issue`, `allocate`, `restrict`, `redeem`
- how issuer requests and settlements fit together

Why it matters:

- this is the operating model for the asset rails themselves
- it is more domain-specific than a generic CRUD workflow

## 7. `tap-release-packaging`

Use when building public artifacts, release bundles, transcript packs, or launch collateral.

Should cover:

- flagship transcript
- enterprise pack
- public pack
- release audit bundle
- transcript verification
- how to keep public artifacts redacted and externally shareable

Why it matters:

- TAP is partly a protocol and partly a public proof package
- this skill keeps launch and partner-facing outputs consistent

## 8. `tap-ui-surface-polish`

Use when editing the issuer, wallet, or auditor UIs.

Should cover:

- the intended visual positioning of the three surfaces
- how public-facing they should feel
- which parts are product theater vs real operator affordances
- what not to overbuild relative to the protocol core

Why it matters:

- the UI is not the deepest layer of the repo
- but it is often the first thing a new partner sees

## Recommended build order

If we only build a few skills first, the highest-value order is:

1. `tap-flagship-pilot`
2. `tap-customer-sandbox-onboarding`
3. `tap-zktls-source-integration`
4. `tap-policy-settlement-guard`
5. `tap-proof-runtime`

That set covers the most important product, protocol, and integration surfaces.

## Suggested location

If we later turn these into actual reusable Codex skills, the clean repo shape would be:

```text
skills/
  tap-flagship-pilot/
  tap-customer-sandbox-onboarding/
  tap-policy-settlement-guard/
  tap-zktls-source-integration/
  tap-proof-runtime/
  tap-issuer-workflows/
  tap-release-packaging/
  tap-ui-surface-polish/
```

Each should keep:

- a concise `SKILL.md`
- optional `references/` for repo-specific details
- optional `scripts/` only when deterministic execution is important
