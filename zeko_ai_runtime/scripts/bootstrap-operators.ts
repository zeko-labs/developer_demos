import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import { PrivateKey } from 'o1js';
import { getSponsorLaneFilePath, type SponsorLane } from '../src/sponsor-lanes.js';

type OperatorRegistryStatus = 'active' | 'paused' | 'draining';

type SponsorLaneSource = 'env-lane' | 'env-shared' | 'stored-lane' | 'stored-shared' | 'missing';

interface OperatorLaneAssignment {
  lane: SponsorLane;
  configured: boolean;
  publicKey: string | null;
  source: SponsorLaneSource;
  usesSharedFallback: boolean;
}

interface OperatorRegistryRecord {
  id: string;
  label: string;
  endpoint: string | null;
  status: OperatorRegistryStatus;
  local: boolean;
  networkId: string;
  contractVersions: Array<'v1' | 'v2'>;
  capabilities: string[];
  sponsorLanes: OperatorLaneAssignment[];
  metadata: Record<string, unknown> | null;
  registeredAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

interface OperatorRegistryFile {
  operators: OperatorRegistryRecord[];
  lastUpdatedAt: string | null;
}

interface LaneProvision {
  lane: SponsorLane;
  privateKey: string;
  publicKey: string;
  filePath: string;
  created: boolean;
}

interface RemoteOperatorBootstrapLane {
  lane: SponsorLane;
  privateKey: string;
  publicKey: string;
}

interface FundingTransferRecord {
  scope: 'local' | 'remote';
  lane: SponsorLane;
  publicKey: string;
  amountMina: number;
  hash: string | null;
}

interface RemoteOperatorBootstrapFile {
  version: 1;
  network: {
    networkId: string;
    graphql: string;
    explorer: string | null;
  };
  operator: {
    id: string;
    label: string;
    endpoint: string | null;
    status: OperatorRegistryStatus;
  };
  lanes: RemoteOperatorBootstrapLane[];
  generatedAt: string;
  updatedAt: string;
  funding: {
    txFee: string;
    targetMina: number;
    sourceSponsorPublicKey: string;
    sourceBalanceBeforeMina: number | null;
    sourceBalanceAfterMina: number | null;
    transfers: FundingTransferRecord[];
  };
}

interface AccountState {
  exists: boolean;
  nonce: bigint | null;
  balance: bigint;
}

const lanes = ['request', 'output', 'registry', 'credits'] as SponsorLane[];
const deploymentDir = path.join(process.cwd(), 'data', 'deployments');
const dataDir = path.join(process.cwd(), 'data', 'opengradient');
const operatorsDir = path.join(dataDir, 'operators');
const operatorRegistryPath = path.join(dataDir, 'operator-registry.json');
const localOperatorIdPath = path.join(dataDir, 'local-operator-id.txt');
const sharedSponsorKeyPath = path.join(deploymentDir, 'sponsor-private-key.txt');
const networkId = process.env.ZEKO_NETWORK_ID?.trim() || 'testnet';
const graphql = normalizeGraphqlUrl(process.env.ZEKO_GRAPHQL || null, 'https://testnet.zeko.io/graphql');
const explorer = process.env.ZEKO_EXPLORER?.trim() || 'https://zekoscan.io/testnet';
const txFee = process.env.TX_FEE?.trim() || '100000000';
const newAccountFundingBuffer = BigInt(txFee);
const localLaneTargetMina = normalizePositiveNumber(process.env.OPENGRADIENT_LOCAL_LANE_TARGET_MINA, 1);
const remoteLaneTargetMina = normalizePositiveNumber(process.env.OPENGRADIENT_REMOTE_LANE_TARGET_MINA, 1);
const remoteOperatorId = process.env.OPENGRADIENT_REMOTE_OPERATOR_ID?.trim() || `remote-operator-${networkId}-1`;
const remoteOperatorLabel = process.env.OPENGRADIENT_REMOTE_OPERATOR_LABEL?.trim() || remoteOperatorId;
const remoteOperatorEndpoint = process.env.OPENGRADIENT_REMOTE_OPERATOR_ENDPOINT?.trim() || null;
const remoteOperatorStatus = normalizeOperatorRegistryStatus(process.env.OPENGRADIENT_REMOTE_OPERATOR_STATUS, 'paused');
const remoteBootstrapPath = path.join(operatorsDir, `${remoteOperatorId}.bootstrap.json`);

const accountQuery = `
  query Account($publicKey: PublicKey!) {
    account(publicKey: $publicKey) {
      nonce
      balance {
        total
      }
    }
  }
`;

const sendPaymentMutation = `
  mutation SendPayment(
    $from: PublicKey!,
    $to: PublicKey!,
    $fee: UInt64!,
    $amount: UInt64!,
    $nonce: UInt32!,
    $memo: String,
    $validUntil: UInt32,
    $field: String!,
    $scalar: String!
  ) {
    sendPayment(
      input: {
        from: $from
        to: $to
        fee: $fee
        amount: $amount
        nonce: $nonce
        memo: $memo
        validUntil: $validUntil
      }
      signature: { field: $field, scalar: $scalar }
    ) {
      payment {
        hash
        failureReason
      }
    }
  }
`;

function normalizeGraphqlUrl(value: string | null, fallback: string) {
  const raw = value?.trim() || fallback;
  if (raw.endsWith('/graphql')) return raw;
  return `${raw.replace(/\/+$/, '')}/graphql`;
}

function normalizePositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeOperatorRegistryStatus(value: unknown, fallback: OperatorRegistryStatus = 'active'): OperatorRegistryStatus {
  return value === 'paused' || value === 'draining' || value === 'active' ? value : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function nanominaFromMina(amountMina: number) {
  return BigInt(Math.round(amountMina * 1e9));
}

function minaFromNanomina(amount: bigint) {
  return Number(amount) / 1e9;
}

function getSecret(name: string) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function readTextFile(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const value = raw.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function writeTextFile(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${value.trim()}\n`, 'utf8');
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function graphqlRequest<T>(query: string, variables: Record<string, unknown>) {
  const response = await fetch(graphql, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok) {
    throw new Error(`graphql http ${response.status}`);
  }
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(json.errors.map((entry) => entry.message || 'unknown graphql error').join('; '));
  }
  if (!json.data) {
    throw new Error('graphql response missing data');
  }
  return json.data;
}

async function readAccountState(publicKey: string): Promise<AccountState> {
  const data = await graphqlRequest<{
    account?: {
      nonce?: string | null;
      balance?: { total?: string | null } | null;
    } | null;
  }>(accountQuery, { publicKey });
  const account = data.account;
  if (!account) {
    return {
      exists: false,
      nonce: null,
      balance: 0n
    };
  }
  return {
    exists: true,
    nonce: typeof account.nonce === 'string' && account.nonce.length > 0 ? BigInt(account.nonce) : null,
    balance:
      typeof account.balance?.total === 'string' && account.balance.total.length > 0 ? BigInt(account.balance.total) : 0n
  };
}

async function getMinaSignerClientCtor() {
  const signerPath = path.join(process.cwd(), 'node_modules', 'o1js', 'dist', 'node', 'mina-signer', 'mina-signer.js');
  const module = (await import(pathToFileURL(signerPath).href)) as {
    default: new (args: { network: 'mainnet' | 'testnet' }) => {
      signPayment(
        payment: {
          to: string;
          from: string;
          fee: string;
          amount: string;
          nonce: string;
          memo?: string;
          validUntil?: string | number | null;
        },
        privateKey: string
      ): {
        signature: { field: string; scalar: string };
      };
    };
  };
  return module.default;
}

async function sendPayment(
  senderKey: PrivateKey,
  recipientPublicKey: string,
  amount: bigint,
  memo: string
): Promise<{ hash: string | null; nonce: string }> {
  const senderPublicKey = senderKey.toPublicKey().toBase58();
  const MinaSignerClient = await getMinaSignerClientCtor();
  const signer = new MinaSignerClient({
    network: networkId === 'mainnet' ? 'mainnet' : 'testnet'
  });

  const attemptSend = async (overrideNonce?: bigint) => {
    const senderState = await readAccountState(senderPublicKey);
    if (!senderState.exists || senderState.nonce === null) {
      throw new Error('Funding sponsor account not found on-chain.');
    }
    const nonce = overrideNonce ?? senderState.nonce;
    const signedPayment = signer.signPayment(
      {
        to: recipientPublicKey,
        from: senderPublicKey,
        fee: txFee,
        amount: amount.toString(),
        nonce: nonce.toString(),
        memo
      },
      senderKey.toBase58()
    );

    const data = await graphqlRequest<{
      sendPayment?: {
        payment?: {
          hash?: string | null;
          failureReason?: unknown;
        } | null;
      };
    }>(sendPaymentMutation, {
      from: senderPublicKey,
      to: recipientPublicKey,
      fee: txFee,
      amount: amount.toString(),
      nonce: nonce.toString(),
      memo,
      validUntil: null,
      field: signedPayment.signature.field,
      scalar: signedPayment.signature.scalar
    });

    const payment = data.sendPayment?.payment;
    if (!payment) {
      throw new Error('sendPayment did not return a payment object.');
    }
    const failureReason = Array.isArray(payment.failureReason)
      ? payment.failureReason.join(', ')
      : payment.failureReason;
    if (failureReason) {
      throw new Error(`sendPayment failure: ${String(failureReason)}`);
    }
    return {
      hash: payment.hash ?? null,
      nonce: nonce.toString()
    };
  };

  try {
    return await attemptSend();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Account_nonce_precondition_unsatisfied')) {
      throw error;
    }
    await sleep(1500);
    const senderState = await readAccountState(senderPublicKey);
    if (senderState.nonce === null) throw error;
    return await attemptSend(senderState.nonce);
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTargetBalance(publicKey: string, target: bigint, attempts = 40, intervalMs = 3000) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await readAccountState(publicKey);
    if (state.balance >= target) {
      return state;
    }
    if (attempt < attempts - 1) {
      await sleep(intervalMs);
    }
  }
  return null;
}

async function loadOrCreateLaneProvision(filePath: string, lane: SponsorLane): Promise<LaneProvision> {
  const stored = await readTextFile(filePath);
  if (stored) {
    const key = PrivateKey.fromBase58(stored);
    return {
      lane,
      privateKey: stored,
      publicKey: key.toPublicKey().toBase58(),
      filePath,
      created: false
    };
  }
  const key = PrivateKey.random();
  const privateKey = key.toBase58();
  await writeTextFile(filePath, privateKey);
  return {
    lane,
    privateKey,
    publicKey: key.toPublicKey().toBase58(),
    filePath,
    created: true
  };
}

async function provisionLocalLaneKeys() {
  const provisions: LaneProvision[] = [];
  for (const lane of lanes) {
    provisions.push(await loadOrCreateLaneProvision(getSponsorLaneFilePath(lane), lane));
  }
  return provisions;
}

function defaultRemoteBootstrap(): RemoteOperatorBootstrapFile {
  return {
    version: 1,
    network: {
      networkId,
      graphql,
      explorer
    },
    operator: {
      id: remoteOperatorId,
      label: remoteOperatorLabel,
      endpoint: remoteOperatorEndpoint,
      status: remoteOperatorStatus
    },
    lanes: lanes.map((lane) => {
      const key = PrivateKey.random();
      return {
        lane,
        privateKey: key.toBase58(),
        publicKey: key.toPublicKey().toBase58()
      };
    }),
    generatedAt: nowIso(),
    updatedAt: nowIso(),
    funding: {
      txFee,
      targetMina: remoteLaneTargetMina,
      sourceSponsorPublicKey: '',
      sourceBalanceBeforeMina: null,
      sourceBalanceAfterMina: null,
      transfers: []
    }
  };
}

function normalizeRemoteBootstrap(input: RemoteOperatorBootstrapFile | null): RemoteOperatorBootstrapFile {
  const base = input ?? defaultRemoteBootstrap();
  const laneMap = new Map<SponsorLane, RemoteOperatorBootstrapLane>();
  for (const lane of lanes) {
    const existing = Array.isArray(base.lanes) ? base.lanes.find((entry) => entry.lane === lane) : null;
    if (existing && typeof existing.privateKey === 'string' && existing.privateKey.trim().length > 0) {
      const privateKey = existing.privateKey.trim();
      const publicKey = PrivateKey.fromBase58(privateKey).toPublicKey().toBase58();
      laneMap.set(lane, { lane, privateKey, publicKey });
      continue;
    }
    const key = PrivateKey.random();
    laneMap.set(lane, {
      lane,
      privateKey: key.toBase58(),
      publicKey: key.toPublicKey().toBase58()
    });
  }
  return {
    version: 1,
    network: {
      networkId,
      graphql,
      explorer
    },
    operator: {
      id: base.operator?.id?.trim() || remoteOperatorId,
      label: base.operator?.label?.trim() || remoteOperatorLabel,
      endpoint:
        typeof base.operator?.endpoint === 'string' && base.operator.endpoint.trim().length > 0
          ? base.operator.endpoint.trim()
          : remoteOperatorEndpoint,
      status: normalizeOperatorRegistryStatus(base.operator?.status, remoteOperatorStatus)
    },
    lanes: lanes.map((lane) => laneMap.get(lane)!),
    generatedAt: base.generatedAt || nowIso(),
    updatedAt: nowIso(),
    funding: {
      txFee,
      targetMina: remoteLaneTargetMina,
      sourceSponsorPublicKey: typeof base.funding?.sourceSponsorPublicKey === 'string' ? base.funding.sourceSponsorPublicKey : '',
      sourceBalanceBeforeMina:
        typeof base.funding?.sourceBalanceBeforeMina === 'number' ? base.funding.sourceBalanceBeforeMina : null,
      sourceBalanceAfterMina:
        typeof base.funding?.sourceBalanceAfterMina === 'number' ? base.funding.sourceBalanceAfterMina : null,
      transfers: Array.isArray(base.funding?.transfers) ? base.funding.transfers : []
    }
  };
}

async function loadOrCreateRemoteBootstrap() {
  const existing = await readJson<RemoteOperatorBootstrapFile | null>(remoteBootstrapPath, null);
  const next = normalizeRemoteBootstrap(existing);
  await writeJson(remoteBootstrapPath, next);
  return next;
}

function buildOperatorCapabilities(sponsorLanes: OperatorLaneAssignment[]) {
  const capabilities = new Set<string>();
  sponsorLanes.forEach((lane) => {
    if (!lane.configured) return;
    if (lane.lane === 'request') capabilities.add('request-settlement');
    if (lane.lane === 'output') capabilities.add('output-settlement');
    if (lane.lane === 'registry') capabilities.add('registry-settlement');
    if (lane.lane === 'credits') {
      capabilities.add('credits-direct-settlement');
      capabilities.add('credits-checkpoint-settlement');
      capabilities.add('credits-deposit-monitor');
    }
  });
  return Array.from(capabilities).sort((a, b) => a.localeCompare(b));
}

function assignmentsFromPublicKeys(entries: Array<{ lane: SponsorLane; publicKey: string }>): OperatorLaneAssignment[] {
  return entries.map((entry) => ({
    lane: entry.lane,
    configured: true,
    publicKey: entry.publicKey,
    source: 'stored-lane',
    usesSharedFallback: false
  }));
}

async function resolveLocalOperatorId() {
  const explicit = process.env.OPENGRADIENT_OPERATOR_ID?.trim();
  if (explicit) return explicit;
  const stored = await readTextFile(localOperatorIdPath);
  if (stored) return stored;
  const generated = `credits-operator-${networkId}-${crypto.randomUUID().slice(0, 12)}`;
  await writeTextFile(localOperatorIdPath, generated);
  return generated;
}

async function readOperatorRegistry() {
  return await readJson<OperatorRegistryFile>(operatorRegistryPath, {
    operators: [],
    lastUpdatedAt: null
  });
}

async function upsertOperatorRegistryRecord(
  registry: OperatorRegistryFile,
  next: OperatorRegistryRecord
): Promise<OperatorRegistryFile> {
  registry.operators = [next, ...registry.operators.filter((entry) => entry.id !== next.id)];
  registry.lastUpdatedAt = nowIso();
  return registry;
}

async function writeOperatorRegistry(registry: OperatorRegistryFile) {
  await writeJson(operatorRegistryPath, registry);
}

async function getSharedSponsorKey() {
  const fromEnv = getSecret('SPONSOR_PRIVATE_KEY');
  if (fromEnv) return fromEnv;
  const stored = await readTextFile(sharedSponsorKeyPath);
  if (stored) return stored;
  throw new Error(
    'Missing funding sponsor key. Set SPONSOR_PRIVATE_KEY or store one in data/deployments/sponsor-private-key.txt.'
  );
}

async function planFunding(
  localLanes: LaneProvision[],
  remoteBootstrap: RemoteOperatorBootstrapFile
): Promise<{
  funder: PrivateKey;
  funderPublicKey: string;
  funderBalance: bigint;
  transfers: Array<{ scope: 'local' | 'remote'; lane: SponsorLane; publicKey: string; needed: bigint }>;
}> {
  const funder = PrivateKey.fromBase58(await getSharedSponsorKey());
  const funderPublicKey = funder.toPublicKey().toBase58();
  const funderState = await readAccountState(funderPublicKey);
  if (!funderState.exists) {
    throw new Error('Funding sponsor account is not visible on Zeko testnet.');
  }

  const transfers: Array<{ scope: 'local' | 'remote'; lane: SponsorLane; publicKey: string; needed: bigint }> = [];

  for (const lane of localLanes) {
    const state = await readAccountState(lane.publicKey);
    const target = nanominaFromMina(localLaneTargetMina);
    const buffer = state.exists ? 0n : newAccountFundingBuffer;
    if (state.balance < target) {
      transfers.push({
        scope: 'local',
        lane: lane.lane,
        publicKey: lane.publicKey,
        needed: target - state.balance + buffer
      });
    }
  }

  for (const lane of remoteBootstrap.lanes) {
    const state = await readAccountState(lane.publicKey);
    const target = nanominaFromMina(remoteLaneTargetMina);
    const buffer = state.exists ? 0n : newAccountFundingBuffer;
    if (state.balance < target) {
      transfers.push({
        scope: 'remote',
        lane: lane.lane,
        publicKey: lane.publicKey,
        needed: target - state.balance + buffer
      });
    }
  }

  const totalNeeded = transfers.reduce((sum, entry) => sum + entry.needed + BigInt(txFee), 0n);
  if (funderState.balance < totalNeeded) {
    throw new Error(
      `Funding sponsor balance ${minaFromNanomina(funderState.balance).toFixed(4)} MINA is below required ${minaFromNanomina(totalNeeded).toFixed(4)} MINA.`
    );
  }

  return {
    funder,
    funderPublicKey,
    funderBalance: funderState.balance,
    transfers
  };
}

async function executeFunding(
  funder: PrivateKey,
  transfers: Array<{ scope: 'local' | 'remote'; lane: SponsorLane; publicKey: string; needed: bigint }>
) {
  const records: FundingTransferRecord[] = [];
  for (const transfer of transfers) {
    const memo = `${transfer.scope}-${transfer.lane}-lane`;
    const sent = await sendPayment(funder, transfer.publicKey, transfer.needed, memo);
    const targetBalance =
      transfer.scope === 'local' ? nanominaFromMina(localLaneTargetMina) : nanominaFromMina(remoteLaneTargetMina);
    const observed = await waitForTargetBalance(transfer.publicKey, targetBalance);
    if (!observed) {
      throw new Error(`Timed out waiting for ${transfer.scope} ${transfer.lane} lane funding to settle.`);
    }
    records.push({
      scope: transfer.scope,
      lane: transfer.lane,
      publicKey: transfer.publicKey,
      amountMina: minaFromNanomina(transfer.needed),
      hash: sent.hash
    });
  }
  return records;
}

async function updateOperatorRegistry(
  localOperatorId: string,
  localLanes: LaneProvision[],
  remoteBootstrap: RemoteOperatorBootstrapFile
) {
  const registry = await readOperatorRegistry();
  const now = nowIso();
  const existingLocal = registry.operators.find((entry) => entry.id === localOperatorId) || null;
  const localSponsorLanes = assignmentsFromPublicKeys(localLanes);
  const localRecord: OperatorRegistryRecord = {
    id: localOperatorId,
    label: existingLocal?.label || localOperatorId,
    endpoint: existingLocal?.endpoint || null,
    status: existingLocal?.status || 'active',
    local: true,
    networkId,
    contractVersions: ['v1', 'v2'],
    capabilities: buildOperatorCapabilities(localSponsorLanes),
    sponsorLanes: localSponsorLanes,
    metadata: existingLocal?.metadata || null,
    registeredAt: existingLocal?.registeredAt || now,
    updatedAt: now,
    lastSeenAt: now
  };

  const existingRemote = registry.operators.find((entry) => entry.id === remoteBootstrap.operator.id) || null;
  const remoteSponsorLanes = assignmentsFromPublicKeys(remoteBootstrap.lanes);
  const remoteRecord: OperatorRegistryRecord = {
    id: remoteBootstrap.operator.id,
    label: remoteBootstrap.operator.label,
    endpoint: remoteBootstrap.operator.endpoint,
    status: remoteBootstrap.operator.status,
    local: false,
    networkId,
    contractVersions: ['v1', 'v2'],
    capabilities: buildOperatorCapabilities(remoteSponsorLanes),
    sponsorLanes: remoteSponsorLanes,
    metadata: {
      ...(existingRemote?.metadata || {}),
      bootstrapPath: remoteBootstrapPath,
      bootstrapGeneratedAt: remoteBootstrap.generatedAt,
      handoffRequired: true
    },
    registeredAt: existingRemote?.registeredAt || now,
    updatedAt: now,
    lastSeenAt: existingRemote?.lastSeenAt || null
  };

  await upsertOperatorRegistryRecord(registry, remoteRecord);
  await upsertOperatorRegistryRecord(registry, localRecord);
  await writeOperatorRegistry(registry);

  return {
    localRecord,
    remoteRecord
  };
}

async function main() {
  await fs.mkdir(deploymentDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(operatorsDir, { recursive: true });

  const localOperatorId = await resolveLocalOperatorId();
  const localLanes = await provisionLocalLaneKeys();
  const remoteBootstrap = await loadOrCreateRemoteBootstrap();
  const fundingPlan = await planFunding(localLanes, remoteBootstrap);
  const fundingTransfers = await executeFunding(fundingPlan.funder, fundingPlan.transfers);
  const funderBalanceAfter = await readAccountState(fundingPlan.funderPublicKey);

  const nextRemoteBootstrap: RemoteOperatorBootstrapFile = {
    ...remoteBootstrap,
    updatedAt: nowIso(),
    funding: {
      txFee,
      targetMina: remoteLaneTargetMina,
      sourceSponsorPublicKey: fundingPlan.funderPublicKey,
      sourceBalanceBeforeMina: minaFromNanomina(fundingPlan.funderBalance),
      sourceBalanceAfterMina: minaFromNanomina(funderBalanceAfter.balance),
      transfers: fundingTransfers.filter((entry) => entry.scope === 'remote')
    }
  };
  await writeJson(remoteBootstrapPath, nextRemoteBootstrap);

  const registryUpdate = await updateOperatorRegistry(localOperatorId, localLanes, nextRemoteBootstrap);

  console.log(
    JSON.stringify(
      {
        ok: true,
        networkId,
        graphql,
        fundingSponsorPublicKey: fundingPlan.funderPublicKey,
        fundingSponsorBalanceBeforeMina: minaFromNanomina(fundingPlan.funderBalance),
        fundingSponsorBalanceAfterMina: minaFromNanomina(funderBalanceAfter.balance),
        localOperatorId,
        localLaneTargetMina,
        remoteOperatorId: nextRemoteBootstrap.operator.id,
        remoteOperatorStatus: nextRemoteBootstrap.operator.status,
        remoteBootstrapPath,
        remoteLaneTargetMina,
        localLanes: localLanes.map((entry) => ({
          lane: entry.lane,
          publicKey: entry.publicKey,
          filePath: entry.filePath,
          created: entry.created
        })),
        remoteLanes: nextRemoteBootstrap.lanes.map((entry) => ({
          lane: entry.lane,
          publicKey: entry.publicKey
        })),
        fundingTransfers,
        operatorRegistry: {
          local: {
            id: registryUpdate.localRecord.id,
            status: registryUpdate.localRecord.status,
            capabilities: registryUpdate.localRecord.capabilities
          },
          remote: {
            id: registryUpdate.remoteRecord.id,
            status: registryUpdate.remoteRecord.status,
            capabilities: registryUpdate.remoteRecord.capabilities
          }
        },
        notes: [
          'Lane-specific stored keys now take precedence over shared sponsor fallback.',
          'The remote operator bootstrap file contains private keys and should be handed off securely before marking that operator active.',
          'If SPONSOR_PRIVATE_KEY remains set in the runtime environment, it is now treated as fallback and will not override explicit lane files.',
          'First funding for a brand-new lane account includes a small creation buffer so the effective post-creation balance still reaches the configured target.'
        ]
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[operators:bootstrap] failed', error);
  process.exit(1);
});
