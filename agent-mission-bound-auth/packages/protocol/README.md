# Protocol Package

Core Agent Mission-Bound Auth primitives live here.

This package owns portable protocol objects and verification inputs:

- agent passports
- mission proposals
- mission approvals
- checkpoint enforcement
- x402 rail metadata
- Zeko anchoring plans
- revocation state
- canonical digests and JWS helpers

It should stay domain-neutral. Private compute is a demo harness concern, not a protocol requirement.
