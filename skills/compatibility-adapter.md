# Compatibility Adapter

## Purpose

Use the compatibility layer when you want to preserve a legacy-shaped client integration while moving settlement and routing onto the native Zeko runtime.

## When To Use It

- You want a low-friction migration path for an older AI protocol client shape.
- You want chat-completion and inference routes that look familiar to existing builders.
- You still want the native credits, private lane, and operator model underneath.

## Primary Interfaces

- SDK:
  - `CompatClient.listModels()`
  - `CompatClient.createInference()`
  - `CompatClient.createChatCompletion()`
  - `CompatClient.getInference()`
  - `CompatClient.getInferenceStatus()`
  - `CompatClient.getReceipt()`
  - `CompatClient.waitForInference()`
- HTTP:
  - `GET /api/compat/reference/models`
  - `POST /api/compat/reference/inference`
  - `POST /api/compat/reference/chat/completions`
  - `GET /api/compat/reference/inference/:id`
  - `GET /api/compat/reference/inference/:id/status`
  - `GET /api/compat/reference/inference/:id/receipt`
  - `POST /api/mcp`

## Workflow

1. Keep the client-side request shape close to the legacy integration.
2. Route those requests into the compat endpoints or `CompatClient`.
3. Preserve native status tokens, callbacks, and receipt settlement under the hood.
4. Move builders to the native SDK only when they are ready.

## Success Criteria

- Existing integrations can migrate without rewriting their entire client surface.
- The trust boundary remains the native coordinator, not the compatibility layer.
- Builders can step from compat mode to the native SDK over time instead of doing a hard cutover.

## Boundaries

This skill exists to ease migration. It should stay thin. It should not become a second core protocol inside the repo.
