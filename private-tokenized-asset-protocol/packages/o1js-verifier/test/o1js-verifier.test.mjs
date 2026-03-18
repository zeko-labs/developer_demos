import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyO1jsPayload } from '../dist/index.js';

function makePayload(overrides = {}) {
  const publicInput = {
    policyId: 1,
    result: true,
    subjectCommitment: 'subj_o1js_pkg_001'
  };
  const normalized = Object.keys(publicInput)
    .sort()
    .reduce((acc, key) => {
      acc[key] = publicInput[key];
      return acc;
    }, {});
  const publicInputHash = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return {
    circuitId: 'eligibility_v1',
    publicInput: normalized,
    proof: {
      proofBase64: Buffer.from(JSON.stringify({ verified: true })).toString('base64'),
      verificationKeyHash: 'vk_hash_demo',
      publicInputHash
    },
    ...overrides
  };
}

test('verifyO1jsPayload passes in reference-pass-through mode', async () => {
  process.env.ZK_O1JS_VERIFIER_MODE = 'reference-pass-through';
  process.env.ZK_O1JS_VERIFICATION_KEY_HASH = 'vk_hash_demo';
  const result = await verifyO1jsPayload(makePayload());
  assert.equal(result.verified, true);
});

test('verifyO1jsPayload rejects mismatched verification key hash', async () => {
  process.env.ZK_O1JS_VERIFIER_MODE = 'reference-pass-through';
  process.env.ZK_O1JS_VERIFICATION_KEY_HASH = 'vk_hash_expected';
  const result = await verifyO1jsPayload(makePayload());
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'verification_key_hash_mismatch');
});

test('verifyO1jsPayload enforces strict-json mode', async () => {
  process.env.ZK_O1JS_VERIFIER_MODE = 'reference-strict-json';
  process.env.ZK_O1JS_VERIFICATION_KEY_HASH = 'vk_hash_demo';
  const payload = makePayload({
    proof: {
      proofBase64: Buffer.from(
        JSON.stringify({
          verified: true,
          circuitId: 'eligibility_v1',
          publicInputHash: makePayload().proof.publicInputHash,
          verificationKeyHash: 'vk_hash_demo'
        })
      ).toString('base64'),
      verificationKeyHash: 'vk_hash_demo',
      publicInputHash: makePayload().proof.publicInputHash
    }
  });
  const result = await verifyO1jsPayload(payload);
  assert.equal(result.verified, true);
});

test('verifyO1jsPayload supports o1js-runtime mode with injected module', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-o1js-runtime-'));
  const modulePath = path.join(dir, 'mock-o1js.mjs');
  const verificationKey = { data: 'vk_demo' };
  const proofJson = { proof: 'demo_proof' };
  fs.writeFileSync(
    modulePath,
    "export async function verify(proof, verificationKey) { return proof?.proof === 'demo_proof' && verificationKey?.data === 'vk_demo'; }\n",
    'utf8'
  );

  process.env.ZK_O1JS_VERIFIER_MODE = 'o1js-runtime';
  process.env.ZK_O1JS_MODULE = modulePath;
  process.env.ZK_O1JS_VERIFICATION_KEY_HASH = 'vk_hash_demo';
  process.env.ZK_O1JS_VERIFICATION_KEY_JSON_BASE64 = Buffer.from(
    JSON.stringify(verificationKey)
  ).toString('base64');

  const payload = makePayload({
    proof: {
      ...makePayload().proof,
      proofJsonBase64: Buffer.from(JSON.stringify(proofJson)).toString('base64')
    }
  });
  const result = await verifyO1jsPayload(payload);
  assert.equal(result.verified, true);

  delete process.env.ZK_O1JS_VERIFIER_MODE;
  delete process.env.ZK_O1JS_MODULE;
  delete process.env.ZK_O1JS_VERIFICATION_KEY_HASH;
  delete process.env.ZK_O1JS_VERIFICATION_KEY_JSON_BASE64;
  fs.rmSync(dir, { recursive: true, force: true });
});
