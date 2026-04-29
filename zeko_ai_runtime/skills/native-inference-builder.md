# Native Inference Builder

## Purpose

Use the native coordinator surface when you want the cleanest builder path into the runtime: create an inference, get a status token, and optionally settle request and output receipts on Zeko.

## When To Use It

- You are integrating directly with the runtime instead of a legacy adapter.
- You want the `v2` threshold-attested receipt path by default.
- You want one coordinator URL even if settlement lanes are split across operators.

## Primary Interfaces

- SDK:
  - `CoordinatorClient.createLiveInference()`
  - `CoordinatorClient.waitForInferenceStatus()`
- HTTP:
  - `POST /api/infer`
  - `POST /api/infer/live`
  - `POST /api/infer/v2/live`
  - `GET /api/request-status/:token`
  - `GET /api/inferences/:id/zeko/v2/live-settlement`

## Workflow

1. Resolve coordinator auth and base URL.
2. Submit an inference with a stable `idempotencyKey`.
3. Store the returned `inferenceId` and `statusToken`.
4. Poll `GET /api/request-status/:token` or call `waitForInferenceStatus()`.
5. If you need on-chain confirmation details, read the `liveSettlement` or `liveSettlementV2` fields or fetch the explicit live-settlement endpoint.

## Success Criteria

- The inference returns immediately on the fast path.
- A status token is available for async completion checks.
- Request and output receipt artifacts are attached when live settlement is enabled.
- Builders do not need lane-specific logic in their client.

## Boundaries

This skill is about inference and receipt flow. It does not replace private input sealing, credits policy, or higher-level agent coordination logic.
