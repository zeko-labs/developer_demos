# Node Builder Example

This is a minimal starter for builders who want to talk to the coordinator through the package export instead of hand-writing `fetch` calls.

## Commands

From the repo root:

```bash
node examples/node-builder/index.mjs auth-me
node examples/node-builder/index.mjs routing
node examples/node-builder/index.mjs policy
node examples/node-builder/index.mjs membership
node examples/node-builder/index.mjs operator-health
node examples/node-builder/index.mjs operator-audit
node examples/node-builder/index.mjs credits-queue
node examples/node-builder/index.mjs credits-item
node examples/node-builder/index.mjs infer-live
node examples/node-builder/index.mjs private-infer
node examples/node-builder/index.mjs agent-live
node examples/node-builder/index.mjs credits-spend
node examples/node-builder/index.mjs credits-fast
node examples/node-builder/index.mjs credits-spend-wait
```

## Environment

Optional shared settings:

```bash
export ZEKO_AI_COORDINATOR_URL=http://127.0.0.1:5180
export ZEKO_AI_COORDINATOR_API_KEY=...
```

The example also calls `loadCoordinatorEnv()`, so from the repo root it will auto-load:

- `ZEKO_AI_COORDINATOR_ENV_FILE` when explicitly set
- the only builder env file in the runtime data dir when exactly one builder credential exists
- the generated local SDK env snippet from `npm run auth:enable`

For `agent-live`:

```bash
export ZEKO_AI_AGENT_ID=research-router
```

For `credits-spend`:

```bash
export ZEKO_AI_OWNER_PUBLIC_KEY=B62...
export ZEKO_AI_CREDITS_SPEND_MINA=0.01
```

For `credits-item`:

```bash
export ZEKO_AI_CREDITS_ITEM_ID=credits-op-...
```

For `infer-live`:

```bash
export ZEKO_AI_MODEL_ID=verifiable-echo
export ZEKO_AI_PROMPT="hello from a builder"
```

For `private-infer`:

```bash
export ZEKO_AI_MODEL_ID=verifiable-echo
export ZEKO_AI_PROMPT="hello from the private lane"
```

## Why This Exists

- builders get one coordinator URL even when lanes are split across operators
- the SDK handles auth-env discovery, timeout, and retry policy
- async credits lanes can now be watched from the SDK instead of forcing builders to hand-roll queue polling
- private inference now uses the same SDK, but seals prompts locally before the coordinator stores the record
- route discovery stays explicit, so operator topology is visible without being application-coupled
- routing policy and operator freshness are exposed directly, so builders can gate on healthy lanes instead of trusting implicit coordinator behavior
