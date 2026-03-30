import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchAccount,
  Mina,
  PrivateKey,
  PublicKey,
  UInt64
} from 'o1js';
import { ShadowBookSettlementZkApp } from './contract.js';
import { ShadowBookSettlementAdvancedZkApp } from './advanced-contract.js';
import { getNextPending, loadBatchFile, saveBatchFile } from './batch-store.js';
import { buildPendingPrivateStateProofInputs } from './private-state-artifacts.js';
import {
  PrivateStateTransitionProgram,
  PrivateStateTransitionProof,
  compilePrivateStateTransitionProgram
} from './private-state-prover.js';
import { hashHexToField, readOptionalEnv, requireEnv } from './utils.js';

let leanCompilePromise: Promise<void> | null = null;
let advancedCompilePromise: Promise<void> | null = null;

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value || !value.trim()) return fallback;
  return value.trim().toLowerCase() === 'true';
}

async function loadCachedProofArtifact(
  pending: { batchId: number; batchHash: string },
  proofInputs: Awaited<ReturnType<typeof buildPendingPrivateStateProofInputs>>
) {
  const proofsDir = readOptionalEnv(
    'PRIVATE_STATE_PROOFS_DIR',
    path.resolve(process.cwd(), 'data', 'private-state-proofs')
  );
  const proofPath = path.resolve(proofsDir, `batch-${pending.batchId}.json`);
  if (!existsSync(proofPath)) return null;

  const raw = JSON.parse(await readFile(proofPath, 'utf8'));
  if (Number(raw.batchId) !== pending.batchId) {
    throw new Error(`cached proof batch mismatch for batch ${pending.batchId}`);
  }
  if (String(raw.batchHash || '') !== String(pending.batchHash || '')) {
    throw new Error(`cached proof batch hash mismatch for batch ${pending.batchId}`);
  }
  if (!proofInputs) {
    throw new Error(`proof inputs unavailable while validating cached proof for batch ${pending.batchId}`);
  }

  const expectedPrev = {
    noteRoot: proofInputs.prevRoots.noteRoot.toString(),
    nullifierRoot: proofInputs.prevRoots.nullifierRoot.toString(),
    settlementRoot: proofInputs.prevRoots.settlementRoot.toString()
  };
  const expectedNext = {
    noteRoot: proofInputs.nextRoots.noteRoot.toString(),
    nullifierRoot: proofInputs.nextRoots.nullifierRoot.toString(),
    settlementRoot: proofInputs.nextRoots.settlementRoot.toString()
  };
  const cachedPrev = raw.publicInput?.prevRoots || {};
  const cachedNext = raw.publicInput?.nextRoots || {};
  if (
    String(cachedPrev.noteRoot || '') !== expectedPrev.noteRoot ||
    String(cachedPrev.nullifierRoot || '') !== expectedPrev.nullifierRoot ||
    String(cachedPrev.settlementRoot || '') !== expectedPrev.settlementRoot
  ) {
    throw new Error(`cached proof prev roots mismatch for batch ${pending.batchId}`);
  }
  if (
    String(cachedNext.noteRoot || '') !== expectedNext.noteRoot ||
    String(cachedNext.nullifierRoot || '') !== expectedNext.nullifierRoot ||
    String(cachedNext.settlementRoot || '') !== expectedNext.settlementRoot
  ) {
    throw new Error(`cached proof next roots mismatch for batch ${pending.batchId}`);
  }
  if (String(raw.publicInput?.transitionHash || '') !== proofInputs.transitionHash.toString()) {
    throw new Error(`cached proof transition hash mismatch for batch ${pending.batchId}`);
  }
  return {
    proofPath,
    proof: await PrivateStateTransitionProof.fromJSON(raw.proof)
  };
}

async function ensureCompiled(batchId: number, usePrivateStateProof: boolean) {
  if (usePrivateStateProof) {
    if (!advancedCompilePromise) {
      advancedCompilePromise = (async () => {
        console.log(`[zkapp:commit-next-batch] compiling advanced settlement contract before batch ${batchId}...`);
        await compilePrivateStateTransitionProgram();
        await ShadowBookSettlementAdvancedZkApp.compile();
      })();
    }
    await advancedCompilePromise;
    return;
  }

  if (!leanCompilePromise) {
    leanCompilePromise = (async () => {
      console.log(`[zkapp:commit-next-batch] compiling lean settlement contract before batch ${batchId}...`);
      await ShadowBookSettlementZkApp.compile();
    })();
  }
  await leanCompilePromise;
}

export async function commitNextPendingBatch() {
  const graphql = requireEnv('ZEKO_GRAPHQL');
  const txFee = UInt64.from(readOptionalEnv('TX_FEE', '100000000'));
  const usePrivateStateProof = parseBoolEnv('ZKAPP_COMMIT_USE_PROOF', false);
  const requireCachedProof = parseBoolEnv('REQUIRE_CACHED_PRIVATE_STATE_PROOF', false);
  const allowInlineProving = parseBoolEnv('ALLOW_INLINE_PRIVATE_STATE_PROVING', !requireCachedProof);
  const batchPath = readOptionalEnv(
    'SETTLEMENT_BATCHES_FILE',
    path.resolve(process.cwd(), 'data', 'settlement-batches.json')
  );

  const deployerKey = PrivateKey.fromBase58(requireEnv('DEPLOYER_PRIVATE_KEY'));
  const zkappKey = PrivateKey.fromBase58(requireEnv('ZKAPP_PRIVATE_KEY'));
  const zkappAddress = PublicKey.fromBase58(requireEnv('ZKAPP_PUBLIC_KEY'));

  const batchFile = await loadBatchFile(batchPath);
  const pending = getNextPending(batchFile);
  if (!pending) {
    console.log(JSON.stringify({ ok: true, message: 'no pending batches' }, null, 2));
    return;
  }

  const batchHash = hashHexToField(pending.batchHash);
  const bookRoot = hashHexToField(String(pending.bookRootHash || pending.batchHash));
  const sequencingRoot = hashHexToField(String(pending.sequencingRootHash || pending.batchHash));

  const network = Mina.Network({
    mina: graphql,
    archive: graphql
  });
  Mina.setActiveInstance(network);

  await fetchAccount({ publicKey: zkappAddress });
  const leanZkapp = !usePrivateStateProof ? new ShadowBookSettlementZkApp(zkappAddress) : null;
  const advancedZkapp = usePrivateStateProof ? new ShadowBookSettlementAdvancedZkApp(zkappAddress) : null;
  const zkapp = advancedZkapp ?? leanZkapp;
  if (!zkapp) {
    throw new Error('failed to initialize settlement zkapp');
  }
  const currentSettlementRoot = zkapp.settlementRoot.get();
  const currentOnchainBatchId = zkapp.lastBatchId.get();
  const nextOnchainBatchId = currentOnchainBatchId.add(UInt64.from(1));
  const currentNoteRoot = zkapp.noteRoot.get();
  const currentNullifierRoot = zkapp.nullifierRoot.get();
  const noteRoot = hashHexToField(String(pending.noteRootHash || pending.batchHash));
  const nullifierRoot = hashHexToField(String(pending.nullifierRootHash || pending.batchHash));

  await ensureCompiled(pending.batchId, usePrivateStateProof);

  let proof: PrivateStateTransitionProof | null = null;
  let proofSource: string | null = null;
  let proofTransitionHash: string | null = null;
  if (usePrivateStateProof) {
    await compilePrivateStateTransitionProgram();
    const proofInputs = await buildPendingPrivateStateProofInputs({
      prevRoots: {
        noteRoot: currentNoteRoot,
        nullifierRoot: currentNullifierRoot,
        settlementRoot: currentSettlementRoot
      }
    });
    if (!proofInputs || proofInputs.pending.batchId !== pending.batchId) {
      throw new Error(`private-state proof inputs unavailable for pending batch ${pending.batchId}`);
    }

    const cached = await loadCachedProofArtifact(pending, proofInputs);
    proofSource = 'cached';
    if (cached) {
      console.log(`[zkapp:commit-next-batch] using cached private-state proof ${cached.proofPath} for batch ${pending.batchId}`);
      proof = cached.proof;
    } else {
      if (requireCachedProof && !allowInlineProving) {
        throw new Error(`cached private-state proof is required for batch ${pending.batchId}`);
      }
      if (!allowInlineProving) {
        throw new Error(`inline private-state proving is disabled for batch ${pending.batchId}`);
      }
      proofSource = 'inline';
      console.log(`[zkapp:commit-next-batch] proving private-state transition inline for batch ${pending.batchId}...`);
      const proofResult = await PrivateStateTransitionProgram.proveBatch(proofInputs.publicInput, proofInputs.batchWitness);
      proof = proofResult.proof;
    }

    proof.publicInput.batchHash.assertEquals(batchHash);
    proof.publicInput.prevRoots.noteRoot.assertEquals(currentNoteRoot);
    proof.publicInput.prevRoots.nullifierRoot.assertEquals(currentNullifierRoot);
    proof.publicOutput.nextRoots.noteRoot.assertEquals(proofInputs.nextRoots.noteRoot);
    proof.publicOutput.nextRoots.nullifierRoot.assertEquals(proofInputs.nextRoots.nullifierRoot);
    proof.publicInput.transitionHash.assertEquals(proofInputs.transitionHash);
    proofTransitionHash = proof.publicInput.transitionHash.toString();
  }

  const tx = await Mina.transaction(
    {
      sender: deployerKey.toPublicKey(),
      fee: txFee
    },
    async () => {
      if (advancedZkapp && proof) {
        await advancedZkapp.commitBatchWithProof(
          nextOnchainBatchId,
          batchHash,
          bookRoot,
          noteRoot,
          nullifierRoot,
          sequencingRoot,
          proof
        );
      } else if (leanZkapp) {
        await leanZkapp.commitBatch(
          nextOnchainBatchId,
          batchHash,
          bookRoot,
          noteRoot,
          nullifierRoot,
          sequencingRoot
        );
      } else {
        throw new Error(`missing settlement zkapp instance for batch ${pending.batchId}`);
      }
    }
  );

  await tx.prove();
  tx.sign([deployerKey, zkappKey]);
  const sent = await tx.send();

  const target = batchFile.batches.find((batch) => batch.batchId === pending.batchId);
  if (target) {
    target.status = 'committed';
    target.committedAtUnixMs = Date.now();
    target.txHash = sent.hash ?? null;
  }
  await saveBatchFile(batchPath, batchFile);

  return {
    ok: true,
    localBatchId: pending.batchId,
    onchainBatchId: nextOnchainBatchId.toString(),
    batchHash: pending.batchHash,
    bookRootHash: pending.bookRootHash || null,
    noteRootHash: noteRoot.toString(),
    nullifierRootHash: nullifierRoot.toString(),
    sequencingRootHash: pending.sequencingRootHash || null,
    privateStateTransitionHash: pending.privateStateTransitionHash || null,
    proofTransitionHash,
    proofSource,
    commitMode: usePrivateStateProof ? 'verified-private-state' : 'lean-anchor',
    txHash: sent.hash,
    status: sent.status
  };
}

async function main() {
  const result = await commitNextPendingBatch();
  console.log(JSON.stringify(result, null, 2));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    console.error('[zkapp:commit-next-batch] failed', error);
    process.exit(1);
  });
}
