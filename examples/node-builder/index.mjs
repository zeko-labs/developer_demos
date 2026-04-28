import {
  CoordinatorClient,
  loadCoordinatorEnv,
  resolveCoordinatorAuth,
  resolveCoordinatorBaseUrl
} from 'zeko-ai-builder-kit';

loadCoordinatorEnv();

function pickEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

async function main() {
  const action = (process.argv[2] || 'routing').trim().toLowerCase();
  const client = new CoordinatorClient({
    baseUrl: resolveCoordinatorBaseUrl(),
    auth: resolveCoordinatorAuth(),
    timeoutMs: Number(pickEnv('ZEKO_AI_COORDINATOR_TIMEOUT_MS', 'OPENGRADIENT_COORDINATOR_TIMEOUT_MS') || 15000)
  });

  if (action === 'routing') {
    console.log(JSON.stringify(await client.getRouting(), null, 2));
    return;
  }

  if (action === 'policy') {
    console.log(JSON.stringify(await client.getRoutingPolicy(), null, 2));
    return;
  }

  if (action === 'auth-me') {
    console.log(JSON.stringify(await client.getAuthMe(), null, 2));
    return;
  }

  if (action === 'membership') {
    console.log(JSON.stringify(await client.getOperatorMembership(), null, 2));
    return;
  }

  if (action === 'operator-health') {
    console.log(JSON.stringify(await client.getOperatorHealth(), null, 2));
    return;
  }

  if (action === 'operator-audit') {
    console.log(JSON.stringify(await client.getOperatorIsolationAudit(), null, 2));
    return;
  }

  if (action === 'credits-queue') {
    console.log(JSON.stringify(await client.getCreditsOperatorQueue(), null, 2));
    return;
  }

  if (action === 'credits-item') {
    const itemId = pickEnv('ZEKO_AI_CREDITS_ITEM_ID', 'OPENGRADIENT_CREDITS_ITEM_ID');
    if (!itemId) {
      throw new Error('Set ZEKO_AI_CREDITS_ITEM_ID before running credits-item.');
    }
    console.log(JSON.stringify(await client.getCreditsOperatorItem(itemId), null, 2));
    return;
  }

  if (action === 'agent-live') {
    const agentId = pickEnv('ZEKO_AI_AGENT_ID', 'OPENGRADIENT_AGENT_ID');
    if (!agentId) {
      throw new Error('Set ZEKO_AI_AGENT_ID before running agent-live.');
    }
    console.log(
      JSON.stringify(
        await client.submitAgentLive(agentId, {
          version: 'v2',
          body: { waitForSettlement: true },
          idempotencyKey: `node-builder-agent-live-${agentId}`
        }),
        null,
        2
      )
    );
    return;
  }

  if (action === 'infer-live') {
    console.log(
      JSON.stringify(
        await client.createLiveInference(
          {
            modelId: pickEnv('ZEKO_AI_MODEL_ID', 'OPENGRADIENT_MODEL_ID') || 'verifiable-echo',
            prompt: pickEnv('ZEKO_AI_PROMPT', 'OPENGRADIENT_PROMPT') || 'hello from the node builder example',
            inputs: {
              source: 'examples/node-builder',
              createdAt: new Date().toISOString()
            },
            waitForSettlement: true
          },
          {
            version: 'v2',
            idempotencyKey: `node-builder-infer-live-${Date.now()}`
          }
        ),
        null,
        2
      )
    );
    return;
  }

  if (action === 'private-infer') {
    const result = await client.createPrivateInference({
      modelId: pickEnv('ZEKO_AI_MODEL_ID', 'OPENGRADIENT_MODEL_ID') || 'verifiable-echo',
      prompt: pickEnv('ZEKO_AI_PROMPT', 'OPENGRADIENT_PROMPT') || 'hello from the private builder example',
      inputs: {
        source: 'examples/node-builder',
        mode: 'private',
        createdAt: new Date().toISOString()
      },
      clientEncryptionPublicKeyPem: pickEnv(
        'ZEKO_AI_CLIENT_ENCRYPTION_PUBLIC_KEY_PEM',
        'OPENGRADIENT_CLIENT_ENCRYPTION_PUBLIC_KEY_PEM'
      )
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (action === 'credits-spend') {
    const ownerPublicKey = pickEnv('ZEKO_AI_OWNER_PUBLIC_KEY', 'OPENGRADIENT_OWNER_PUBLIC_KEY');
    if (!ownerPublicKey) {
      throw new Error('Set ZEKO_AI_OWNER_PUBLIC_KEY before running credits-spend.');
    }
    const suffix = `${Date.now()}`;
    console.log(
      JSON.stringify(
        await client.enqueueCreditsSpend({
          ownerPublicKey,
          requestId: `node-builder-credits-${suffix}`,
          amountMina: Number(pickEnv('ZEKO_AI_CREDITS_SPEND_MINA', 'OPENGRADIENT_CREDITS_SPEND_MINA') || 0.01),
          enqueue: true,
          processNow: true,
          waitForSettlement: true,
          idempotencyKey: `node-builder-credits-${suffix}`
        }),
        null,
        2
      )
    );
    return;
  }

  if (action === 'credits-fast') {
    const ownerPublicKey = pickEnv('ZEKO_AI_OWNER_PUBLIC_KEY', 'OPENGRADIENT_OWNER_PUBLIC_KEY');
    if (!ownerPublicKey) {
      throw new Error('Set ZEKO_AI_OWNER_PUBLIC_KEY before running credits-fast.');
    }
    const suffix = `${Date.now()}`;
    console.log(
      JSON.stringify(
        await client.enqueueCreditsSpendFast({
          ownerPublicKey,
          requestId: `node-builder-credits-fast-${suffix}`,
          amountMina: Number(pickEnv('ZEKO_AI_CREDITS_SPEND_MINA', 'OPENGRADIENT_CREDITS_SPEND_MINA') || 0.01),
          enqueue: true,
          processNow: false,
          waitForSettlement: false,
          idempotencyKey: `node-builder-credits-fast-${suffix}`
        }),
        null,
        2
      )
    );
    return;
  }

  if (action === 'credits-spend-wait') {
    const ownerPublicKey = pickEnv('ZEKO_AI_OWNER_PUBLIC_KEY', 'OPENGRADIENT_OWNER_PUBLIC_KEY');
    if (!ownerPublicKey) {
      throw new Error('Set ZEKO_AI_OWNER_PUBLIC_KEY before running credits-spend-wait.');
    }
    const suffix = `${Date.now()}`;
    console.log(
      JSON.stringify(
        await client.enqueueCreditsSpendAndWait(
          {
            ownerPublicKey,
            requestId: `node-builder-credits-wait-${suffix}`,
            amountMina: Number(pickEnv('ZEKO_AI_CREDITS_SPEND_MINA', 'OPENGRADIENT_CREDITS_SPEND_MINA') || 0.01),
            enqueue: true,
            processNow: true,
            waitForSettlement: false,
            idempotencyKey: `node-builder-credits-wait-${suffix}`
          },
          {
            timeoutMs: Number(
              pickEnv('ZEKO_AI_COORDINATOR_WAIT_TIMEOUT_MS', 'OPENGRADIENT_COORDINATOR_WAIT_TIMEOUT_MS') || 120000
            ),
            pollIntervalMs: Number(
              pickEnv('ZEKO_AI_COORDINATOR_WAIT_POLL_MS', 'OPENGRADIENT_COORDINATOR_WAIT_POLL_MS') || 3000
            )
          }
        ),
        null,
        2
      )
    );
    return;
  }

  throw new Error(`Unknown action: ${action}`);
}

main().catch((error) => {
  console.error('[examples/node-builder] failed', error);
  process.exit(1);
});
