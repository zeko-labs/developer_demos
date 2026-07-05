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
holderProof.messageHash
eventHash
```

The holder proof must bind to the exact mission, policy, action, target domain,
payment context, side-effect id, idempotency key, and previous hash. Reusing the
same proof with a different mission, action, or target domain fails
verification.

