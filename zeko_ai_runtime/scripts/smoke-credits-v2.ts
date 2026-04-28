import 'dotenv/config';
import path from 'node:path';
import { readFileSync } from 'node:fs';

process.env.OPENGRADIENT_NO_LISTEN = 'true';

async function main() {
  const [
    {
      ensureStore,
      createCreditsDepositIntent
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
    amountMina: 0.1
  });

  const sponsorPayload = {
    ...depositIntent.payload,
    depositMina: 0
  };

  const submission = await runtime.submitCreditsTxWithSponsorV2(sponsorPayload);
  const creditsState = await runtime.waitForZkappStateValueV2(3, sponsorPayload.creditsRoot, {
    attempts: 60,
    pollIntervalMs: 3000
  });
  if (!creditsState) {
    throw new Error('Credits root did not settle on the v2 zkApp.');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        ownerPublicKey,
        txHash: submission.hash,
        creditsRootTarget: sponsorPayload.creditsRoot,
        creditsRootObserved: creditsState.zkappState[3] || null,
        nullifierRootTarget: sponsorPayload.nullifierRoot,
        nullifierRootObserved: creditsState.zkappState[4] || null,
        settled:
          creditsState.zkappState[3] === sponsorPayload.creditsRoot &&
          creditsState.zkappState[4] === sponsorPayload.nullifierRoot,
        zkappPublicKey: creditsState.publicKey
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[smoke:credits] failed', error);
  process.exit(1);
});
