import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildZekoIntentSnapshot } from './navaCompatibility.js';

const execFileAsync = promisify(execFile);

const ZEKO_ZKAPP_PROJECT_PATH = process.env.ZEKO_ZKAPP_PROJECT_PATH || path.resolve(process.cwd(), 'zkapp-test');
const ZEKO_ZKAPP_SYNC_SCRIPT = process.env.ZEKO_ZKAPP_SYNC_SCRIPT || 'dist/scripts/sync-intent.js';

function normalizeNetworkId(value) {
  const raw = String(value || '').trim();
  return raw || 'testnet';
}

export function getZekoIntentSyncConfig() {
  return {
    projectPath: ZEKO_ZKAPP_PROJECT_PATH,
    syncScript: ZEKO_ZKAPP_SYNC_SCRIPT,
    configured: Boolean(process.env.SPONSOR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY),
    networkId: normalizeNetworkId(process.env.ZEKO_NETWORK_ID)
  };
}

function buildEnv(transaction, snapshot) {
  const nativeVerifierPublicKeys = Array.isArray(transaction?.nativeVerifierRegistry?.verifiers)
    ? transaction.nativeVerifierRegistry.verifiers.map((item) => item.zekoPublicKey)
    : [];
  const zekoVerifierApprovals = (Array.isArray(transaction?.approvals?.external) ? transaction.approvals.external : [])
    .filter(
      (item) =>
        item?.signatureScheme === 'mina_poseidon' &&
        item?.registryVerified &&
        item?.zekoPublicKey &&
        typeof item?.signature === 'string' &&
        item.signature.trim()
    )
    .map((item) => ({
      verifierPublicKey: item.zekoPublicKey,
      signature: item.signature.trim()
    }));
  return {
    ...process.env,
    ZKAPP_REQUEST_HASH: transaction.requestHash,
    ZKAPP_INTENT_HASH: snapshot.intentHash,
    ZKAPP_STATEMENT_HASH: snapshot.statementHash,
    ZKAPP_APPROVAL_COMMITMENT: snapshot.approvalCommitment,
    ZKAPP_STATUS: snapshot.status,
    ZKAPP_STATUS_CODE: String(snapshot.statusCode),
    ZKAPP_REQUIRED_VERIFIER_APPROVALS: String(snapshot.requiredVerifierApprovals),
    ZKAPP_OBSERVED_VERIFIER_APPROVALS: String(snapshot.observedVerifierApprovals),
    ZKAPP_SETTLEMENT_TARGET: snapshot.settlementTarget,
    ZKAPP_SETTLEMENT_TARGET_HASH: snapshot.settlementTargetHash,
    ZKAPP_VERIFIER_SET_ROOT: String(snapshot.verifierSetRoot || '0'),
    ZKAPP_VERIFIER_PUBLIC_KEYS: JSON.stringify(nativeVerifierPublicKeys),
    ZKAPP_ZEKO_VERIFIER_APPROVALS: JSON.stringify(zekoVerifierApprovals),
    ZKAPP_LAST_UPDATED_AT: String(snapshot.lastUpdatedAt),
    ZEKO_NETWORK_ID: normalizeNetworkId(process.env.ZEKO_NETWORK_ID)
  };
}

export async function syncZekoIntentLifecycle(transaction, anchorPayload = null) {
  if (!process.env.SPONSOR_PRIVATE_KEY && !process.env.DEPLOYER_PRIVATE_KEY) {
    const error = new Error('zeko_zkapp_signer_not_configured');
    error.statusCode = 503;
    throw error;
  }

  const snapshot = buildZekoIntentSnapshot(transaction, {
    statementHash: anchorPayload?.statementHash || null
  });
  const { stdout, stderr } = await execFileAsync('node', ['--env-file=.env', ZEKO_ZKAPP_SYNC_SCRIPT], {
    cwd: ZEKO_ZKAPP_PROJECT_PATH,
    env: buildEnv(transaction, snapshot),
    maxBuffer: 1024 * 1024 * 8
  });

  let parsed = null;
  try {
    parsed = JSON.parse(String(stdout || '').trim());
  } catch {
    const error = new Error('zeko_zkapp_sync_invalid_output');
    error.statusCode = 502;
    error.details = {
      stdout: String(stdout || '').trim(),
      stderr: String(stderr || '').trim()
    };
    throw error;
  }

  return {
    mode: 'zkapp',
    status: parsed?.ok ? 'synced' : 'failed',
    payloadHash: parsed?.payloadHash ?? null,
    txHash: parsed?.txHash ?? null,
    networkId: parsed?.networkId ?? normalizeNetworkId(process.env.ZEKO_NETWORK_ID),
    zkapp: {
      ...parsed,
      stderr: String(stderr || '').trim() || null
    }
  };
}
