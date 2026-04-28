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
      createCreditsSpendIntent
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

  await confirmCreditsDeposit(ownerPublicKey, depositIntent.payload.creditsRoot, `credits-spend-seed-${Date.now()}`);

  const spendIntent = await createCreditsSpendIntent({
    ownerPublicKey,
    requestId: `credits-spend-smoke-${Date.now()}`,
    amountMina: 0.01,
    spendTo: ownerPublicKey,
    platformPayee: sponsorPublicKey
  });

  const submission = await runtime.submitCreditsTxWithSponsorV2(spendIntent.payload);
  const creditsState = await runtime.waitForZkappStateValueV2(3, spendIntent.payload.creditsRoot, {
    attempts: 60,
    pollIntervalMs: 3000
  });
  if (!creditsState) {
    throw new Error('Credits spend root did not settle on the v2 zkApp.');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        ownerPublicKey,
        spendTo: spendIntent.payload.spendTo,
        platformPayee: spendIntent.payload.platformPayee,
        spendAmountMina: spendIntent.payload.spendAmountMina,
        platformAmountMina: spendIntent.payload.platformAmountMina,
        txHash: submission.hash,
        creditsRootTarget: spendIntent.payload.creditsRoot,
        creditsRootObserved: creditsState.zkappState[3] || null,
        nullifierRootTarget: spendIntent.payload.nullifierRoot,
        nullifierRootObserved: creditsState.zkappState[4] || null,
        settled:
          creditsState.zkappState[3] === spendIntent.payload.creditsRoot &&
          creditsState.zkappState[4] === spendIntent.payload.nullifierRoot,
        zkappPublicKey: creditsState.publicKey
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[smoke:credits-spend] failed', error);
  process.exit(1);
});
