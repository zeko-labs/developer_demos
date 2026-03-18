import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProofEnvelope } from '@tap/shared-types';
import type { ActivePolicySnapshot } from './policySettlementGuard.js';
import { extractPolicyLinkage, validatePolicyAtSettlement } from './policySettlementGuard.js';

function buildProof(publicInput: ProofEnvelope['publicInput']): ProofEnvelope {
  return {
    id: 'proof_1',
    circuitId: 'tap.eligibility.v1',
    mode: 'mock',
    publicInput,
    proof: { kind: 'mock' },
    proofHash: 'hash_1',
    verifiedLocal: true,
    createdAt: new Date().toISOString()
  };
}

const activePolicy: ActivePolicySnapshot = {
  version: 2,
  effectiveAt: '2026-02-20T00:00:00.000Z',
  policyHash: 'policy_hash_v2'
};

test('policy guard: happy path match', () => {
  const proof = buildProof({
    tenantId: 'tenant-a',
    policyId: 1,
    policyVersion: 2,
    policyHash: 'policy_hash_v2'
  });
  const linkage = extractPolicyLinkage(proof);
  const result = validatePolicyAtSettlement(linkage, activePolicy);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.policySnapshotHash, 'policy_hash_v2');
    assert.equal(result.policyEffectiveAt, '2026-02-20T00:00:00.000Z');
  }
});

test('policy guard: stale policy version', () => {
  const proof = buildProof({
    tenantId: 'tenant-a',
    policyId: 1,
    policyVersion: 1,
    policyHash: 'policy_hash_v2'
  });
  const linkage = extractPolicyLinkage(proof);
  const result = validatePolicyAtSettlement(linkage, activePolicy);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'policy_version_mismatch');
  }
});

test('policy guard: hash mismatch', () => {
  const proof = buildProof({
    tenantId: 'tenant-a',
    policyId: 1,
    policyVersion: 2,
    policyHash: 'policy_hash_old'
  });
  const linkage = extractPolicyLinkage(proof);
  const result = validatePolicyAtSettlement(linkage, activePolicy);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'policy_hash_mismatch');
  }
});

test('policy guard: missing policy linkage', () => {
  const proof = buildProof({
    policyId: 1
  });
  const linkage = extractPolicyLinkage(proof);
  const result = validatePolicyAtSettlement(linkage, activePolicy);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'policy_linkage_missing');
  }
});
