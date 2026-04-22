import 'reflect-metadata';
import 'dotenv/config';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import process from 'node:process';
import { Field, Mina, Permissions, Poseidon, PrivateKey, PublicKey, UInt64, fetchAccount } from 'o1js';
import Client from 'mina-signer';
import { NavaIntentZkApp } from '../src/NavaIntentZkApp.js';
import {
  buildApprovalDomainCommitment,
  buildApprovalMessageFields,
  buildVerifierQuorumInput,
  computeVerifierSetRoot
} from '../src/zekoVerifierAttestation.js';

type SupportedNetworkId = 'mainnet' | 'testnet' | { custom: string };

const CONTRACT_VERSION = 'nava-intent-v3';
const STATUS_LABELS = new Map<number, string>([
  [0, 'PENDING'],
  [1, 'APPROVED'],
  [2, 'EXECUTED'],
  [3, 'SETTLED'],
  [4, 'REJECTED'],
  [5, 'UNDECIDED']
]);

function normalizeGraphqlUrl(value: string | null | undefined, fallback: string) {
  const raw = value?.trim() || fallback;
  if (raw.endsWith('/graphql')) return raw;
  return `${raw.replace(/\/+$/, '')}/graphql`;
}

function resolveNetworkId(raw: string | null | undefined): SupportedNetworkId {
  const value = raw?.trim();
  if (value === 'mainnet' || value === 'testnet') return value;
  return value ? { custom: value } : 'testnet';
}

function networkIdLabel(networkId: SupportedNetworkId) {
  return typeof networkId === 'string' ? networkId : networkId.custom;
}

function getSecret(name: string) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requiredEnv(name: string) {
  const value = getSecret(name);
  if (!value) {
    throw new Error(`missing_${name.toLowerCase()}`);
  }
  return value;
}

function parseInteger(name: string, fallback: number) {
  const raw = process.env[name];
  const value = Number.parseInt(String(raw ?? fallback), 10);
  return Number.isFinite(value) ? value : fallback;
}

function parseJsonEnv<T>(name: string, fallback: T): T {
  const raw = process.env[name];
  if (!raw || !String(raw).trim()) return fallback;
  return JSON.parse(String(raw)) as T;
}

function decodeStatusCode(value: string | number | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return STATUS_LABELS.get(parsed) || `UNKNOWN(${String(value ?? '')})`;
}

function isGatewayTimeoutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('504') || message.toLowerCase().includes('gateway timeout');
}

function sanitizeRequestHash(value: string) {
  return String(value || '').trim().toLowerCase();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function promptHidden(prompt: string) {
  if (!process.stdin.isTTY) {
    throw new Error('A TTY is required to securely prompt for the deployer key.');
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return await new Promise<string>((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Cancelled by user.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value.trim());
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function graphqlRequest<T>(graphql: string, query: string, variables: Record<string, unknown>) {
  const response = await fetch(graphql, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      query,
      variables
    })
  });
  const parsed = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (!response.ok || parsed.errors?.length) {
    throw new Error(parsed.errors?.map((item) => item.message).filter(Boolean).join('; ') || `graphql_error:${response.status}`);
  }
  return parsed.data as T;
}

const GET_ACCOUNT_QUERY = `
  query accountInfo($publicKey: PublicKey!) {
    account(publicKey: $publicKey) {
      publicKey
      balance {
        total
      }
      nonce
      inferredNonce
    }
  }
`;

const SEND_PAYMENT_QUERY = `
  mutation sendPayment(
    $fee: UInt64!,
    $amount: UInt64!,
    $to: PublicKey!,
    $from: PublicKey!,
    $nonce: UInt32,
    $memo: String,
    $validUntil: UInt32,
    $scalar: String!,
    $field: String!
  ) {
    sendPayment(
      input: { fee: $fee, amount: $amount, to: $to, from: $from, memo: $memo, nonce: $nonce, validUntil: $validUntil },
      signature: { field: $field, scalar: $scalar }
    ) {
      payment {
        hash
        nonce
        amount
        fee
        failureReason
      }
    }
  }
`;

function fieldFromText(value: string) {
  const text = String(value || '');
  if (!text) return Field(0);
  const entries = Array.from(text).map((char) => Field(char.charCodeAt(0)));
  return Poseidon.hash(entries);
}

function fieldFromHex(value: string) {
  const normalized = String(value || '').trim().toLowerCase().replace(/^0x/, '');
  if (!normalized) return Field(0);
  const entries = [];
  for (let index = 0; index < normalized.length; index += 2) {
    const chunk = normalized.slice(index, index + 2).padEnd(2, '0');
    entries.push(Field(Number.parseInt(chunk, 16)));
  }
  return Poseidon.hash(entries);
}

function toFieldState(input: {
  intentHash: string;
  statementHash: string;
  approvalCommitment: string;
  statusCode: number;
  requiredVerifierApprovals: number;
  observedVerifierApprovals: number;
  approvalDomainCommitment: string;
  lastUpdatedAt: number;
}) {
  return {
    intentHash: fieldFromHex(input.intentHash),
    statementHash: fieldFromHex(input.statementHash),
    approvalCommitment: fieldFromHex(input.approvalCommitment),
    status: Field(input.statusCode),
    requiredVerifierApprovals: Field(input.requiredVerifierApprovals),
    observedVerifierApprovals: Field(input.observedVerifierApprovals),
    approvalDomainCommitment: Field(input.approvalDomainCommitment),
    lastUpdatedAt: Field(input.lastUpdatedAt)
  };
}

async function waitForAccountVisible(publicKey: PublicKey, attempts = 40, intervalMs = 3000) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const result = await fetchAccount({ publicKey });
      if (!result.error) return true;
    } catch {
      // keep polling
    }
    await sleep(intervalMs);
  }
  return false;
}

async function accountExists(publicKey: PublicKey) {
  try {
    const result = await fetchAccount({ publicKey });
    return !result.error;
  } catch {
    return false;
  }
}

async function waitForState(publicKey: PublicKey, expectedState: string[], attempts = 40, intervalMs = 3000) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const result = await fetchAccount({ publicKey });
      if (!result.error) {
        const current = (result.account.zkapp?.appState || []).map((entry) => entry.toString());
        if (expectedState.every((value, itemIndex) => current[itemIndex] === value)) {
          return current;
        }
      }
    } catch {
      // keep polling
    }
    await sleep(intervalMs);
  }
  return null;
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJsonIfPresent(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function loadOrCreateIntentZkappKey(keyPath: string) {
  try {
    const stored = await fs.readFile(keyPath, 'utf8');
    return {
      key: PrivateKey.fromBase58(stored.trim()),
      status: 'reused-stored-key'
    };
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
  }
  const generated = PrivateKey.random();
  await fs.writeFile(keyPath, `${generated.toBase58()}\n`, 'utf8');
  return {
    key: generated,
    status: 'generated-new-key'
  };
}

async function sendSignedPrefundPayment({
  networkId,
  graphql,
  deployerPublicKey,
  deployerPrivateKey,
  recipient,
  amount,
  fee
}: {
  networkId: SupportedNetworkId;
  graphql: string;
  deployerPublicKey: string;
  deployerPrivateKey: string;
  recipient: string;
  amount: string;
  fee: string;
}) {
  const accountData = await graphqlRequest<{ account: { inferredNonce?: string | null; nonce?: string | null } | null }>(
    graphql,
    GET_ACCOUNT_QUERY,
    { publicKey: deployerPublicKey }
  );
  const nonce = accountData.account?.inferredNonce ?? accountData.account?.nonce;
  if (nonce == null) throw new Error('unable_to_fetch_inferred_nonce');
  const client = new Client({ network: networkId });
  const signedPayment = client.signPayment(
    {
      from: deployerPublicKey,
      to: recipient,
      amount: Number(amount),
      fee: Number(fee),
      nonce: Number(nonce),
      memo: 'agent-execution-escrow-intent'
    },
    deployerPrivateKey
  );
  const paymentData = signedPayment?.data ?? {};
  const signature = signedPayment?.signature ?? {};
  const result = await graphqlRequest<{ sendPayment: { payment: { hash?: string | null } } }>(
    graphql,
    SEND_PAYMENT_QUERY,
    {
      ...paymentData,
      ...(signature || {})
    }
  );
  return result.sendPayment.payment;
}

function sameLifecycle(record: Record<string, unknown> | null, nextLifecycle: Record<string, unknown>) {
  if (!record || typeof record.lifecycle !== 'object' || !record.lifecycle) return false;
  const existing = record.lifecycle as Record<string, unknown>;
  return (
    existing.intentHash === nextLifecycle.intentHash &&
    existing.statementHash === nextLifecycle.statementHash &&
    existing.approvalCommitment === nextLifecycle.approvalCommitment &&
    existing.status === nextLifecycle.status &&
    existing.statusCode === nextLifecycle.statusCode &&
    existing.requiredVerifierApprovals === nextLifecycle.requiredVerifierApprovals &&
    existing.observedVerifierApprovals === nextLifecycle.observedVerifierApprovals &&
    existing.settlementTarget === nextLifecycle.settlementTarget &&
    existing.approvalDomainCommitment === nextLifecycle.approvalDomainCommitment &&
    existing.verifierSetRoot === nextLifecycle.verifierSetRoot &&
    existing.lastUpdatedAt === nextLifecycle.lastUpdatedAt
  );
}

async function main() {
  const requestHash = sanitizeRequestHash(requiredEnv('ZKAPP_REQUEST_HASH'));
  const intentHash = requiredEnv('ZKAPP_INTENT_HASH');
  const statementHash = requiredEnv('ZKAPP_STATEMENT_HASH');
  const approvalCommitment = requiredEnv('ZKAPP_APPROVAL_COMMITMENT');
  const status = requiredEnv('ZKAPP_STATUS');
  const statusCode = parseInteger('ZKAPP_STATUS_CODE', 0);
  const requiredVerifierApprovals = parseInteger('ZKAPP_REQUIRED_VERIFIER_APPROVALS', 0);
  const observedVerifierApprovals = parseInteger('ZKAPP_OBSERVED_VERIFIER_APPROVALS', 0);
  const settlementTarget = requiredEnv('ZKAPP_SETTLEMENT_TARGET');
  const settlementTargetHash = requiredEnv('ZKAPP_SETTLEMENT_TARGET_HASH');
  const registeredVerifierPublicKeys = parseJsonEnv<string[]>('ZKAPP_VERIFIER_PUBLIC_KEYS', []);
  const zekoVerifierApprovals = parseJsonEnv<Array<{ verifierPublicKey: string; signature: string }>>(
    'ZKAPP_ZEKO_VERIFIER_APPROVALS',
    []
  );
  const lastUpdatedAt = parseInteger('ZKAPP_LAST_UPDATED_AT', Math.floor(Date.now() / 1000));

  const networkId = resolveNetworkId(process.env.ZEKO_NETWORK_ID);
  const networkIdText = networkIdLabel(networkId);
  const graphql = normalizeGraphqlUrl(process.env.ZEKO_GRAPHQL, 'https://testnet.zeko.io/graphql');
  const archive = normalizeGraphqlUrl(process.env.ZEKO_ARCHIVE_GRAPHQL, 'https://archive.testnet.zeko.io/graphql');
  const explorer = process.env.ZEKO_EXPLORER || 'https://zekoscan.io/testnet';
  const txFee = UInt64.from(process.env.TX_FEE || '100000000');
  const prefundAmount = UInt64.from(process.env.ZKAPP_PREFUND_AMOUNT || '1000000000');

  const deployerSecret =
    getSecret('DEPLOYER_PRIVATE_KEY') ||
    getSecret('SPONSOR_PRIVATE_KEY') ||
    (process.stdin.isTTY ? await promptHidden('Deployer private key: ') : null);
  if (!deployerSecret) {
    throw new Error('Missing DEPLOYER_PRIVATE_KEY or SPONSOR_PRIVATE_KEY.');
  }

  const intentKey = requestHash.replace(/[^a-z0-9]/gi, '').slice(0, 64);
  const intentDir = path.join(process.cwd(), 'data', 'intents');
  const keyPath = path.join(intentDir, `${intentKey}.${CONTRACT_VERSION}.zkapp-private-key.txt`);
  const recordPath = path.join(intentDir, `${intentKey}.json`);

  await ensureDir(intentDir);

  const verifierSetRoot = computeVerifierSetRoot(registeredVerifierPublicKeys.map((item) => PublicKey.fromBase58(item))).toString();
  const approvalDomainCommitment = buildApprovalDomainCommitment({
    verifierSetRoot: Field(verifierSetRoot)
  }).toString();
  const lifecycle = {
    requestHash,
    intentHash,
    statementHash,
    approvalCommitment,
    status,
    statusCode,
    requiredVerifierApprovals,
    observedVerifierApprovals,
    settlementTarget,
    settlementTargetHash,
    approvalDomainCommitment,
    verifierSetRoot,
    lastUpdatedAt
  };
  const fieldState = toFieldState(lifecycle);
  const expectedState = [
    fieldState.intentHash.toString(),
    fieldState.statementHash.toString(),
    fieldState.approvalCommitment.toString(),
    fieldState.status.toString(),
    fieldState.requiredVerifierApprovals.toString(),
    fieldState.observedVerifierApprovals.toString(),
    fieldState.approvalDomainCommitment.toString(),
    fieldState.lastUpdatedAt.toString()
  ];

  const deployerKey = PrivateKey.fromBase58(deployerSecret);
  const deployerPublicKey = deployerKey.toPublicKey();
  const { key: zkappKey, status: keySource } = await loadOrCreateIntentZkappKey(keyPath);
  const zkappPublicKey = zkappKey.toPublicKey();

  Mina.setActiveInstance(
    Mina.Network({
      networkId,
      mina: graphql,
      archive
    })
  );

  const deployerAccount = await fetchAccount({ publicKey: deployerPublicKey });
  if (deployerAccount.error) {
    throw new Error('Deployer account not found on Zeko testnet. Fund it before syncing intent state.');
  }

  const existingRecord = await readJsonIfPresent(recordPath);
  const existingRecordVersion =
    existingRecord && typeof existingRecord.contractVersion === 'string' ? String(existingRecord.contractVersion) : null;
  const exists = await accountExists(zkappPublicKey);

  if (exists && sameLifecycle(existingRecord, lifecycle)) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          action: 'noop',
          requestHash,
          contractVersion: CONTRACT_VERSION,
          networkId: networkIdText,
          graphql,
          archive,
          explorer,
          deployerPublicKey: deployerPublicKey.toBase58(),
          zkappPublicKey: zkappPublicKey.toBase58(),
          lifecycle,
          fieldState: {
            intentHash: expectedState[0],
            statementHash: expectedState[1],
            approvalCommitment: expectedState[2],
            status: expectedState[3],
            requiredVerifierApprovals: expectedState[4],
            observedVerifierApprovals: expectedState[5],
            approvalDomainCommitment: expectedState[6],
            lastUpdatedAt: expectedState[7]
          },
          recordPath,
          keyPath,
          keySource,
          proofAuthority: 'zkapp_proof_rules'
        },
        null,
        2
      )
    );
    return;
  }

  await NavaIntentZkApp.compile();
  const zkapp = new NavaIntentZkApp(zkappPublicKey);

  let action = 'updated';
  let prefundTxHash: string | null = null;
  let sent: { hash?: string | null; status?: string | null } | null = null;
  let transition:
    | {
        fromStatus: string | null;
        fromStatusCode: string | null;
        toStatus: string;
        toStatusCode: number;
      }
    | null = null;

  if (!exists) {
    action = existingRecordVersion && existingRecordVersion !== CONTRACT_VERSION ? 'migrated-and-deployed' : 'deployed';
    transition = {
      fromStatus: null,
      fromStatusCode: null,
      toStatus: status,
      toStatusCode: statusCode
    };
    const payment = await sendSignedPrefundPayment({
      networkId,
      graphql,
      deployerPublicKey: deployerPublicKey.toBase58(),
      deployerPrivateKey: deployerSecret,
      recipient: zkappPublicKey.toBase58(),
      amount: prefundAmount.toString(),
      fee: txFee.toString()
    });
    prefundTxHash = payment.hash ?? null;
    const funded = await waitForAccountVisible(zkappPublicKey);
    if (!funded) {
      throw new Error('zkapp account did not become visible after signed prefund payment.');
    }

    const tx = await Mina.transaction(
      {
        sender: deployerPublicKey,
        fee: txFee
      },
      async () => {
        await zkapp.deploy();
        zkapp.account.permissions.set({
          ...Permissions.default(),
          editState: Permissions.proof()
        });
        zkapp.intentHash.set(fieldState.intentHash);
        zkapp.statementHash.set(fieldState.statementHash);
        zkapp.approvalCommitment.set(fieldState.approvalCommitment);
        zkapp.status.set(fieldState.status);
        zkapp.requiredVerifierApprovals.set(fieldState.requiredVerifierApprovals);
        zkapp.observedVerifierApprovals.set(fieldState.observedVerifierApprovals);
        zkapp.approvalDomainCommitment.set(fieldState.approvalDomainCommitment);
        zkapp.lastUpdatedAt.set(fieldState.lastUpdatedAt);
      }
    );
    await tx.prove();
    tx.sign([deployerKey, zkappKey]);
    try {
      sent = await tx.send();
    } catch (error) {
      if (!isGatewayTimeoutError(error)) throw error;
    }
  } else {
    const currentAccount = await fetchAccount({ publicKey: zkappPublicKey });
    if (currentAccount.error) {
      throw new Error('zkapp account not found before lifecycle update.');
    }
    const currentState = currentAccount.account.zkapp?.appState?.map((entry) => entry.toString()) || [];
    transition = {
      fromStatus: decodeStatusCode(currentState[3] || null),
      fromStatusCode: currentState[3] || null,
      toStatus: status,
      toStatusCode: statusCode
    };
    const tx = await Mina.transaction(
      {
        sender: deployerPublicKey,
        fee: txFee
      },
      async () => {
        if (statusCode === 1 && registeredVerifierPublicKeys.length > 0) {
          const messageFields = buildApprovalMessageFields({
            intentHash: fieldState.intentHash,
            quorumThreshold: fieldState.requiredVerifierApprovals,
            approvalDomainCommitment: fieldState.approvalDomainCommitment
          });
          const { quorum, observedApprovals } = buildVerifierQuorumInput({
            registeredVerifierPublicKeys: registeredVerifierPublicKeys.map((item) => PublicKey.fromBase58(item)),
            approvalSignatures: zekoVerifierApprovals,
            messageFields
          });
          if (observedApprovals < requiredVerifierApprovals) {
            throw new Error('insufficient_zeko_verifier_signatures_for_quorum');
          }
          await zkapp.approveWithVerifierQuorum(
            fieldState.statementHash,
            fieldState.approvalCommitment,
            fieldState.lastUpdatedAt,
            quorum
          );
        } else {
          await zkapp.syncLifecycle(
            fieldState.statementHash,
            fieldState.approvalCommitment,
            fieldState.status,
            fieldState.observedVerifierApprovals,
            fieldState.lastUpdatedAt
          );
        }
      }
    );
    await tx.prove();
    tx.sign([deployerKey]);
    try {
      sent = await tx.send();
    } catch (error) {
      if (!isGatewayTimeoutError(error)) throw error;
    }
  }

  const confirmedState = await waitForState(zkappPublicKey, expectedState);
  if (!confirmedState) {
    throw new Error('zkapp state did not converge to the expected lifecycle snapshot.');
  }

  const record = {
    ok: true,
    action,
    requestHash,
    contractVersion: CONTRACT_VERSION,
    networkId: networkIdText,
    graphql,
    archive,
    explorer,
    deployerPublicKey: deployerPublicKey.toBase58(),
    zkappPublicKey: zkappPublicKey.toBase58(),
    prefundTxHash,
    txHash: sent?.hash ?? null,
    txStatus: sent?.status ?? null,
    keySource,
    keyPath,
    recordPath,
    previousRecord:
      existingRecord && typeof existingRecord.zkappPublicKey === 'string'
        ? {
            contractVersion: existingRecordVersion,
            zkappPublicKey: String(existingRecord.zkappPublicKey)
          }
        : null,
    proofAuthority: 'zkapp_proof_rules',
    transition,
    lifecycle,
    fieldState: {
      intentHash: confirmedState[0],
      statementHash: confirmedState[1],
      approvalCommitment: confirmedState[2],
      status: confirmedState[3],
      requiredVerifierApprovals: confirmedState[4],
      observedVerifierApprovals: confirmedState[5],
      approvalDomainCommitment: confirmedState[6],
      lastUpdatedAt: confirmedState[7]
    },
    updatedAt: new Date().toISOString()
  };

  await fs.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  process.stdout.write(JSON.stringify(record, null, 2));
}

main().catch((error) => {
  console.error('[zkapp-intent:sync] failed', error);
  process.exit(1);
});
