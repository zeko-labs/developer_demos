import 'reflect-metadata';
import { fetchAccount, Mina, PrivateKey, PublicKey, UInt64 } from 'o1js';
import { ShadowBookSettlementZkApp } from './contract.js';
import { loadBatchFile } from './batch-store.js';
import { hashHexToField, readOptionalEnv, requireEnv } from './utils.js';

async function main() {
  const graphql = requireEnv('ZEKO_GRAPHQL');
  const txFee = UInt64.from(readOptionalEnv('TX_FEE', '100000000'));
  const batchPath = readOptionalEnv('SETTLEMENT_BATCHES_FILE', 'data/settlement-batches.json');

  const deployerKey = PrivateKey.fromBase58(requireEnv('DEPLOYER_PRIVATE_KEY'));
  const zkappKey = PrivateKey.fromBase58(requireEnv('ZKAPP_PRIVATE_KEY'));
  const zkappAddress = PublicKey.fromBase58(requireEnv('ZKAPP_PUBLIC_KEY'));

  const batchFile = await loadBatchFile(batchPath);
  const latestCommitted = batchFile.batches
    .filter((batch) => batch.status === 'committed')
    .sort((a, b) => Number(b.batchId) - Number(a.batchId))[0];
  if (!latestCommitted) {
    throw new Error('no committed local settlement batch found to bootstrap from');
  }

  const network = Mina.Network({
    mina: graphql,
    archive: graphql
  });
  Mina.setActiveInstance(network);

  await fetchAccount({ publicKey: zkappAddress });
  const zkapp = new ShadowBookSettlementZkApp(zkappAddress);

  const currentSettlementRoot = zkapp.settlementRoot.get();
  const currentBookRoot = zkapp.bookRoot.get();
  const currentNoteRoot = zkapp.noteRoot.get();
  const currentNullifierRoot = zkapp.nullifierRoot.get();
  const currentSequencingRoot = zkapp.sequencingRoot.get();
  const currentBatch = zkapp.lastBatchId.get();

  const zero = UInt64.from(0);
  const alreadyBootstrapped =
    !currentSettlementRoot.equals(0).toBoolean() ||
    !currentBookRoot.equals(0).toBoolean() ||
    !currentNoteRoot.equals(0).toBoolean() ||
    !currentNullifierRoot.equals(0).toBoolean() ||
    !currentSequencingRoot.equals(0).toBoolean() ||
    !currentBatch.equals(zero).toBoolean();

  if (alreadyBootstrapped) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: 'zkapp already bootstrapped',
          zkappAddress: zkappAddress.toBase58(),
          current: {
            settlementRoot: currentSettlementRoot.toString(),
            bookRoot: currentBookRoot.toString(),
            noteRoot: currentNoteRoot.toString(),
            nullifierRoot: currentNullifierRoot.toString(),
            sequencingRoot: currentSequencingRoot.toString(),
            lastBatchId: currentBatch.toString()
          }
        },
        null,
        2
      )
    );
    return;
  }

  const targetRoots = {
    settlementRoot: hashHexToField(String(latestCommitted.batchHash || '')),
    bookRoot: hashHexToField(String(latestCommitted.bookRootHash || latestCommitted.batchHash || '')),
    noteRoot: hashHexToField(String(latestCommitted.noteRootHash || latestCommitted.batchHash || '')),
    nullifierRoot: hashHexToField(String(latestCommitted.nullifierRootHash || latestCommitted.batchHash || '')),
    sequencingRoot: hashHexToField(String(latestCommitted.sequencingRootHash || latestCommitted.batchHash || ''))
  };

  const tx = await Mina.transaction(
    {
      sender: deployerKey.toPublicKey(),
      fee: txFee
    },
    async () => {
      await zkapp.bootstrapState(
        targetRoots.settlementRoot,
        targetRoots.bookRoot,
        targetRoots.noteRoot,
        targetRoots.nullifierRoot,
        targetRoots.sequencingRoot
      );
    }
  );

  await tx.prove();
  tx.sign([deployerKey, zkappKey]);
  const sent = await tx.send();

  console.log(
    JSON.stringify(
      {
        ok: true,
        zkappAddress: zkappAddress.toBase58(),
        bootstrappedFromLocalBatchId: latestCommitted.batchId,
        bootstrappedFromLocalTxHash: latestCommitted.txHash || null,
        targetRoots: {
          settlementRoot: targetRoots.settlementRoot.toString(),
          bookRoot: targetRoots.bookRoot.toString(),
          noteRoot: targetRoots.noteRoot.toString(),
          nullifierRoot: targetRoots.nullifierRoot.toString(),
          sequencingRoot: targetRoots.sequencingRoot.toString()
        },
        txHash: sent.hash,
        status: sent.status
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[zkapp:bootstrap-state] failed', error);
  process.exit(1);
});
