import 'dotenv/config';
import path from 'node:path';
import { readFileSync } from 'node:fs';

process.env.OPENGRADIENT_NO_LISTEN = 'true';

async function main() {
  const [
    {
      ensureStore,
      createCreditsDepositIntent,
      confirmCreditsDeposit,
      createCreditsSpendIntent,
      enqueueCreditsOperatorItem,
      processCreditsCheckpointBatches,
      getCreditsCheckpointBatchSnapshot
    },
    runtime
  ] = await Promise.all([import('../src/server.js'), import('../src/zeko-runtime-v2.js')]);

  await ensureStore();

  const deploymentRecordPath = path.join(process.cwd(), 'data', 'deployments', 'agent-request-v2.latest.json');
  const deploymentRecord = JSON.parse(readFileSync(deploymentRecordPath, 'utf8')) as {
    deployerPublicKey?: string;
  };
  const ownerPublicKey = String(deploymentRecord.deployerPublicKey || '').trim();
  if (!ownerPublicKey) {
    throw new Error('Missing deployerPublicKey in v2 deployment metadata.');
  }

  const depositIntent = await createCreditsDepositIntent({
    ownerPublicKey,
    amountMina: 0.2
  });
  await confirmCreditsDeposit(ownerPublicKey, depositIntent.payload.creditsRoot, `credits-checkpoint-seed-${Date.now()}`);

  const requestId1 = `credits-checkpoint-1-${Date.now()}`;
  const spend1 = await createCreditsSpendIntent({
    ownerPublicKey,
    requestId: requestId1,
    amountMina: 0.01,
    settlementStrategy: 'checkpoint'
  });
  const requestId2 = `credits-checkpoint-2-${Date.now()}`;
  const spend2 = await createCreditsSpendIntent({
    ownerPublicKey,
    requestId: requestId2,
    amountMina: 0.02,
    settlementStrategy: 'checkpoint'
  });

  await enqueueCreditsOperatorItem({
    payload: spend1.payloadV2,
    source: 'spend-intent',
    settlementStrategy: 'checkpoint',
    kind: 'credits-spend',
    ownerPublicKey,
    requestId: requestId1
  });
  await enqueueCreditsOperatorItem({
    payload: spend2.payloadV2,
    source: 'spend-intent',
    settlementStrategy: 'checkpoint',
    kind: 'credits-spend',
    ownerPublicKey,
    requestId: requestId2
  });

  const result = await processCreditsCheckpointBatches({
    waitForSettlement: true,
    waitTimeoutMs: 180_000,
    pollIntervalMs: 3000,
    maxBatchSize: 10
  });
  if (!result.batch) {
    throw new Error('Expected a checkpoint batch to be created.');
  }
  const chainState = await runtime.fetchZkappAccountStateV2();
  const batches = await getCreditsCheckpointBatchSnapshot();

  console.log(
    JSON.stringify(
      {
        ok: result.batch.status === 'settled',
        batchId: result.batch.id,
        txHash: result.batch.txHash,
        itemCount: result.batch.itemCount,
        finalCreditsRoot: result.batch.finalCreditsRoot,
        observedCreditsRoot: chainState.zkappState[3] || null,
        finalNullifierRoot: result.batch.finalNullifierRoot,
        observedNullifierRoot: chainState.zkappState[4] || null,
        summary: batches.summary
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[smoke:credits:checkpoint-batch] failed', error);
  process.exit(1);
});
