# Secure Mode: Confidential Matching Design

Secure Mode is a future execution mode for keeping private order flow
confidential from the market operator. It is not enabled by the current hosted
runtime. The current runtime is lean; Full Mode adds proof-backed private-state
settlement but keeps the same off-chain matcher.

## Two DA Boundaries

Do not conflate two different uses of data availability:

- **Zeko protocol DA:** publishes rollup transaction data and receipts so the
  state can be reconstructed and independently checked. This is not private
  order matching.
- **Application-level sealed-order DA:** could distribute encrypted order
  envelopes to wallets or a matcher. This is an optional discovery layer; it
  does not replace Zeko protocol DA or make the matcher confidential.

The official [Zeko security model](https://docs.zeko.io/architecture/security-model)
describes protocol DA as public data needed to reconstruct the rollup. The
[Zeko technical architecture](https://docs.zeko.io/architecture/technical-architecture)
also describes the current DA design as multisig-based and transitioning toward
Celestia. Neither statement makes the current ShadowBook matcher private from
its operator.

## What Application-Level DA Does And Does Not Do

Data availability can replace best-effort gossip for sealed offer dissemination.
A wallet can publish an encrypted offer envelope to a namespace, and other
wallets or matching services can retrieve the same committed payload. This can
improve retrievability, censorship resistance, and shared discovery. That is a
distribution primitive, not a matching primitive.

DA does not, by itself:

- decrypt or match orders
- hide ciphertext timing, size, or namespace metadata
- prevent an operator with the decryption key from reading orders
- prove that a match or private-state transition was correct

The Midnight/Celestia pattern is therefore a useful reference for encrypted
offer distribution, not a complete replacement for confidential matching. In
that case study, private-wallet protocols use a DA/P2P layer to distribute
sealed offers; Celestia itself is not the matcher. See the
[Celestia case study](https://blog.celestia.org/midnight-network-a-case-study-in-using-data-availability-for-peer-to-peer-networking/).

For Zeko deployment context, see the official [Rollup on Phala guide](https://docs.zeko.io/operators/guides/rollup-on-phala)
and the [Zeko on Ethereum architecture](https://ethereum.docs.zeko.io/architecture).
Those documents describe rollup hosting, sequencer/prover/DA boundaries, and
the current Ethereum settlement architecture. They do not make this
ShadowBook matcher a confidential service automatically.

## Proposed Secure Flow

```text
Wallet
  -> creates private note-funded order
  -> encrypts order envelope for the matching committee / TEE
  -> signs commitment + ciphertext hash
  -> publishes ciphertext to a DA namespace

DA / indexers
  -> replicate and retrieve the sealed envelope
  -> expose commitment and availability proof, not plaintext order data

Attested matcher
  -> verifies wallet authorization and DA commitment
  -> decrypts only inside the attested boundary
  -> matches orders and updates private note state
  -> emits fill commitments and encrypted user receipts

Proof worker
  -> proves note membership, nullifier freshness, output notes, and batch netting

Zeko settlement
  -> verifies the proof
  -> anchors settlement, note, nullifier, sequencing, and availability commitments

Wallet
  -> verifies receipt / proof references
  -> decrypts its own fill and note updates locally
```

## Pseudocode Boundary

```ts
type SecureOrderEnvelope = {
  orderCommitment: string;
  ciphertext: string;
  ciphertextHash: string;
  senderAuthorization: string;
  daNamespace: string;
  expiresAtUnixMs: number;
};

// Wallet side. The plaintext order and selected notes never enter the normal
// market-service request path.
const envelope = await wallet.encryptAndSignOrder({
  order,
  noteSelection,
  recipient: matchingCommitteeKey
});
const availability = await da.publish(envelope.daNamespace, envelope.ciphertext);

// TEE / threshold matcher side. Decryption and matching occur inside the
// confidential boundary; only commitments and encrypted receipts leave it.
const sealedBatch = await confidentialMatcher.execute({
  envelopes: await da.retrieve(availability),
  attestationPolicy,
  previousPrivateStateRoot
});

const proof = await prover.provePrivateStateTransition(sealedBatch.witness);
await zeko.commitBatch({
  settlementRoot: sealedBatch.settlementRoot,
  noteRoot: proof.nextNoteRoot,
  nullifierRoot: proof.nextNullifierRoot,
  sequencingRoot: sealedBatch.sequencingRoot,
  availabilityRoot: availability.root,
  proof: proof.publicProof
});
```

## Phala Deployment Boundary

The official Zeko Phala guide deploys a Zeko rollup CVM by pasting the rollup
Docker Compose from the launch guide and recommends a 32 GB instance for the
current resource profile. That is network infrastructure hosting. It is not an
attested ShadowBook matcher deployment.

If a separate Phala confidential-runtime Compose deployment is used for Secure
Mode, it should run the `confidentialMatcher` and, where appropriate, the proof
worker. It remains an external deployment dependency; no Phala Compose
manifest is checked into this order-book repository, so this document does not
claim that Secure Mode is currently deployed.

The deployment must verify:

- remote attestation before releasing matching keys
- an allowlisted matcher image and measurement
- no plaintext order logging or debug output
- encrypted persistent state and encrypted DA payloads
- key rotation and recovery procedures
- proof and settlement outputs remain independently verifiable on Zeko

TEE is a practical first implementation, not the only possible one. Wallet-to-
wallet matching or threshold/MPC matching could reduce the single-enclave trust
surface, but those are separate designs and are not implemented here.

## Mode Contract

| Mode | Public-chain privacy | State correctness | Operator confidentiality |
| --- | --- | --- | --- |
| Lean | commitments / roots | operator-enforced | No |
| Full | commitments / roots | ZK-proven private-state transition | No, by itself |
| Secure | encrypted envelopes plus commitments | Full-mode proof recommended | Intended, subject to attestation / MPC assumptions |

The current server reports `secureModeAvailable: false` so a deployment cannot
mistakenly market the existing matcher as Secure Mode.
