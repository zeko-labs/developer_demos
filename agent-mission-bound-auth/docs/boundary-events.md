# Boundary Events

Boundary events are the standard vocabulary for mission checkpoints. They make
policy compliance portable across apps without requiring every app to expose
its internal workflow.

## Version

`mission-bound-action-vocabulary-v1`

## Canonical Actions

```text
browser.open
page.read
form.fill
vault.read
cart.prepare
payment.prepare
payment.authorize
private_compute.run
email.draft
email.send
external_agent.hire
external_app.side_effect
final_submit
x402.payment_offer
x402.pay
x402.settle
zeko.receipt.anchor
```

Apps can use namespaced extensions, but portable verifiers should understand
the canonical actions above.

## Event Binding

Each event binds:

```text
missionIdHash
capabilityHash
policyHash
action
targetDomainHash
resourceHash
paymentContextDigest
idempotencyKey
previousEventHash
holderProof.scheme
holderProof.messageHash
holderProof.signature
eventHash
```

The holder proof must bind to the exact mission, policy, action, target domain,
payment context, side-effect id, idempotency key, and previous hash. Reusing the
same proof with a different mission, action, or target domain fails
verification.

## Holder Proof Schemes

Local demos and deterministic conformance fixtures can use
`digest-holder-proof-v1`. This scheme proves event-context binding, but it is
not a public-key proof of runtime possession.

Production verifiers reject `digest-holder-proof-v1` unless they explicitly opt
into demo proofs. Production boundary events should use
`ed25519-holder-proof-v1` or a ZK-friendly signature scheme. For Ed25519, the
holder proof includes a public JWK and signature over the holder challenge hash,
and the verifier checks that `sha256(publicJwk)` matches the event's
`holderKeyCommitment`.
