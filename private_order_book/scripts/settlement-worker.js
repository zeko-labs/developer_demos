import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = (process.env.DARKPOOL_API || 'http://127.0.0.1:8791').replace(/\/$/, '');
const INTERNAL_SERVICE_SECRET = String(process.env.INTERNAL_SERVICE_SECRET || '').trim();
const MODE = String(process.env.SETTLEMENT_MODE || 'zkapp').toLowerCase(); // zkapp | local(testing only)
const INTERVAL_MS = Number.parseInt(process.env.SETTLEMENT_INTERVAL_MS || '6000', 10);
const REQUIRE_PAYOUT_PROOFS = String(process.env.SETTLEMENT_REQUIRE_PAYOUT_PROOFS || 'true').toLowerCase() === 'true';
const ALLOW_UNVERIFIED_PAYOUTS = String(process.env.SETTLEMENT_ALLOW_UNVERIFIED_PAYOUTS || 'false').toLowerCase() === 'true';
const PAYOUT_COMMAND = String(
  process.env.SETTLEMENT_PAYOUT_COMMAND || 'node scripts/settlement-payout-executor.js'
).trim();
const ZKAPP_COMMIT_MAX_OLD_SPACE_MB = Math.max(
  0,
  Number.parseInt(process.env.ZKAPP_COMMIT_MAX_OLD_SPACE_MB || '4096', 10) || 4096
);
const ZKAPP_COMMIT_USE_PROOF = String(process.env.ZKAPP_COMMIT_USE_PROOF || 'false').toLowerCase() === 'true';
const REQUIRE_CACHED_PRIVATE_STATE_PROOF = String(
  process.env.REQUIRE_CACHED_PRIVATE_STATE_PROOF || 'true'
).toLowerCase() === 'true';
const PRIVATE_STATE_PROOFS_DIR = String(
  process.env.PRIVATE_STATE_PROOFS_DIR || path.resolve(process.cwd(), 'data', 'private-state-proofs')
).trim();
const ZKAPP_COMMIT_COMMAND = String(
  process.env.ZKAPP_COMMIT_COMMAND || 'node --enable-source-maps dist-zkapp/commit-next-batch.js'
).trim();
let commitNextPendingBatchFn = null;

function cachedProofPath(batchId) {
  return path.resolve(PRIVATE_STATE_PROOFS_DIR, `batch-${batchId}.json`);
}

async function request(pathname, options = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      ...(INTERNAL_SERVICE_SECRET ? { 'x-internal-service-key': INTERNAL_SERVICE_SECRET } : {}),
      ...(options.headers || {})
    },
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

async function loadCommitModule(projectRoot) {
  if (commitNextPendingBatchFn) return commitNextPendingBatchFn;
  const modulePath = path.resolve(projectRoot, 'dist-zkapp', 'commit-next-batch.js');
  const mod = await import(modulePath);
  if (typeof mod.commitNextPendingBatch !== 'function') {
    throw new Error('dist-zkapp/commit-next-batch.js does not export commitNextPendingBatch()');
  }
  commitNextPendingBatchFn = mod.commitNextPendingBatch;
  return commitNextPendingBatchFn;
}

async function runZkappCommit(projectRoot) {
  const commitNextPendingBatch = await loadCommitModule(projectRoot);
  return await commitNextPendingBatch();
}

function runPayoutCommand(command, batch) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      shell: true
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
    child.stdin.write(JSON.stringify({ batch }, null, 2));
    child.stdin.end();

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`payout command failed (${code})\n${err}`));
        return;
      }
      const first = out.indexOf('{');
      const last = out.lastIndexOf('}');
      if (first === -1 || last === -1 || last <= first) {
        reject(new Error('payout command returned no JSON payload'));
        return;
      }
      try {
        const parsed = JSON.parse(out.slice(first, last + 1));
        resolve(parsed);
      } catch (error) {
        reject(new Error(`payout command JSON parse failed: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

async function getPayoutTxProofsIfNeeded(pending) {
  const needsPayouts =
    pending &&
    pending.batchType === 'trade_settlement' &&
    Array.isArray(pending.payouts) &&
    pending.payouts.length > 0 &&
    (pending.requiresOnchainPayouts !== undefined ? Boolean(pending.requiresOnchainPayouts) : REQUIRE_PAYOUT_PROOFS);
  if (!needsPayouts) return [];

  const cachedPayoutTxs = Array.isArray(pending?.payoutSubmission?.payoutTxs) ? pending.payoutSubmission.payoutTxs : [];
  if (cachedPayoutTxs.length) {
    console.log(
      `[settlement-worker] reusing cached payout proofs for batch ${pending.batchId} (${cachedPayoutTxs.length} payouts)`
    );
    return cachedPayoutTxs;
  }

  if (!PAYOUT_COMMAND) {
    if (ALLOW_UNVERIFIED_PAYOUTS) {
      console.warn(
        `[settlement-worker] WARNING: batch ${pending.batchId} requires payouts but proceeding without payout proofs (SETTLEMENT_ALLOW_UNVERIFIED_PAYOUTS=true)`
      );
      return [];
    }
    throw new Error(
      `batch ${pending.batchId} requires payout proofs. Set SETTLEMENT_PAYOUT_COMMAND to produce payout tx hashes before commit.`
    );
  }
  const result = await runPayoutCommand(PAYOUT_COMMAND, pending);
  const payoutTxs = Array.isArray(result?.payoutTxs) ? result.payoutTxs : [];
  if (!payoutTxs.length && !ALLOW_UNVERIFIED_PAYOUTS) {
    throw new Error(`payout command returned no payoutTxs for required batch ${pending.batchId}`);
  }
  if (payoutTxs.length) {
    await request('/api/darkpool/settlement/cache-payout-proofs', {
      method: 'POST',
      body: { batchId: pending.batchId, payoutTxs }
    });
  }
  return payoutTxs;
}

async function commitLoop() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, '..');

  while (true) {
    try {
      const pending = await getNextPending();
      if (!pending) {
        await new Promise((r) => setTimeout(r, Math.max(1000, INTERVAL_MS)));
        continue;
      }

      if (MODE === 'local') {
        const committed = await request('/api/darkpool/settlement/commit-next-local', { method: 'POST' });
        if (committed?.committed?.batchId) {
          console.log(`[settlement-worker] local committed batch ${committed.committed.batchId}`);
        }
      } else if (MODE === 'zkapp') {
        if (ZKAPP_COMMIT_USE_PROOF && REQUIRE_CACHED_PRIVATE_STATE_PROOF && !existsSync(cachedProofPath(pending.batchId))) {
          console.log(
            `[settlement-worker] waiting for cached private-state proof for batch ${pending.batchId} before payouts/commit`
          );
          await new Promise((r) => setTimeout(r, Math.max(1000, INTERVAL_MS)));
          continue;
        }
        const payoutTxs = await getPayoutTxProofsIfNeeded(pending);
        const result = await runZkappCommit(projectRoot);
        const localBatchId = result?.localBatchId ?? result?.batchId ?? null;
        if (localBatchId) {
          await request('/api/darkpool/settlement/mark-committed', {
            method: 'POST',
            body: { batchId: localBatchId, txHash: result.txHash || null, payoutTxs }
          });
          console.log(
            `[settlement-worker] zkapp committed local batch ${localBatchId} onchainBatch=${result?.onchainBatchId || '-'} tx=${result.txHash || '-'}`
          );
        } else {
          console.log('[settlement-worker] zkapp commit completed but no batchId returned');
        }
      } else {
        throw new Error(`unknown SETTLEMENT_MODE ${MODE}`);
      }
    } catch (error) {
      console.error('[settlement-worker] loop error:', error);
    }

    await new Promise((r) => setTimeout(r, Math.max(1000, INTERVAL_MS)));
  }
}

commitLoop().catch((error) => {
  console.error('[settlement-worker] fatal:', error);
  process.exit(1);
});
