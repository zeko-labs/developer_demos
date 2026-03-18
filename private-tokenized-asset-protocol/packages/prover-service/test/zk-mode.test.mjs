import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateEligibilityProof,
  generateTransferComplianceProof,
  verifyProofEnvelope
} from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

test('PROOF_MODE=zk generates verifiable eligibility proof', () => {
  process.env.PROOF_MODE = 'zk';
  const proof = generateEligibilityProof({
    subjectCommitment: 'subj_zk_001',
    policyId: 1,
    tenantId: 'tenant-a',
    policyVersion: 2,
    policyHash: 'hash_v2'
  });
  assert.equal(proof.mode, 'zk');
  assert.equal(String(proof.proof.kind), 'zk-ed25519-statement');
  const verified = verifyProofEnvelope(proof);
  assert.equal(verified.verified, true);
});

test('PROOF_MODE=zk verification fails on tampered statement', () => {
  process.env.PROOF_MODE = 'zk';
  const proof = generateEligibilityProof({
    subjectCommitment: 'subj_zk_002',
    policyId: 1
  });
  proof.publicInput.subjectCommitment = 'subj_zk_tampered';
  const verified = verifyProofEnvelope(proof);
  assert.equal(verified.verified, false);
  assert.equal(verified.reason, 'proof_hash_mismatch');
});

test('PROOF_MODE=zk generates verifiable transfer proof', () => {
  process.env.PROOF_MODE = 'zk';
  const proof = generateTransferComplianceProof({
    senderCommitment: 'sender_1',
    receiverCommitment: 'receiver_1',
    assetId: 1,
    amountCommitment: 'amt_1',
    policyId: 1
  });
  const verified = verifyProofEnvelope(proof);
  assert.equal(verified.verified, true);
});

test('PROOF_MODE=zk verifies zk-o1js-proof payload via external verifier command', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-zk-verify-'));
  const verifierScript = path.join(dir, 'verify-ok.js');
  fs.writeFileSync(
    verifierScript,
    "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(0,'utf8')); const ok=Boolean(p?.proof?.proofBase64); console.log(JSON.stringify({verified:ok, reason: ok ? undefined : 'missing'}));\n",
    'utf8'
  );

  process.env.ZK_O1JS_VERIFY_CMD = `${process.execPath} ${verifierScript}`;
  process.env.ZK_O1JS_VERIFICATION_KEY_HASH = 'vk_hash_demo';

  const publicInput = {
    subjectCommitment: 'subj_o1js_001',
    policyId: 1,
    result: true
  };
  const serializedInput = JSON.stringify(
    Object.keys(publicInput)
      .sort()
      .reduce((acc, k) => {
        acc[k] = publicInput[k];
        return acc;
      }, {})
  );
  const proof = {
    id: 'prf_o1js_demo',
    circuitId: 'eligibility_v1',
    mode: 'zk',
    publicInput,
    proof: {
      kind: 'zk-o1js-proof',
      proofBase64: Buffer.from('proof').toString('base64'),
      verificationKeyHash: 'vk_hash_demo',
      publicInputHash: 'will_be_set'
    },
    proofHash: 'will_be_set',
    verifiedLocal: true,
    createdAt: new Date().toISOString()
  };
  proof.proof.publicInputHash = crypto.createHash('sha256').update(serializedInput).digest('hex');
  proof.proofHash = crypto.createHash('sha256')
    .update(`${proof.circuitId}:${proof.mode}:${serializedInput}`)
    .digest('hex');

  const verified = verifyProofEnvelope(proof);
  assert.equal(verified.verified, true);

  delete process.env.ZK_O1JS_VERIFY_CMD;
  delete process.env.ZK_O1JS_VERIFICATION_KEY_HASH;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PROOF_MODE=zk rejects zk-o1js-proof when verifier command is not configured', () => {
  delete process.env.ZK_O1JS_VERIFY_CMD;
  delete process.env.ZK_O1JS_VERIFICATION_KEY_HASH;

  const publicInput = {
    subjectCommitment: 'subj_o1js_002',
    policyId: 1,
    result: true
  };
  const serializedInput = JSON.stringify(
    Object.keys(publicInput)
      .sort()
      .reduce((acc, k) => {
        acc[k] = publicInput[k];
        return acc;
      }, {})
  );
  const hash = crypto.createHash('sha256').update(serializedInput).digest('hex');
  const proof = {
    id: 'prf_o1js_demo_2',
    circuitId: 'eligibility_v1',
    mode: 'zk',
    publicInput,
    proof: {
      kind: 'zk-o1js-proof',
      proofBase64: Buffer.from('proof').toString('base64'),
      verificationKeyHash: 'vk_hash_demo',
      publicInputHash: hash
    },
    proofHash: crypto.createHash('sha256')
      .update(`eligibility_v1:zk:${serializedInput}`)
      .digest('hex'),
    verifiedLocal: true,
    createdAt: new Date().toISOString()
  };
  const verified = verifyProofEnvelope(proof);
  assert.equal(verified.verified, false);
  assert.equal(verified.reason, 'zk_o1js_verifier_not_configured');
});

test('PROOF_MODE=zk can generate and verify a real o1js eligibility proof', () => {
  process.env.PROOF_MODE = 'zk';
  process.env.ZK_PROVER_BACKEND = 'o1js';
  process.env.ZK_O1JS_PROVE_CMD = `node ${path.join(repoRoot, 'packages/circuits/dist/prove-cli.js')}`;
  process.env.ZK_O1JS_VERIFY_CMD = `node ${path.join(repoRoot, 'packages/o1js-verifier/dist/cli.js')}`;
  process.env.ZK_O1JS_VERIFIER_MODE = 'o1js-runtime';
  process.env.ZK_O1JS_MODULE = 'o1js';
  delete process.env.ZK_O1JS_VERIFICATION_KEY_HASH;
  delete process.env.ZK_O1JS_VERIFICATION_KEY_JSON_BASE64;

  const proof = generateEligibilityProof({
    subjectCommitment: 'subj_real_o1js_001',
    policyId: 1,
    tenantId: 'tenant-a',
    policyVersion: 2,
    policyHash: 'policy_hash_real',
    jurisdiction: 'US'
  });

  assert.equal(proof.mode, 'zk');
  assert.equal(String(proof.proof.kind), 'zk-o1js-proof');
  assert.equal(proof.verifiedLocal, true);

  const verified = verifyProofEnvelope(proof);
  assert.equal(verified.verified, true);

  delete process.env.ZK_PROVER_BACKEND;
  delete process.env.ZK_O1JS_PROVE_CMD;
  delete process.env.ZK_O1JS_VERIFY_CMD;
  delete process.env.ZK_O1JS_VERIFIER_MODE;
  delete process.env.ZK_O1JS_MODULE;
});

test('PROOF_MODE=zk can generate and verify a real o1js transfer proof', () => {
  process.env.PROOF_MODE = 'zk';
  process.env.ZK_PROVER_BACKEND = 'o1js';
  process.env.ZK_O1JS_PROVE_CMD = `node ${path.join(repoRoot, 'packages/circuits/dist/prove-cli.js')}`;
  process.env.ZK_O1JS_VERIFY_CMD = `node ${path.join(repoRoot, 'packages/o1js-verifier/dist/cli.js')}`;
  process.env.ZK_O1JS_VERIFIER_MODE = 'o1js-runtime';
  process.env.ZK_O1JS_MODULE = 'o1js';
  delete process.env.ZK_O1JS_VERIFICATION_KEY_HASH;
  delete process.env.ZK_O1JS_VERIFICATION_KEY_JSON_BASE64;

  const proof = generateTransferComplianceProof({
    senderCommitment: 'sender_real_o1js_001',
    receiverCommitment: 'receiver_real_o1js_001',
    assetId: 7,
    amountCommitment: 'amt_real_o1js_001',
    policyId: 1
  });

  assert.equal(proof.mode, 'zk');
  assert.equal(String(proof.proof.kind), 'zk-o1js-proof');
  assert.equal(proof.verifiedLocal, true);

  const verified = verifyProofEnvelope(proof);
  assert.equal(verified.verified, true);

  delete process.env.ZK_PROVER_BACKEND;
  delete process.env.ZK_O1JS_PROVE_CMD;
  delete process.env.ZK_O1JS_VERIFY_CMD;
  delete process.env.ZK_O1JS_VERIFIER_MODE;
  delete process.env.ZK_O1JS_MODULE;
});
