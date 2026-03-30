# Architecture And Extensibility

## What Can Users Run Themselves?

Yes. The system is intentionally structured so that sophisticated users or developers can run their own local or colocated components.

Today, a user can realistically run:

- their own frontend
- their own order-entry router
- their own strategy / execution bot
- their own proof-precompute machine

against the shared market service.

That means someone can:
- run a local UI
- keep signing and intent generation close to their own machine
- place orders through a fast custom client
- optionally run a stronger prover box that feeds proofs back to the canonical service

## What They Cannot Independently Replace

The canonical market still lives at the shared service:

- canonical orderbook
- canonical matcher
- canonical settlement batch construction
- canonical payout authority
- canonical zkApp commit authority

So a user can optimize their own path into the market, but they are not unilaterally creating a separate matching venue on the same state.

That distinction matters:

- self-hosted client / router: yes
- self-hosted prover attached to the same market: yes
- fully independent canonical matcher for the same book: not in the current model

## Why We Built It This Way

This market has a different stress profile than a prediction market:

- more continuous orderflow
- more frequent note updates
- more sensitivity to latency on order entry
- heavier proving pressure under sustained flow

So the design goal is:

- keep order entry fast
- keep matching fast
- keep proving off the hot path
- let proving scale out separately later

That is why the system is split into:

- client-side wallet + order auth
- off-chain market service
- asynchronous proof generation
- on-chain settlement verification / anchoring

## What It Can Become

The natural evolution is:

1. Shared canonical market service
2. Many independent client frontends and order routers
3. Many independent proof machines competing to precompute proofs
4. Single settlement writer / commit authority

That gives a path toward:

- lower-latency client access
- more decentralized execution tooling
- horizontal proof scaling
- stronger operator separation

without putting proving or on-chain verification in the request path.

## Practical Interpretation

For the current demo:

- one hosted market service is enough
- one user can still run a custom local UI or bot against it
- later, if proving becomes the bottleneck, add more proof machines before changing the market design

So the intended model is:

- shared market
- user-controlled access path
- scalable proof layer
- single canonical settlement path
