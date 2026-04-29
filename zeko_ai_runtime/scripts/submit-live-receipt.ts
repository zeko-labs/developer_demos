import 'dotenv/config';

process.env.OPENGRADIENT_NO_LISTEN = 'true';

async function main() {
  const prompt = process.argv.slice(2).join(' ').trim() || 'submit a live legacy v1 sponsor-settled receipt on zeko';
  const { ensureStore, createAndSubmitLiveInference } = await import('../src/server.js');

  await ensureStore();

  const result = await createAndSubmitLiveInference(
    {
      modelId: 'verifiable-echo',
      prompt,
      inputs: {
        mode: 'live-sponsor-submit',
        createdAt: new Date().toISOString()
      },
      settlementMode: 'SETTLE_INDIVIDUAL'
    },
    {
      waitForSettlement: true,
      waitTimeoutMs: 180_000,
      pollIntervalMs: 3000
    }
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        inferenceId: result.inference.id,
        zkappPublicKey: result.chainState?.publicKey || null,
        requestTxHash: result.liveSettlement.request?.txHash || null,
        outputTxHash: result.liveSettlement.output?.txHash || null,
        requestRootApplied: result.liveSettlement.request?.settled || false,
        outputRootApplied: result.liveSettlement.output?.settled || false,
        settled: result.liveSettlement.settled,
        settledAt: result.liveSettlement.settledAt,
        nonceAfter: result.chainState?.nonce || null
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[smoke:live:v1] failed', error);
  process.exit(1);
});
