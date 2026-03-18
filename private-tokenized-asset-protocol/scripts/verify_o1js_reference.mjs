#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';

function normalizePublicInput(input) {
  const keys = Object.keys(input || {}).sort();
  const out = {};
  for (const k of keys) out[k] = input[k];
  return out;
}

function fail(reason) {
  process.stdout.write(`${JSON.stringify({ verified: false, reason })}\n`);
  process.exit(0);
}

function ok() {
  process.stdout.write(`${JSON.stringify({ verified: true })}\n`);
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  fail('invalid_stdin_json');
}

const proof = payload?.proof || {};
const publicInput = payload?.publicInput || {};
const circuitId = String(payload?.circuitId || '');
if (!circuitId) fail('missing_circuit_id');

const proofBase64 = String(proof.proofBase64 || '');
const verificationKeyHash = String(proof.verificationKeyHash || '');
const publicInputHash = String(proof.publicInputHash || '');

if (!proofBase64) fail('missing_proof_base64');
if (!verificationKeyHash) fail('missing_verification_key_hash');
if (!publicInputHash) fail('missing_public_input_hash');

const expectedInputHash = crypto
  .createHash('sha256')
  .update(JSON.stringify(normalizePublicInput(publicInput)))
  .digest('hex');
if (publicInputHash !== expectedInputHash) fail('public_input_hash_mismatch');

const expectedVkHash = process.env.ZK_O1JS_VERIFICATION_KEY_HASH || '';
if (expectedVkHash && verificationKeyHash !== expectedVkHash) {
  fail('verification_key_hash_mismatch');
}

let decoded;
try {
  decoded = Buffer.from(proofBase64, 'base64');
} catch {
  fail('proof_base64_decode_failed');
}
if (!decoded || decoded.length === 0) fail('proof_bytes_empty');

const mode = process.env.ZK_O1JS_REFERENCE_MODE || 'pass-through';
if (mode === 'strict-json') {
  let parsed;
  try {
    parsed = JSON.parse(decoded.toString('utf8'));
  } catch {
    fail('strict_json_parse_failed');
  }
  if (parsed?.verified !== true) fail('strict_json_verified_false');
  if (typeof parsed?.circuitId === 'string' && parsed.circuitId !== circuitId) {
    fail('strict_json_circuit_id_mismatch');
  }
  if (typeof parsed?.publicInputHash === 'string' && parsed.publicInputHash !== publicInputHash) {
    fail('strict_json_public_input_hash_mismatch');
  }
  if (typeof parsed?.verificationKeyHash === 'string' && parsed.verificationKeyHash !== verificationKeyHash) {
    fail('strict_json_verification_key_hash_mismatch');
  }
}

ok();
