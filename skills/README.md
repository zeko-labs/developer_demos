# Agent Skills

These are the runtime-oriented agent skills that make sense for this repo.

They are intentionally narrower than the rest of your stack:

- `agent_coordination_protocol` is where market structure, negotiation, and multi-agent task routing belong.
- `nava` is where execution escrow, approval, and transaction verification flows belong.
- `SantaClawz` is where broader identity, privacy, trust, and policy layers belong.
- `Zeko AI Runtime` is where verifiable AI execution, private inference transport, credits metering, and receipt settlement belong.

Documented skills:

- [native-inference-builder.md](native-inference-builder.md): direct builder path for low-latency inference plus Zeko receipts.
- [private-inference-builder.md](private-inference-builder.md): sealed-input and encrypted-output path for sensitive prompts.
- [credits-balance-operator.md](credits-balance-operator.md): metering, spend intents, and fast-path credits UX.
- [lane-operator-failover.md](lane-operator-failover.md): routing health, membership policy, and off-box lane failover.
- [compatibility-adapter.md](compatibility-adapter.md): legacy-shaped integration layer that still settles through the native runtime.

The guiding principle is simple: this repo should document the skills an agent needs to use or operate the runtime itself, not the bigger protocol or product layers that sit above it.
