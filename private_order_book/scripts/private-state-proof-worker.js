import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API_BASE = (process.env.DARKPOOL_API || 'http://127.0.0.1:8791').replace(/\/$/, '');
const INTERVAL_MS = Number.parseInt(process.env.PRIVATE_STATE_PROOF_INTERVAL_MS || '4000', 10);
const PRIVATE_STATE_PROOFS_DIR = String(
  process.env.PRIVATE_STATE_PROOFS_DIR || path.resolve(process.cwd(), 'data', 'private-state-proofs')
).trim();

let compiled = null;

async function request(pathname, options = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method: options.method || 'GET',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `request failed: ${pathname}`);
  return json;
}

async function getNextPending() {
  const data = await request('/api/darkpool/settlement/batches?limit=500');
  const pending = (data.batches || [])
    .filter((b) => b.status === 'pending')
    .sort((a, b) => Number(a.batchId) - Number(b.batchId));
  return pending[0] || null;
}

function proofArtifactPath(batchId) {
  return path.resolve(PRIVATE_STATE_PROOFS_DIR, `batch-${batchId}.json`);
}

async function loadProofModules() {
  const artifactsModule = await import(path.resolve(process.cwd(), 'dist-zkapp/private-state-artifacts.js'));
  const proverModule = await import(path.resolve(process.cwd(), 'dist-zkapp/private-state-prover.js'));
  return {
    buildPendingPrivateStateProofInputs: artifactsModule.buildPendingPrivateStateProofInputs,
    PrivateStateTransitionProgram: proverModule.PrivateStateTransitionProgram,
    compilePrivateStateTransitionProgram: proverModule.compilePrivateStateTransitionProgram
  };
}

async function ensureCompiled(modules, batchId) {
  if (compiled) return compiled;
  console.log(`[private-state-proof-worker] compiling private-state program before batch ${batchId}...`);
  const verificationKey = await modules.compilePrivateStateTransitionProgram();
  compiled = { verificationKey };
  console.log(`[private-state-proof-worker] compile complete for batch ${batchId}`);
  return compiled;
}

async function buildProofArtifact(modules, pending) {
  const artifacts = await modules.buildPendingPrivateStateProofInputs();
  if (!artifacts) {
    console.log('[private-state-proof-worker] no pending batch after artifact rebuild');
    return null;
  }
  if (Number(artifacts.pending.batchId) !== Number(pending.batchId)) {
    console.log(
      `[private-state-proof-worker] pending batch advanced from ${pending.batchId} to ${artifacts.pending.batchId}; retrying`
    );
    return null;
  }

  const { verificationKey } = await ensureCompiled(modules, pending.batchId);
  console.log(`[private-state-proof-worker] proving batch ${pending.batchId}...`);
  const result = await modules.PrivateStateTransitionProgram.proveBatch(
    artifacts.publicInput,
    artifacts.batchWitness
  );

  await mkdir(PRIVATE_STATE_PROOFS_DIR, { recursive: true });
  const proofPath = proofArtifactPath(pending.batchId);
  await writeFile(
    proofPath,
    JSON.stringify(
      {
        batchId: artifacts.pending.batchId,
        batchHash: artifacts.pending.batchHash,
        expectedPrivateStateTransitionHash: artifacts.pending.privateStateTransitionHash || null,
        witnessTransitionHash: artifacts.witness.transitionHash().toString(),
        verificationKeyHash: verificationKey.hash.toString(),
        publicInput: {
          prevRoots: {
            noteRoot: artifacts.prevRoots.noteRoot.toString(),
            nullifierRoot: artifacts.prevRoots.nullifierRoot.toString(),
            settlementRoot: artifacts.prevRoots.settlementRoot.toString()
          },
          nextRoots: {
            noteRoot: artifacts.nextRoots.noteRoot.toString(),
            nullifierRoot: artifacts.nextRoots.nullifierRoot.toString(),
            settlementRoot: artifacts.nextRoots.settlementRoot.toString()
          },
          transitionHash: artifacts.publicInput.transitionHash.toString(),
          batchHash: artifacts.publicInput.batchHash.toString()
        },
        publicOutput: {
          appliedSpendCount: artifacts.batchWitness.appliedSpendCount.toString(),
          appliedOutputCount: artifacts.batchWitness.appliedOutputCount.toString(),
          nextRoots: {
            noteRoot: artifacts.batchWitness.nextRoots.noteRoot.toString(),
            nullifierRoot: artifacts.batchWitness.nextRoots.nullifierRoot.toString(),
            settlementRoot: artifacts.batchWitness.nextRoots.settlementRoot.toString()
          }
        },
        proof: result.proof.toJSON()
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`[private-state-proof-worker] proof ready for batch ${pending.batchId} path=${proofPath}`);
  return proofPath;
}

async function loop() {
  const modules = await loadProofModules();
  let lastProvedBatchId = null;

  while (true) {
    try {
      const pending = await getNextPending();
      if (!pending) {
        lastProvedBatchId = null;
        await new Promise((r) => setTimeout(r, Math.max(1000, INTERVAL_MS)));
        continue;
      }

      const proofPath = proofArtifactPath(pending.batchId);
      if (existsSync(proofPath)) {
        if (lastProvedBatchId !== pending.batchId) {
          console.log(`[private-state-proof-worker] cached proof already exists for batch ${pending.batchId}`);
        }
        lastProvedBatchId = pending.batchId;
      } else {
        console.log(`[private-state-proof-worker] precomputing proof for batch ${pending.batchId}...`);
        await buildProofArtifact(modules, pending);
        lastProvedBatchId = pending.batchId;
      }

      await new Promise((r) => setTimeout(r, Math.max(1000, INTERVAL_MS)));
    } catch (error) {
      console.error('[private-state-proof-worker] loop error:', error);
      await new Promise((r) => setTimeout(r, Math.max(1000, INTERVAL_MS)));
    }
  }
}

loop().catch((error) => {
  console.error('[private-state-proof-worker] fatal:', error);
  process.exit(1);
});
