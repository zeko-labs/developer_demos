import 'dotenv/config';

process.env.OPENGRADIENT_NO_LISTEN = 'true';

async function main() {
  const prompt = process.argv.slice(2).join(' ').trim() || 'submit a live threshold-settled v2 receipt on zeko';
  const { ensureStore, createAndSubmitLiveInferenceV2 } = await import('../src/server.js');

  await ensureStore();

  const result = await createAndSubmitLiveInferenceV2(
    {
      modelId: 'verifiable-echo',
      prompt,
      inputs: {
        mode: 'live-threshold-v2-submit',
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
        requestTxHash: result.liveSettlementV2.request?.txHash || null,
        outputTxHash: result.liveSettlementV2.output?.txHash || null,
        requestRootApplied: result.liveSettlementV2.request?.settled || false,
        outputRootApplied: result.liveSettlementV2.output?.settled || false,
        settled: result.liveSettlementV2.settled,
        settledAt: result.liveSettlementV2.settledAt,
        nonceAfter: result.chainState?.nonce || null
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[smoke:live:v2] failed', error);
  process.exit(1);
});
