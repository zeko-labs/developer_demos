import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface O1jsVerifierPayload {
  circuitId: string;
  publicInput: Record<string, string | number | boolean>;
  proof: {
    proofBase64: string;
    verificationKeyHash: string;
    publicInputHash: string;
    [key: string]: unknown;
  };
}

export interface O1jsVerifierResult {
  verified: boolean;
  reason?: string;
}

function normalizePublicInput(input: Record<string, string | number | boolean>) {
  return Object.keys(input)
    .sort()
    .reduce<Record<string, string | number | boolean>>((acc, key) => {
      acc[key] = input[key]!;
      return acc;
    }, {});
}

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function fail(reason: string): O1jsVerifierResult {
  return { verified: false, reason };
}

async function loadVerifierModule(moduleId: string) {
  if (moduleId.startsWith('/') || moduleId.startsWith('./') || moduleId.startsWith('../')) {
    const resolved = moduleId.startsWith('/') ? moduleId : path.resolve(process.cwd(), moduleId);
    return import(pathToFileURL(resolved).href);
  }
  return import(moduleId);
}

function verifyReferenceStrictJson(
  payload: O1jsVerifierPayload,
  decoded: Buffer
): O1jsVerifierResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(decoded.toString('utf8')) as Record<string, unknown>;
  } catch {
    return fail('strict_json_parse_failed');
  }
  if (parsed.verified !== true) return fail('strict_json_verified_false');
  if (typeof parsed.circuitId === 'string' && parsed.circuitId !== payload.circuitId) {
    return fail('strict_json_circuit_id_mismatch');
  }
  if (
    typeof parsed.publicInputHash === 'string' &&
    parsed.publicInputHash !== payload.proof.publicInputHash
  ) {
    return fail('strict_json_public_input_hash_mismatch');
  }
  if (
    typeof parsed.verificationKeyHash === 'string' &&
    parsed.verificationKeyHash !== payload.proof.verificationKeyHash
  ) {
    return fail('strict_json_verification_key_hash_mismatch');
  }
  return { verified: true };
}

export async function verifyO1jsPayload(payload: O1jsVerifierPayload): Promise<O1jsVerifierResult> {
  if (!payload.circuitId) return fail('missing_circuit_id');
  if (!payload.proof?.proofBase64) return fail('missing_proof_base64');
  if (!payload.proof?.verificationKeyHash) return fail('missing_verification_key_hash');
  if (!payload.proof?.publicInputHash) return fail('missing_public_input_hash');

  const expectedPublicInputHash = sha256(JSON.stringify(normalizePublicInput(payload.publicInput || {})));
  if (payload.proof.publicInputHash !== expectedPublicInputHash) {
    return fail('public_input_hash_mismatch');
  }

  const expectedVerificationKeyHash = process.env.ZK_O1JS_VERIFICATION_KEY_HASH || '';
  if (
    expectedVerificationKeyHash &&
    payload.proof.verificationKeyHash !== expectedVerificationKeyHash
  ) {
    return fail('verification_key_hash_mismatch');
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(payload.proof.proofBase64, 'base64');
  } catch {
    return fail('proof_base64_decode_failed');
  }
  if (decoded.length === 0) return fail('proof_bytes_empty');

  const mode = process.env.ZK_O1JS_VERIFIER_MODE || 'reference-pass-through';
  if (mode === 'o1js-runtime') {
    const proofJsonBase64 = String(payload.proof.proofJsonBase64 || payload.proof.proofBase64 || '');
    const verificationKeyJsonBase64 = String(
      payload.proof.verificationKeyJsonBase64 || process.env.ZK_O1JS_VERIFICATION_KEY_JSON_BASE64 || ''
    );
    if (!proofJsonBase64) return fail('o1js_proof_json_missing');
    if (!verificationKeyJsonBase64) return fail('o1js_verification_key_json_missing');

    let proofJson: unknown;
    let verificationKeyJson: unknown;
    try {
      proofJson = JSON.parse(Buffer.from(proofJsonBase64, 'base64').toString('utf8'));
    } catch {
      return fail('o1js_proof_json_decode_failed');
    }
    try {
      verificationKeyJson = JSON.parse(Buffer.from(verificationKeyJsonBase64, 'base64').toString('utf8'));
    } catch {
      return fail('o1js_verification_key_json_decode_failed');
    }

    const moduleId = process.env.ZK_O1JS_MODULE || 'o1js';
    let verifierModule: Record<string, unknown>;
    try {
      verifierModule = (await loadVerifierModule(moduleId)) as Record<string, unknown>;
    } catch {
      return fail('o1js_module_load_failed');
    }

    const verifyFn =
      typeof verifierModule.verify === 'function'
        ? verifierModule.verify
        : verifierModule.default && typeof (verifierModule.default as Record<string, unknown>).verify === 'function'
          ? (verifierModule.default as Record<string, unknown>).verify
          : null;
    if (!verifyFn) return fail('o1js_verify_function_missing');

    try {
      const verified = await Promise.resolve(
        (verifyFn as (proofJson: unknown, verificationKeyJson: unknown) => unknown)(
          proofJson,
          verificationKeyJson
        )
      );
      return verified === true ? { verified: true } : fail('o1js_verify_returned_false');
    } catch {
      return fail('o1js_verify_threw');
    }
  }
  if (mode === 'reference-strict-json') {
    return verifyReferenceStrictJson(payload, decoded);
  }

  return { verified: true };
}
