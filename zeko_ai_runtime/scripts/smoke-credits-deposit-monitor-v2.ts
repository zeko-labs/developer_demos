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
      enqueueCreditsDepositMonitor,
      processCreditsDepositMonitorItem,
      getCreditsDepositMonitorSnapshot
    },
    runtime
  ] = await Promise.all([import('../src/server.js'), import('../src/zeko-runtime-v2.js')]);

  await ensureStore();

  const sponsorKeyPath = path.join(process.cwd(), 'data', 'deployments', 'sponsor-private-key.txt');
  const feePayerKey = PrivateKey.fromBase58(readBase58(sponsorKeyPath));
  const ownerPublicKey = feePayerKey.toPublicKey().toBase58();

  const depositIntent = await createCreditsDepositIntent({
    ownerPublicKey,
    amountMina: 0.1
  });
  const submission = await runtime.submitCreditsTxWithPrivateKeyV2(depositIntent.payloadV2, feePayerKey.toBase58());
  const txHash = submission.hash;
  if (!txHash) {
    throw new Error('Deposit smoke transaction did not return a hash.');
  }

  const enqueued = await enqueueCreditsDepositMonitor({
    ownerPublicKey,
    creditsRoot: depositIntent.payloadV2.creditsRoot,
    txHash
  });
  const processed = await processCreditsDepositMonitorItem(enqueued.item.id, {
    waitForSettlement: true,
    waitTimeoutMs: 180_000,
    pollIntervalMs: 3000
  });
  const monitors = await getCreditsDepositMonitorSnapshot();
  const ledger = JSON.parse(
    readFileSync(path.join(process.cwd(), 'data', 'opengradient', 'credits-ledger.json'), 'utf8')
  ) as {
    balances: Record<string, number>;
  };

  console.log(
    JSON.stringify(
      {
        ok: processed.status === 'confirmed',
        ownerPublicKey,
        txHash,
        monitorId: processed.id,
        status: processed.status,
        creditsRootTarget: depositIntent.payloadV2.creditsRoot,
        nullifierRootTarget: depositIntent.payloadV2.nullifierRoot,
        balanceMina: ledger.balances[ownerPublicKey] || 0,
        summary: monitors.summary
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[smoke:credits:deposit-monitor] failed', error);
  process.exit(1);
});
