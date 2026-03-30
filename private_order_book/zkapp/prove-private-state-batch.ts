import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPendingPrivateStateProofInputs } from './private-state-artifacts.js';
import {
  PrivateStateTransitionProgram,
  compilePrivateStateTransitionProgram
} from './private-state-prover.js';
import { readOptionalEnv } from './utils.js';

async function main() {
  const artifacts = await buildPendingPrivateStateProofInputs();
  if (!artifacts) {
    console.log(JSON.stringify({ ok: true, message: 'no pending batches' }, null, 2));
    return;
  }

  const { pending, prevRoots, nextRoots, witness, publicInput, batchWitness } = artifacts;
  console.log(`[zkapp:prove-private-state-batch] preparing proof for batch ${pending.batchId}...`);
  const outputDir = readOptionalEnv(
    'PRIVATE_STATE_PROOFS_DIR',
    path.resolve(process.cwd(), 'data', 'private-state-proofs')
  );
  await mkdir(outputDir, { recursive: true });

  console.log(`[zkapp:prove-private-state-batch] compiling private-state program for batch ${pending.batchId}...`);
  const verificationKey = await compilePrivateStateTransitionProgram();
  console.log(`[zkapp:prove-private-state-batch] proving batch ${pending.batchId}...`);
  const result = await PrivateStateTransitionProgram.proveBatch(publicInput, batchWitness);
  const proofJson = result.proof.toJSON();
  const proofPath = path.resolve(outputDir, `batch-${pending.batchId}.json`);
  await writeFile(
    proofPath,
    JSON.stringify(
      {
        batchId: pending.batchId,
        batchHash: pending.batchHash,
        expectedPrivateStateTransitionHash: (pending as any).privateStateTransitionHash || null,
        witnessTransitionHash: witness.transitionHash().toString(),
        verificationKeyHash: verificationKey.hash.toString(),
        publicInput: {
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
          transitionHash: publicInput.transitionHash.toString(),
          batchHash: publicInput.batchHash.toString()
        },
        publicOutput: {
          appliedSpendCount: batchWitness.appliedSpendCount.toString(),
          appliedOutputCount: batchWitness.appliedOutputCount.toString(),
          nextRoots: {
            noteRoot: batchWitness.nextRoots.noteRoot.toString(),
            nullifierRoot: batchWitness.nextRoots.nullifierRoot.toString(),
            settlementRoot: batchWitness.nextRoots.settlementRoot.toString()
          }
        },
        proof: proofJson
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        batchId: pending.batchId,
        batchHash: pending.batchHash,
        expectedPrivateStateTransitionHash: (pending as any).privateStateTransitionHash || null,
        witnessTransitionHash: witness.transitionHash().toString(),
        proofPath
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[zkapp:prove-private-state-batch] failed', error);
  process.exit(1);
});
