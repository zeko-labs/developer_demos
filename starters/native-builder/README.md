# Native Builder Starter

This starter uses the native Zeko-first builder surface directly.

## Commands

```bash
node starters/native-builder/index.mjs routing
node starters/native-builder/index.mjs private-infer
node starters/native-builder/index.mjs credits-fast
node starters/native-builder/index.mjs operator-audit
```

## Environment

```bash
export ZEKO_AI_COORDINATOR_URL=http://127.0.0.1:5180
export ZEKO_AI_COORDINATOR_API_KEY=...
```

For `private-infer`:

```bash
export ZEKO_AI_MODEL_ID=verifiable-echo
export ZEKO_AI_PROMPT="sealed request from the native starter"
```

For `credits-fast`:

```bash
export ZEKO_AI_OWNER_PUBLIC_KEY=B62...
export ZEKO_AI_CREDITS_SPEND_MINA=0.01
```

## Why Use This Starter

- it shows the native Zeko path directly
- it uses sealed private input envelopes instead of persisting plaintext prompts
- it uses the fast credits checkpoint path instead of making every builder manage synchronous settlement
- it exposes operator audit data so builders can inspect infra health instead of trusting a black box
