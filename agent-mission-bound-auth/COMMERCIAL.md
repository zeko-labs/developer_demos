# Commercial Production Terms

This document summarizes the intended commercial posture for Agent
Mission-Bound Auth. The controlling source license is [LICENSE](./LICENSE).
Commercial agreements with Zeko Labs may grant broader rights.

## Non-Production Use

The Business Source License grants non-production use of this repository.
Non-production use includes development, testing, research, demos, local
evaluation, security review, interoperability experiments, and internal proof
of concept work that does not serve live customer, partner, or production
traffic.

## Production Use Under The Additional Use Grant

Production use is permitted under the Additional Use Grant only when a
deployment preserves all of the following:

- Zeko mission approval anchoring
- Zeko receipt/root anchoring
- Zeko-compatible settlement verification
- the configured Agent Mission-Bound Auth protocol fee

"Zeko-compatible" means the Zeko network, a successor network operated or
designated by Zeko Labs, or another settlement or anchoring system approved in
writing by Zeko Labs.

Production deployments that remove, bypass, replace, disable, avoid, or
reimplement those mechanisms require a commercial license from Zeko Labs.

## Billable Event

The intended fee-bearing event is a settled mission-bound action, not every
login, stateless verification call, checkpoint simulation, or failed dry run.

A settled mission-bound action includes a finalized receipt or settlement
release for work such as:

- a private compute run
- an external side effect
- a paid agent action
- a domain action whose receipt releases settlement

The protocol fee amount, collection mechanism, reporting cadence, and any
waivers are set by deployment configuration or a separate commercial agreement.

## Successor Networks

The license is designed so the production path can survive protocol and network
evolution. If Zeko Labs designates a successor network or approves another
anchoring or settlement system in writing, that system can satisfy the
Zeko-compatible production requirement.

## Rights Not Granted

This repository license does not grant trademark rights. Patent rights, if any,
are granted only to the extent stated in the applicable source license or a
separate written commercial agreement.
