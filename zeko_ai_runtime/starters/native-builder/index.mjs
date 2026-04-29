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

  if (action === 'private-infer') {
    console.log(
      JSON.stringify(
        await client.createPrivateInference({
          modelId: pickEnv('ZEKO_AI_MODEL_ID', 'OPENGRADIENT_MODEL_ID') || 'verifiable-echo',
          prompt: pickEnv('ZEKO_AI_PROMPT', 'OPENGRADIENT_PROMPT') || 'starter private request',
          inputs: {
            starter: 'native-builder',
            createdAt: new Date().toISOString()
          }
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
          requestId: `native-builder-fast-${suffix}`,
          amountMina: Number(pickEnv('ZEKO_AI_CREDITS_SPEND_MINA', 'OPENGRADIENT_CREDITS_SPEND_MINA') || 0.01),
          enqueue: true,
          processNow: false,
          waitForSettlement: false,
          idempotencyKey: `native-builder-fast-${suffix}`
        }),
        null,
        2
      )
    );
    return;
  }

  if (action === 'operator-audit') {
    console.log(JSON.stringify(await client.getOperatorIsolationAudit(), null, 2));
    return;
  }

  throw new Error(`Unknown action: ${action}`);
}

main().catch((error) => {
  console.error('[starters/native-builder] failed', error);
  process.exit(1);
});
