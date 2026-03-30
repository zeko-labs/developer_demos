import { buildPendingPrivateStateArtifacts } from './private-state-artifacts.js';

async function main() {
  const artifacts = await buildPendingPrivateStateArtifacts();
  if (!artifacts) {
    console.log(JSON.stringify({ ok: true, message: 'no pending batches' }, null, 2));
    return;
  }
  const { pending, spends, outputs, prevRoots, nextRoots, transitionHash } = artifacts;

  console.log(
    JSON.stringify(
      {
        ok: true,
        batchId: (pending as any).batchId,
        batchHash: (pending as any).batchHash,
        prevRoots: {
          noteRoot: prevRoots.noteRoot.toString(),
          nullifierRoot: prevRoots.nullifierRoot.toString(),
          settlementRoot: prevRoots.settlementRoot.toString()
        },
        nextRoots: {
          noteRoot: nextRoots.noteRoot.toString(),
          nullifierRoot: nextRoots.nullifierRoot.toString(),
          settlementRoot: nextRoots.settlementRoot.toString()
        },
        sequencingRootHash: (pending as any).sequencingRootHash || null,
        expectedPrivateStateTransitionHash: (pending as any).privateStateTransitionHash || null,
        spendCount: spends.length,
        outputCount: outputs.length,
        transitionHash: transitionHash.toString()
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[zkapp:build-private-state-witness] failed', error);
  process.exit(1);
});
