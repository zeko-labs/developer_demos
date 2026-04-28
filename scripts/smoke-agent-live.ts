import 'dotenv/config';

process.env.OPENGRADIENT_NO_LISTEN = 'true';

async function main() {
  const [{ ensureStore, createAgentRegistration, submitLiveAgentRegistration }, runtime] = await Promise.all([
    import('../src/server.js'),
    import('../src/zeko-runtime-v2.js')
  ]);

  await ensureStore();
  const config = runtime.getZekoRuntimeConfigV2();
  if (!config.hasSponsorPrivateKey) {
    throw new Error('Sponsor mode is not enabled.');
  }

  const agent = await createAgentRegistration({
    id: `agent-${Date.now()}`,
    name: 'Live Registered Agent',
    description: 'Smoke test for sponsor-backed live agent registry settlement on Zeko v2.',
    ownerPublicKey: config.zkappPublicKey || 'B62qkzQxCwJvsEv8wHBWeex8oGA7R1QuNJfMqaRMBs1VY8BJQEcnd9x',
    treasuryPublicKey: config.zkappPublicKey || 'B62qkzQxCwJvsEv8wHBWeex8oGA7R1QuNJfMqaRMBs1VY8BJQEcnd9x',
    stakeAmountMina: 0,
    capabilities: ['registry', 'settlement']
  });

  const result = await submitLiveAgentRegistration(agent.id, {
    waitForSettlement: true,
    waitTimeoutMs: 180_000,
    pollIntervalMs: 3000
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        agentId: result.agent.id,
        zkappPublicKey: result.chainState?.publicKey || null,
        txHash: result.liveSettlement.txHash,
        settled: result.liveSettlement.settled,
        settledAt: result.liveSettlement.settledAt,
        targetRoot: result.liveSettlement.targetRoot,
        observedRoot: result.liveSettlement.observedRoot
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[smoke:agent-live] failed', error);
  process.exit(1);
});
