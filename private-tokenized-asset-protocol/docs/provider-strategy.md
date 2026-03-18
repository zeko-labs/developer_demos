# Provider Strategy

## Positioning

TAP is not a product for any single API vendor. It is a forkable tokenization and compliance tooling stack that lets banks, issuers, brokers, custodians, and consortium operators connect their own source systems into a private, policy-linked tokenized asset workflow.

The open-source repo should prove three things:

- the protocol architecture is real
- the integration model is reusable
- the customer can plug in its own sandbox or internal systems

## Commercial Model

The intended go-to-market posture is:

- publish the protocol, adapters, zkTLS path, policy engine, and demo tooling openly
- show reference integrations that prove the architecture works
- invite banks and other institutions to bring their own sandbox or internal API
- partner with them on the first full integration once they engage

The message to customers is:

- here is the code
- here is the operating model
- here is the value proposition
- when you are ready, we will wire the PoC to your own sandbox

## Provider Tiers

### Tier 1: Reference Providers

These exist to prove the tooling model in public:

- Plaid for retail-style balance data
- Increase or Unit for bank-style account APIs
- Persona or Alloy for identity and KYC
- one custody or holdings-style provider
- one zkTLS-compatible HTTPS source

These are examples, not dependencies.

### Tier 2: Strategic Demo Categories

The repo should demonstrate categories that matter to tokenized asset operators:

- balance and account state
- identity and KYC
- suitability or accredited investor state
- holdings and custody
- issuer reserve or treasury verification
- transfer restriction inputs

This is the level a real customer maps onto.

### Tier 3: Customer-Owned Providers

The real deployment target is not a public reference provider. It is the customer's own environment:

- internal bank sandbox APIs
- broker or transfer-agent systems
- custody ledgers
- treasury systems
- HTTPS data sources that can be verified through zkTLS

This is where the protocol becomes commercially useful.

## Customer Integration Bridge

The intended bridge from public repo to real engagement is:

1. show the flagship public artifact
2. collect the sandbox onboarding packet
3. use the customer sandbox mapping kit
4. wire one customer-owned source
5. generate one customer-specific transcript pack

Relevant docs:

- [bank-sandbox-onboarding-packet.md](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/docs/bank-sandbox-onboarding-packet.md)
- [customer-sandbox-mapping-kit.md](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/docs/customer-sandbox-mapping-kit.md)
- [first-customer-integration-template.md](/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/docs/first-customer-integration-template.md)

## What Ships in Open Source

- adapter contract and provider interface
- example adapters across the main provider categories
- zkTLS source path
- policy engine and settlement linkage
- maker-checker issuer controls
- demo scripts, transcript pack, and release bundle flow
- onboarding packet and pilot examples

## What Happens With a Real Customer

When a customer engages, the expected workflow is:

1. choose the flagship pilot:
   - stablecoin access and mint controls
   - tokenized equity investor gating and transfer controls
2. collect the sandbox onboarding packet
3. map the customer source to:
   - adapter mode
   - zkTLS mode
4. wire one or more customer-owned sources
5. generate a customer-specific transcript pack
6. identify production hardening requirements

## Recommended Messaging

Do not say:

- this only works with Plaid
- this only works with Stripe
- this is a product for one vendor stack

Say instead:

- these are reference integrations
- the protocol is provider-agnostic
- the real value is the private, policy-linked operating model
- we will wire the PoC to your own sandbox or internal systems

## Recommended Reference Set

For the public repo, the most useful reference set is:

- Plaid for balance
- one bank-style server-to-server adapter such as Increase or Unit
- one identity provider such as Persona or Alloy
- one holdings or custody adapter
- one zkTLS HTTPS source

This is enough to prove the architecture without overfitting the product to one vendor.
