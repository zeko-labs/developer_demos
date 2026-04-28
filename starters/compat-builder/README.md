# Compatibility Builder Starter

This starter keeps a familiar legacy-protocol surface at the edge while routing settlement through the Zeko-native coordinator.

## Commands

```bash
node starters/compat-builder/index.mjs models
node starters/compat-builder/index.mjs infer
node starters/compat-builder/index.mjs chat
node starters/compat-builder/index.mjs status
```

## Environment

```bash
export ZEKO_AI_COORDINATOR_URL=http://127.0.0.1:5180
export ZEKO_AI_COORDINATOR_API_KEY=...
export ZEKO_AI_MODEL_ID=verifiable-echo
export ZEKO_AI_PROMPT="compat surface request"
```

For `status`:

```bash
export ZEKO_AI_INFERENCE_ID=inf_...
```

## Why Use This Starter

- it is the migration path for teams that want familiar request shapes
- it lets the UI and API feel familiar without making any external SDK or backend the trust boundary
- it is the right place to keep compatibility while the infra core stays fully Zeko-native
