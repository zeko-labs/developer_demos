import 'dotenv/config';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { PrivateKey } from 'o1js';

process.env.OPENGRADIENT_NO_LISTEN = 'true';

function readBase58(pathname: string) {
  return readFileSync(pathname, 'utf8').trim();
}

async function main() {
  const [
    {
      ensureStore,
      createCreditsDepositIntent,
      confirmCreditsDeposit,
      createCreditsSpendIntent,
      enqueueCreditsOperatorItem,
      processCreditsOperatorItem,
      getCreditsOperatorQueueSnapshot
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

  const sponsorKeyPath = path.join(process.cwd(), 'data', 'deployments', 'sponsor-private-key.txt');
  const sponsorPublicKey = PrivateKey.fromBase58(readBase58(sponsorKeyPath)).toPublicKey().toBase58();

  const depositIntent = await createCreditsDepositIntent({
    ownerPublicKey,
    amountMina: 0.1
  });
  await confirmCreditsDeposit(ownerPublicKey, depositIntent.payload.creditsRoot, `credits-operator-seed-${Date.now()}`);

  const requestId = `credits-operator-smoke-${Date.now()}`;
  const spendIntent = await createCreditsSpendIntent({
    ownerPublicKey,
    requestId,
    amountMina: 0.01,
    spendTo: ownerPublicKey,
    platformPayee: sponsorPublicKey
  });

  const enqueued = await enqueueCreditsOperatorItem({
    payload: spendIntent.payloadV2,
    source: 'spend-intent',
    ownerPublicKey,
    requestId
  });
  const processed = await processCreditsOperatorItem(enqueued.item.id, {
    waitForSettlement: true,
    waitTimeoutMs: 180_000,
    pollIntervalMs: 3000
  });
  const queue = await getCreditsOperatorQueueSnapshot();
  const chainState = await runtime.fetchZkappAccountStateV2();

  console.log(
    JSON.stringify(
      {
        ok: processed.status === 'settled',
        ownerPublicKey,
        requestId,
        queueItemId: processed.id,
        txHash: processed.txHash,
        status: processed.status,
        creditsRootTarget: spendIntent.payload.creditsRoot,
        creditsRootObserved: chainState.zkappState[3] || null,
        nullifierRootTarget: spendIntent.payload.nullifierRoot,
        nullifierRootObserved: chainState.zkappState[4] || null,
        queueSummary: queue.summary
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[smoke:credits:operator] failed', error);
  process.exit(1);
});
