# Builder Migration Guide

This guide is the shortest path from a prototype or legacy AI protocol integration to the released `zeko-ai-builder-kit` package surface built on top of the Zeko AI Runtime.

`zeko-ai-builder-kit` is an independent package. It keeps compatibility where useful, but the core coordinator, settlement, routing, privacy, and credits logic are implemented here.

## Install

```bash
npm install zeko-ai-builder-kit
```

Minimum runtime:

- Node.js `20+`

## Choose A Surface

Use the native surface when you want the full Zeko-first path:

```ts
import { CoordinatorClient, loadCoordinatorEnv, resolveCoordinatorAuth, resolveCoordinatorBaseUrl } from 'zeko-ai-builder-kit';

loadCoordinatorEnv();

const client = new CoordinatorClient({
  baseUrl: resolveCoordinatorBaseUrl(),
  auth: resolveCoordinatorAuth()
});

const routing = await client.getRoutingSnapshot();
const privateLane = await client.getPrivateLaneConfig();
```

Use the compatibility surface when you want a legacy-compatible edge while keeping Zeko-native settlement underneath:

```ts
import { createCompatClient } from 'zeko-ai-builder-kit/compat';
import { loadCoordinatorEnv, resolveCoordinatorAuth, resolveCoordinatorBaseUrl } from 'zeko-ai-builder-kit';

loadCoordinatorEnv();

const client = createCompatClient({
  baseUrl: resolveCoordinatorBaseUrl(),
  auth: resolveCoordinatorAuth()
});

const inference = await client.createInference({
  model: 'verifiable-echo',
  prompt: 'compat request',
  waitForSettlement: true
});
```

Use the crypto helpers when you want local sealing before submission:

```ts
import { encryptJsonEnvelope, generateX25519Keypair, getEnvelopeContext } from 'zeko-ai-builder-kit/crypto';
```

## Environment Contract

The released package expects the same coordinator contract the repo already uses:

- `ZEKO_AI_COORDINATOR_URL`
- `ZEKO_AI_COORDINATOR_API_KEY` or `ZEKO_AI_COORDINATOR_BEARER_TOKEN`
- optionally `ZEKO_AI_COORDINATOR_ENV_FILE`

`loadCoordinatorEnv()` will also auto-discover generated local auth snippets when you run from a repo or operator workspace that already contains `data/opengradient/http-auth/`.

## What Changes From OpenGradient-Style Integrations

- keep the familiar request surface if you want it
- move settlement, routing, privacy, and credits into the Zeko-native coordinator
- use status tokens, callbacks, and operator routing instead of implicit black-box coordinator state
- use the private lane for sealed prompts instead of persisting plaintext request bodies

## What Stays Stable

These are the package entrypoints intended to stay stable for builders:

- `zeko-ai-builder-kit`
- `zeko-ai-builder-kit/sdk`
- `zeko-ai-builder-kit/compat`
- `zeko-ai-builder-kit/crypto`

The current settlement backend uses the Zeko testnet path. The package boundary is meant to stay stable when receipts later move from direct Zeko testnet settlement to Zeko proofs settling onward to Ethereum.
