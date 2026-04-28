import 'dotenv/config';

import { CoordinatorClient, loadCoordinatorEnv, resolveCoordinatorAuth, resolveCoordinatorBaseUrl } from '../src/sdk/index.js';

loadCoordinatorEnv({
  envFile: process.env.OPENGRADIENT_CREDITS_FAST_ENV_FILE || 'data/opengradient/http-auth/coordinator.local.env',
  includeBuilderFallback: false
});

async function main() {
  const baseUrl = resolveCoordinatorBaseUrl();
  const client = new CoordinatorClient({
    baseUrl,
    auth: resolveCoordinatorAuth(),
    timeoutMs: Number(process.env.OPENGRADIENT_COORDINATOR_TIMEOUT_MS || 15_000)
  });

  const ownerPublicKey =
    process.env.OPENGRADIENT_OWNER_PUBLIC_KEY ||
    'B62qprivateLaneFastCreditsOwner1111111111111111111111111111111111111111';
  const depositIntent = await client.requestJson<any>('/api/credits/deposit-intent', {
    method: 'POST',
    body: {
      ownerPublicKey,
      amountMina: Number(process.env.OPENGRADIENT_CREDITS_FAST_DEPOSIT_MINA || 0.11)
    }
  });

  await client.requestJson<any>('/api/credits/confirm', {
    method: 'POST',
    body: {
      ownerPublicKey,
      creditsRoot: depositIntent.payload.creditsRoot,
      txHash: `credits-fast-seed-${Date.now()}`
    }
  });

  const suffix = `${Date.now()}`;
  const response = await client.enqueueCreditsSpendFast<any>({
    ownerPublicKey,
    requestId: `credits-fast-${suffix}`,
    amountMina: Number(process.env.OPENGRADIENT_CREDITS_FAST_SPEND_MINA || 0.01),
    enqueue: true,
    processNow: false,
    waitForSettlement: false,
    idempotencyKey: `credits-fast-${suffix}`
  });

  if (response.settlementStrategy !== 'checkpoint') {
    throw new Error(`Expected checkpoint settlement strategy, received ${response.settlementStrategy}`);
  }
  if (!response.fastPath) {
    throw new Error('Expected fastPath flag on response.');
  }
  if (!response.operator?.item?.id) {
    throw new Error('Expected operator queue item for fast credits path.');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        ownerPublicKey,
        response
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[smoke:credits:fast] failed', error);
  process.exit(1);
});
