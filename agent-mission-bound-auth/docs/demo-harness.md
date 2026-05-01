# Demo Harness

The browser UI is a tutorial and local testing platform for the protocol.

It is intentionally not the product.

## What It Demonstrates

The harness simulates one domain app: private compute over sealed data.

It walks through:

1. demo proof issuance
2. agent passport creation
3. task-bound mission proposal
4. mission approval
5. checkpoint enforcement
6. x402 payment negotiation
7. domain execution
8. mission-linked receipt

## What Production Apps Should Reuse

Production apps should reuse:

- discovery metadata
- agent passports
- mission objects
- approval JWS verification
- checkpoint verification
- portable mission bundles
- Zeko approval and receipt anchoring

They do not need to reuse the private-compute dataset, UI, or example operation.

## Why Keep The Harness

The harness gives developers a local place to test protocol integrations before wiring their own domain app.

It also provides a known-good reference flow for conformance tests and reviewer demos.
