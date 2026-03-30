import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const API_BASE = (process.env.DARKPOOL_API || '').replace(/\/$/, '');
const PROOF_WORKER_API_KEY = String(process.env.PROOF_WORKER_API_KEY || '').trim();
const INTERVAL_MS = Number.parseInt(process.env.PRIVATE_STATE_PROOF_INTERVAL_MS || '4000', 10);
const PRIVATE_STATE_PROOF_COMMAND = String(
  process.env.PRIVATE_STATE_PROOF_COMMAND || 'node --enable-source-maps dist-zkapp/prove-private-state-batch.js'
).trim();
const PRIVATE_STATE_PROVER_MAX_OLD_SPACE_MB = Math.max(
  0,
  Number.parseInt(process.env.PRIVATE_STATE_PROVER_MAX_OLD_SPACE_MB || '4096', 10) || 4096
);

if (!API_BASE) throw new Error('DARKPOOL_API is required');
if (!PROOF_WORKER_API_KEY) throw new Error('PROOF_WORKER_API_KEY is required');

async function request(pathname, options = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      'x-proof-worker-key': PROOF_WORKER_API_KEY,
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `request failed: ${pathname}`);
  return json;
}

function runProofBuild(workdir, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...envOverrides };
    if (PRIVATE_STATE_PROVER_MAX_OLD_SPACE_MB > 0) {
      const maxOldSpace = `--max-old-space-size=${PRIVATE_STATE_PROVER_MAX_OLD_SPACE_MB}`;
      env.NODE_OPTIONS = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${maxOldSpace}` : maxOldSpace;
    }
    const child = spawn(PRIVATE_STATE_PROOF_COMMAND, {
      cwd: workdir,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    });

    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
      process.stdout.write(String(chunk));
    });
    child.stderr.on('data', (chunk) => {
      err += String(chunk);
      process.stderr.write(String(chunk));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`remote proof command failed (${code})\n${err}`));
        return;
      }
      resolve(out);
    });
  });
}

async function processNextJob() {
  const job = await request('/api/darkpool/settlement/proof-job/next');
  if (!job?.batch) return { idle: true, reason: job?.message || 'no pending batches' };
  if (job.cached) return { idle: true, reason: `cached proof already exists for batch ${job.batch.batchId}` };

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'shadowbook-proof-'));
  try {
    const dataDir = path.resolve(tempRoot, 'data');
    const proofDir = path.resolve(dataDir, 'private-state-proofs');
    await writeFile(path.resolve(dataDir, 'engine-state.json'), String(job.snapshot.engineStatePayload || ''), 'utf8');
    await writeFile(
      path.resolve(dataDir, 'settlement-batches.json'),
      String(job.snapshot.settlementBatchesPayload || ''),
      'utf8'
    );

    console.log(`[private-state-proof-agent] proving remote batch ${job.batch.batchId}...`);
    await runProofBuild(process.cwd(), {
      ENGINE_STATE_FILE: path.resolve(dataDir, 'engine-state.json'),
      SETTLEMENT_BATCHES_FILE: path.resolve(dataDir, 'settlement-batches.json'),
      PRIVATE_STATE_PROOFS_DIR: proofDir
    });

    const proofPath = path.resolve(proofDir, `batch-${job.batch.batchId}.json`);
    if (!existsSync(proofPath)) {
      throw new Error(`proof artifact not found for batch ${job.batch.batchId}`);
    }
    const proofArtifact = JSON.parse(await readFile(proofPath, 'utf8'));
    await request('/api/darkpool/settlement/cache-private-state-proof', {
      method: 'POST',
      body: {
        batchId: job.batch.batchId,
        proofArtifact
      }
    });
    return { idle: false, batchId: job.batch.batchId, proofPath };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function loop() {
  while (true) {
    try {
      const result = await processNextJob();
      if (result.idle) {
        if (result.reason) console.log(`[private-state-proof-agent] ${result.reason}`);
      } else {
        console.log(`[private-state-proof-agent] uploaded proof for batch ${result.batchId}`);
      }
    } catch (error) {
      console.error('[private-state-proof-agent] loop error:', error);
    }
    await new Promise((r) => setTimeout(r, Math.max(1000, INTERVAL_MS)));
  }
}

loop().catch((error) => {
  console.error('[private-state-proof-agent] fatal:', error);
  process.exit(1);
});
