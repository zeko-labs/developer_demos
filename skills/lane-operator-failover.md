# Lane Operator Failover

## Purpose

Use this skill when the runtime is split across multiple operators and you need to verify routing policy, lane ownership, isolation, and backup health.

## When To Use It

- The deployment uses separate request, output, registry, or credits operators.
- You want membership-first routing instead of local fallback.
- You are preparing for or testing failover.

## Primary Interfaces

- SDK:
  - `CoordinatorClient.getRouting()`
  - `CoordinatorClient.getRoutingPolicy()`
  - `CoordinatorClient.getOperatorHealth()`
  - `CoordinatorClient.getOperatorMembership()`
  - `CoordinatorClient.getOperatorIsolationAudit()`
- HTTP:
  - `GET /api/operators/routing`
  - `GET /api/operators/policy`
  - `GET /api/operators/health`
  - `GET /api/operators/membership`
  - `GET /api/operators/isolation/audit`

## Workflow

1. Inspect current routing and membership policy.
2. Verify that each lane has an explicit active owner and an off-box backup where intended.
3. Run the isolation audit and clear `error` findings before calling the deployment hardened.
4. Pause or drain a remote operator only when a healthy backup exists.
5. Re-run routing and queue checks after failover to confirm the runtime still settles receipts and credits.

## Success Criteria

- Lane ownership is explicit.
- Backups are active and reachable.
- Isolation audit findings are zero or intentionally understood.
- Builders keep the same coordinator URL even when a lane moves to another operator.

## Boundaries

This skill is about runtime operations. It does not decide product policy, agent reputation, or marketplace economics.
