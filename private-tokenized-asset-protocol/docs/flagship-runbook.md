# Flagship Runbook

## Purpose

Use this runbook when presenting TAP as the control plane for a private, permissioned tokenized market.

The flagship artifact is the dual-asset transcript:

- stablecoin as the private cash leg
- tokenized stock as the private risk-asset leg

The point of the run is not to show a consumer UI. The point is to show that both asset classes can be governed by the same policy, proof, approval, and settlement control plane.

## What the Flagship Demo Proves

### 1. Private Cash Rail

- customer eligibility for stablecoin can be driven by off-chain evidence
- mint and burn require issuer approval workflow
- transfer behavior can be gated by policy-linked proofs

### 2. Private Risk-Asset Rail

- tokenized stock issuance and allocation can be approval-gated
- restriction and redemption are explicit lifecycle actions
- investor-facing asset controls can be tied to policy state

### 3. Shared Control Plane

- the same tenant config, policy engine, proof runtime, and settlement registry govern both asset classes
- the same maker-checker model applies across cash-like and security-like assets
- the same transcript and audit surface can be reviewed by operators and partners

## What to Run

For the main flagship artifact:

```bash
cd /Users/evankereiakes/Documents/Codex/tokenized-asset-protocol
./scripts/run_dual_asset_flagship_pack.sh
```

Outputs:

- private transcript:
  - `output/demo-transcripts/dual-asset-flagship-demo-<timestamp>.md`
- public redacted transcript:
  - `output/demo-transcripts/dual-asset-flagship-demo-<timestamp>.public.md`
- stable public alias:
  - `output/demo-transcripts/public-pack/flagship-dual-asset-latest.public.md`

## How to Walk a Partner Through It

### Step 1: Frame the Problem

Say:

- public-chain token issuance is not enough for regulated private markets
- institutions need privacy, permissions, and auditable controls across both cash and assets

### Step 2: Explain the Two Legs

Say:

- the stablecoin path represents private settlement cash
- the stock path represents private market assets
- together they form the minimal two-way on-chain market structure

### Step 3: Explain the Shared Control Plane

Say:

- both flows rely on the same policy engine
- both flows require proof-linked settlement
- both flows use the same issuer approval model

### Step 4: Explain the Commercial Model

Say:

- these reference integrations prove the architecture
- the repo is provider-agnostic
- when you are ready, we wire the PoC to your own sandbox or internal systems

## Recommended Talking Points

- this is not a public token issuance toolkit
- this is a private tokenization control plane
- the moat is privacy plus deterministic policy linkage
- the repo shows enough code and workflow depth to evaluate the model before customer-specific integration

## What to Show First

1. the public flagship transcript
2. the flagship demo plan
3. the provider strategy
4. the onboarding packet

Suggested reading order:

1. `docs/flagship-demo-plan.md`
2. `docs/flagship-runbook.md`
3. `docs/provider-strategy.md`
4. `output/demo-transcripts/public-pack/flagship-dual-asset-latest.public.md`

## What to Say if a Bank Asks About Integrations

Say:

- Plaid, bank-style adapters, identity providers, custody sources, and zkTLS paths are reference examples
- the real next step is mapping TAP to the bank's own sandbox
- the onboarding packet tells us what we need to wire the first PoC quickly

## What This Demo Does Not Claim

- it does not implement a rollup or exchange matching engine
- it does not require public-chain transparency
- it does not assume one provider or one vendor stack
- it does not require a hosted public product

## Next Step After a Strong Demo

If the partner is interested, the next move is:

1. select the first customer pilot:
   - stablecoin access and mint controls
   - tokenized equity investor gating and transfer controls
2. collect the onboarding packet
3. map sources to adapter mode or zkTLS mode
4. wire the PoC to the partner sandbox
