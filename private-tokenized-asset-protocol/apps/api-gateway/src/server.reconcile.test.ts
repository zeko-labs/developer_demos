import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { RecordSettlementRequest } from '@tap/shared-types';
import { generateEligibilityProof } from '@tap/prover-service';
import {
  getSettlementByProofHash,
  resetSettlementStore,
  upsertSettlementByProofHash
} from '@tap/contracts';

function buildRequest(subjectCommitment: string): RecordSettlementRequest {
  return {
    operation: 'eligibility',
    subjectCommitment,
    proof: generateEligibilityProof({
      subjectCommitment,
      policyId: 1,
      tenantId: 'tenant-a',
      policyVersion: 1,
      policyHash: 'policy_hash_v1'
    }),
    metadata: {
      tenantId: 'tenant-a',
      policyId: 1,
      policyVersion: 1,
      policyHash: 'policy_hash_v1',
      policySnapshotHash: 'policy_hash_v1'
    }
  };
}

test('settlement reconcile upgrades stale statuses and finalizes state', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tap-reconcile-'));
  process.env.TAP_DATA_DIR = dataDir;
  process.env.TAP_DISABLE_LISTEN = '1';

  await resetSettlementStore();

  const pendingReq = buildRequest('subj_pending_reconcile');
  const submittedReq = buildRequest('subj_submitted_reconcile');

  await upsertSettlementByProofHash(pendingReq, {
    status: 'pending_submit',
    anchored: false,
    confirmationSource: 'test_seed'
  });
  await upsertSettlementByProofHash(submittedReq, {
    status: 'submitted',
    anchored: false,
    confirmationSource: 'test_seed'
  });

  const settlementFile = path.join(dataDir, 'settlements.json');
  const raw = await readFile(settlementFile, 'utf8');
  const store = JSON.parse(raw) as { records: Array<Record<string, unknown>> };
  const oldCreatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  store.records = store.records.map((record) => ({ ...record, createdAt: oldCreatedAt }));
  await writeFile(settlementFile, JSON.stringify(store, null, 2), 'utf8');

  const mod = await import('./server.js');
  const reconcile = await mod.runSettlementReconcileOnce({
    limit: 20,
    staleMinutes: 1
  });
  assert.equal(reconcile.actions.length >= 2, true);

  const pendingAfter = await getSettlementByProofHash(pendingReq.proof.proofHash);
  assert.ok(pendingAfter);
  assert.equal(pendingAfter?.status, 'submitted');
  assert.equal(pendingAfter?.confirmationSource, 'reconciler_submit_retry');

  const submittedAfter = await getSettlementByProofHash(submittedReq.proof.proofHash);
  assert.ok(submittedAfter);
  assert.equal(submittedAfter?.status, 'recorded');
  assert.equal(submittedAfter?.anchored, true);
  assert.equal(typeof submittedAfter?.finalizedAt, 'string');
  assert.equal(submittedAfter?.confirmationSource, 'reconciler_local_verify');

  await rm(dataDir, { recursive: true, force: true });
});

test('settlement reconcile honors policy toggles', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tap-reconcile-policy-'));
  process.env.TAP_DATA_DIR = dataDir;
  process.env.TAP_DISABLE_LISTEN = '1';

  await resetSettlementStore();
  const submittedReq = buildRequest('subj_submitted_policy_toggle');
  await upsertSettlementByProofHash(submittedReq, {
    status: 'submitted',
    anchored: false,
    confirmationSource: 'test_seed'
  });

  const settlementFile = path.join(dataDir, 'settlements.json');
  const raw = await readFile(settlementFile, 'utf8');
  const store = JSON.parse(raw) as { records: Array<Record<string, unknown>> };
  const oldCreatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  store.records = store.records.map((record) => ({ ...record, createdAt: oldCreatedAt }));
  await writeFile(settlementFile, JSON.stringify(store, null, 2), 'utf8');

  const mod = await import('./server.js');
  const result = await mod.runSettlementReconcileOnce({
    limit: 20,
    staleMinutes: 1,
    policy: {
      allowPromoteSubmittedRecorded: false,
      allowMarkSubmittedFailed: false
    }
  });
  assert.equal(result.actions.length, 0);

  const submittedAfter = await getSettlementByProofHash(submittedReq.proof.proofHash);
  assert.ok(submittedAfter);
  assert.equal(submittedAfter?.status, 'submitted');

  await rm(dataDir, { recursive: true, force: true });
});
