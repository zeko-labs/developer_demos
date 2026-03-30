# Competitive Architecture Landscape

This note compares ShadowBook to a few leading private trading systems from an architecture and privacy standpoint.

The focus here is:
- where privacy comes from
- what is verified cryptographically versus trusted operationally
- what data is public, private, or selectively disclosed
- what the hosting / proving / settlement burden looks like

It is intentionally not focused on market structure differences like order book vs midpoint matching except where those choices materially affect architecture.

## ShadowBook

Current default mode:
- private/public order visibility at the app layer
- off-chain matching
- note-backed private collateral
- batched on-chain settlement anchoring
- lean zkApp as the hosted default

Privacy model:
- private orders do not rest in the public book
- notes abstract balances away from direct wallet activity during trading
- the operator still sees and manages the private trading state

Verification model:
- in lean mode, the chain anchors settlement progression and root updates
- the operator enforces correctness of note spends, nullifiers, and outputs
- the chain does not fully verify private-state correctness on-chain

Strengths:
- simple to host
- fast request path
- clear hybrid model
- pragmatic for demo and early production

Tradeoffs:
- more operator trust than a full proof system
- weaker cryptographic guarantees around private-state correctness

## Hibachi

Primary references:
- [Hibachi docs](https://docs.hibachi.xyz/)
- [Succinct: Private Proving Is Here](https://blog.succinct.xyz/private-proving/)

Grounded architectural read:
- off-chain high-performance exchange
- smart-contract custody on existing chains
- zk-verified settlement / validity path
- encrypted data availability using Celestia
- proving stack associated with Succinct
- Base / Arbitrum used for collateral rails

Privacy model:
- privacy is not just “hide the UI order”
- the system aims to keep sensitive state private while still making settlement verifiable
- Succinct’s post specifically describes private proving with a TEE protecting witness data while zk proofs provide cryptographic correctness

Important distinction:
- TEE protects the proving environment and witness confidentiality
- zk proofs provide correctness
- TEE is not a replacement for zk verification

Strengths:
- stronger settlement correctness than a lean hybrid exchange
- good fit for hosted high-performance private trading
- encrypted DA plus zk verification is a strong architecture for auditability and recovery

Tradeoffs:
- materially more infra complexity
- more moving parts across prover, DA, execution chain, and custody
- TEE introduces a hardware / attestation trust surface
- some Hibachi materials describe full client-side encrypted order flow and enclave matching as an evolving direction, so the end-state privacy architecture should be distinguished from what is already fully live

## Renegade

Primary references:
- [Renegade docs](https://docs.renegade.fi/)
- [Renegade whitepaper](https://whitepaper.renegade.fi/)

Grounded architectural read:
- private dark-pool style venue
- MPC used in the matching / coordination flow
- zk proofs used for validity / settlement
- on-chain state minimized to commitments and verification

Privacy model:
- one of the strongest pre-trade privacy models among current DEX architectures
- order information is not exposed in a public book
- MPC helps avoid revealing full order details to a single operator

Strengths:
- strongest dark-pool style privacy among the main comparators
- reduced information leakage relative to a normal off-chain matcher
- cryptographic design is deeply aligned with “private execution”

Tradeoffs:
- highest complexity of the group
- more difficult network and proving architecture
- harder to operate than a lean hybrid exchange

## Penumbra

Primary references:
- [Penumbra docs](https://guide.penumbra.zone/)

Grounded architectural read:
- privacy-native chain rather than a privacy layer on top of a general-purpose chain
- shielded assets and shielded DEX behavior are part of the base protocol
- users operate inside a private state model by default

Privacy model:
- strongest native privacy boundary in this comparison set
- privacy is a property of the chain itself, not just the application

Strengths:
- very strong architectural privacy guarantees
- elegant consistency between custody, transfers, and exchange

Tradeoffs:
- much less aligned with a low-latency exchange / dark-pool terminal model
- different product shape than a hosted off-chain matcher with batched settlement

## TEE vs ZK

This is the most important conceptual distinction in these systems.

TEE:
- protects code and data while running in trusted hardware
- useful for keeping witness data private from prover infrastructure
- depends on hardware vendor assumptions and attestation

ZK:
- proves correctness cryptographically
- useful for showing a state transition is valid without revealing all witness data
- usually more expensive than a trusted operational check

Clean summary:
- TEE helps with confidential execution
- zk helps with verifiable correctness
- strong systems often combine them rather than choosing one or the other

## ShadowBook Positioning

The current ShadowBook architecture is best understood as:
- a lean hybrid private trading venue
- fast off-chain matching
- private/public order visibility controls
- note-backed collateral abstraction
- on-chain anchoring without full private-state verification in the default hosted path

That makes it:
- simpler and faster to host than Hibachi-, Renegade-, or Penumbra-like full privacy systems
- weaker in trust minimization than those systems

## Practical Takeaway

If the goal is:

- fastest path to a usable private trading venue:
  - ShadowBook’s lean architecture is a strong fit

- stronger cryptographic settlement guarantees with hosted performance:
  - Hibachi-style architecture is the closer reference

- strongest dark-pool privacy model:
  - Renegade is the stronger reference

- strongest chain-native privacy boundary:
  - Penumbra is the stronger reference

The main architectural question for ShadowBook is not “which market structure label fits best” in isolation.
It is:

- how much operator trust is acceptable
- how much proving / infrastructure complexity is acceptable
- whether private execution should be enforced operationally, via zk, via TEE-assisted proving, or some combination
