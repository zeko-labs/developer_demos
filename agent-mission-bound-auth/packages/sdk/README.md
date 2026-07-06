# SDK Package

Client and verifier helpers for applications that consume Agent Mission-Bound Auth.

Use this package from external apps that need to:

- discover a mission authority
- request agent passports
- propose and approve missions
- verify portable mission bundles offline
- verify checkpoint approvals before performing side effects
- enforce checkpoints through the bearer-gated mission authority when the app is trusted to update replay, budget, and audit state

The SDK should not depend on the demo harness.
