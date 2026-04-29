import 'reflect-metadata';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  AccountUpdate,
  Bool,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  Signature,
  UInt32,
  UInt64,
  fetchAccount,
  fetchTransactionStatus
} from 'o1js';
import { AgentRequestContract } from './zk/agentContract.js';
import {
  hasAnySponsorLanePrivateKey,
  listSponsorLaneStatuses,
  resolveSponsorPrivateKeyForLane,
  type SponsorLane
} from './sponsor-lanes.js';

export interface RequestReceiptPayload {
  requestHash: string;
  agentIdHash: string;
  oraclePublicKey: string;
  signature: unknown;
  merkleRoot: string;
}

export interface OutputReceiptPayload {
  requestHash: string;
  outputHash: string;
  oraclePublicKey: string;
  signature: unknown;
  merkleRoot: string;
}

export interface AgentRegistrationPayload {
  agentIdHash: string;
  ownerHash: string;
  treasuryHash: string;
  stakeAmount: string;
  oraclePublicKey: string;
  signature: unknown;
  merkleRoot: string;
}

export interface CreditsUpdatePayload {
  creditsRoot: string;
  nullifierRoot: string;
  oraclePublicKey: string;
  signature: unknown;
  depositMina?: number;
  spendTo?: string;
  spendAmountMina?: number;
  platformAmountMina?: number;
  platformPayee?: string;
}

export interface ZekoRuntimeConfig {
  networkId: string;
  graphql: string | null;
  archive: string | null;
  explorer: string | null;
  txFee: string;
  zkappPublicKey: string | null;
  hasZkappPrivateKey: boolean;
  hasSponsorPrivateKey: boolean;
}

export interface ZkappAccountState {
  publicKey: string;
  nonce: string | null;
  zkappState: string[];
}

export interface WaitForZkappStateOptions {
  attempts?: number;
  pollIntervalMs?: number;
}

let contractCompiled = false;

function getSecret(name: string): string | null {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readLocalTextFile(filePath: string): string | null {
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function getDeploymentDir() {
  return path.join(process.cwd(), 'data', 'deployments');
}

function readStoredZkappPrivateKey() {
  return readLocalTextFile(path.join(getDeploymentDir(), 'agent-request.zkapp-private-key.txt'));
}

function readStoredZkappPublicKey() {
  const raw = readLocalTextFile(path.join(getDeploymentDir(), 'agent-request.latest.json'));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { zkappPublicKey?: string };
    return typeof parsed.zkappPublicKey === 'string' && parsed.zkappPublicKey.trim().length > 0
      ? parsed.zkappPublicKey.trim()
      : null;
  } catch {
    return null;
  }
}

function normalizeGraphqlUrl(value: string | null, fallback: string | null = null): string | null {
  const raw = value?.trim() || fallback?.trim() || null;
  if (!raw) return null;
  if (raw.endsWith('/graphql')) return raw;
  return `${raw.replace(/\/+$/, '')}/graphql`;
}

function resolveZkappPublicKey(): string | null {
  if (process.env.ZKAPP_PUBLIC_KEY) return process.env.ZKAPP_PUBLIC_KEY.trim();
  const zkappPrivateKey = getSecret('ZKAPP_PRIVATE_KEY');
  const storedZkappPrivateKey = readStoredZkappPrivateKey();
  const effectivePrivateKey = zkappPrivateKey || storedZkappPrivateKey;
  if (effectivePrivateKey) {
    try {
      return PrivateKey.fromBase58(effectivePrivateKey).toPublicKey().toBase58();
    } catch {
      return null;
    }
  }
  try {
    return readStoredZkappPublicKey();
  } catch {
    return null;
  }
}

export function getZekoRuntimeConfig(): ZekoRuntimeConfig {
  const graphql = normalizeGraphqlUrl(process.env.ZEKO_GRAPHQL || null, 'https://testnet.zeko.io/graphql');
  const archive = normalizeGraphqlUrl(
    process.env.ZEKO_ARCHIVE_GRAPHQL || null,
    'https://archive.testnet.zeko.io/graphql'
  );
  const hasStoredZkappPrivateKey = Boolean(readStoredZkappPrivateKey());
  return {
    networkId: process.env.ZEKO_NETWORK_ID || 'testnet',
    graphql,
    archive,
    explorer: process.env.ZEKO_EXPLORER || 'https://zekoscan.io/testnet',
    txFee: process.env.TX_FEE || '100000000',
    zkappPublicKey: resolveZkappPublicKey(),
    hasZkappPrivateKey: Boolean(getSecret('ZKAPP_PRIVATE_KEY')) || hasStoredZkappPrivateKey,
    hasSponsorPrivateKey: hasAnySponsorLanePrivateKey()
  };
}

function requireSponsorKeyForLane(lane: SponsorLane) {
  const resolved = resolveSponsorPrivateKeyForLane(lane);
  if (!resolved.privateKey) {
    const laneStatuses = listSponsorLaneStatuses();
    const available = laneStatuses
      .filter((entry) => entry.privateKeyConfigured)
      .map((entry) => `${entry.lane}:${entry.source}`)
      .join(', ');
    throw new Error(
      `No sponsor key configured for ${lane} lane. Set ${resolved.envVar || 'SPONSOR_PRIVATE_KEY'} or store ${
        resolved.filePath || 'a sponsor key'
      }. Available lanes: ${available || 'none'}.`
    );
  }
  return resolved.privateKey;
}

function requireNetwork() {
  const config = getZekoRuntimeConfig();
  if (!config.graphql) {
    throw new Error('ZEKO_GRAPHQL env var not set');
  }
  return config;
}

function setActiveNetwork() {
  const config = requireNetwork();
  const network = Mina.Network({
    networkId: config.networkId as any,
    mina: config.graphql!,
    archive: config.archive || config.graphql!
  });
  Mina.setActiveInstance(network);
  return config;
}

function requireZkappKeys() {
  const zkappPublicKey = resolveZkappPublicKey();
  const zkappPrivateKey = getSecret('ZKAPP_PRIVATE_KEY') || readStoredZkappPrivateKey();
  if (!zkappPublicKey) throw new Error('ZKAPP_PUBLIC_KEY or ZKAPP_PRIVATE_KEY must be set');
  if (zkappPrivateKey) {
    const derived = PrivateKey.fromBase58(zkappPrivateKey).toPublicKey().toBase58();
    if (derived !== zkappPublicKey) {
      throw new Error(`ZKAPP_PRIVATE_KEY does not match ZKAPP_PUBLIC_KEY (derived ${derived})`);
    }
  }
  return { zkappPublicKey };
}

export async function ensureZekoContractCompiled() {
  if (contractCompiled) return;
  await AgentRequestContract.compile();
  contractCompiled = true;
}

async function getZkappInstance() {
  const config = setActiveNetwork();
  const { zkappPublicKey } = requireZkappKeys();
  await ensureZekoContractCompiled();
  const zkappAddress = PublicKey.fromBase58(zkappPublicKey);
  const zkapp = new AgentRequestContract(zkappAddress);
  const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
  if (zkappAccount.error) {
    throw new Error('ZkApp account not found on-chain');
  }
  return {
    config,
    zkapp,
    zkappNonce: zkappAccount.account.nonce
  };
}

function applyNonMagicFeePayerFix(tx: any) {
  const feePayerUpdate = tx?.feePayer;
  if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
    feePayerUpdate.body.preconditions.account.nonce = {
      isSome: Bool(false),
      value: UInt32.from(0)
    };
  }
  if (feePayerUpdate?.body) {
    feePayerUpdate.body.useFullCommitment = Bool(true);
  }
}

export async function buildUnsignedRequestReceiptTx(payload: RequestReceiptPayload, feePayer: string) {
  const { config, zkapp, zkappNonce } = await getZkappInstance();
  const requestHash = Field.fromJSON(payload.requestHash);
  const agentIdHash = Field.fromJSON(payload.agentIdHash);
  const oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
  const signature = Signature.fromJSON(payload.signature as any);
  const newRoot = Field.fromJSON(payload.merkleRoot);
  const feePayerPk = PublicKey.fromBase58(feePayer);

  const tx = await Mina.transaction({ sender: feePayerPk, fee: config.txFee }, async () => {
    zkapp.account.nonce.requireEquals(zkappNonce);
    await zkapp.submitSignedRequest(requestHash, agentIdHash, oraclePk, signature, newRoot);
  });

  applyNonMagicFeePayerFix(tx as any);
  await tx.prove();

  return {
    tx: tx.toJSON() as any,
    fee: config.txFee,
    networkId: config.networkId
  };
}

export async function buildUnsignedOutputReceiptTx(payload: OutputReceiptPayload, feePayer: string) {
  const { config, zkapp, zkappNonce } = await getZkappInstance();
  const requestHash = Field.fromJSON(payload.requestHash);
  const outputHash = Field.fromJSON(payload.outputHash);
  const oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
  const signature = Signature.fromJSON(payload.signature as any);
  const newRoot = Field.fromJSON(payload.merkleRoot);
  const feePayerPk = PublicKey.fromBase58(feePayer);

  const tx = await Mina.transaction({ sender: feePayerPk, fee: config.txFee }, async () => {
    zkapp.account.nonce.requireEquals(zkappNonce);
    await zkapp.submitSignedOutput(requestHash, outputHash, oraclePk, signature, newRoot);
  });

  applyNonMagicFeePayerFix(tx as any);
  await tx.prove();

  return {
    tx: tx.toJSON() as any,
    fee: config.txFee,
    networkId: config.networkId
  };
}

export async function submitRequestReceiptTxWithSponsor(payload: RequestReceiptPayload) {
  const sponsorKey = requireSponsorKeyForLane('request');
  const { config, zkapp, zkappNonce } = await getZkappInstance();
  const sponsor = PrivateKey.fromBase58(sponsorKey);
  const sponsorPk = sponsor.toPublicKey();
  const requestHash = Field.fromJSON(payload.requestHash);
  const agentIdHash = Field.fromJSON(payload.agentIdHash);
  const oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
  const signature = Signature.fromJSON(payload.signature as any);
  const newRoot = Field.fromJSON(payload.merkleRoot);

  const tx = await Mina.transaction({ sender: sponsorPk, fee: config.txFee }, async () => {
    zkapp.account.nonce.requireEquals(zkappNonce);
    await zkapp.submitSignedRequest(requestHash, agentIdHash, oraclePk, signature, newRoot);
  });

  applyNonMagicFeePayerFix(tx as any);
  await tx.prove();
  await tx.sign([sponsor]);
  const sent = await tx.send();
  const hash =
    (sent as any)?.hash?.toString?.() ??
    (sent as any)?.hash ??
    (sent as any)?.transactionHash ??
    null;
  return { hash };
}

export async function submitOutputReceiptTxWithSponsor(payload: OutputReceiptPayload) {
  const sponsorKey = requireSponsorKeyForLane('output');
  const { config, zkapp, zkappNonce } = await getZkappInstance();
  const sponsor = PrivateKey.fromBase58(sponsorKey);
  const sponsorPk = sponsor.toPublicKey();
  const requestHash = Field.fromJSON(payload.requestHash);
  const outputHash = Field.fromJSON(payload.outputHash);
  const oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
  const signature = Signature.fromJSON(payload.signature as any);
  const newRoot = Field.fromJSON(payload.merkleRoot);

  const tx = await Mina.transaction({ sender: sponsorPk, fee: config.txFee }, async () => {
    zkapp.account.nonce.requireEquals(zkappNonce);
    await zkapp.submitSignedOutput(requestHash, outputHash, oraclePk, signature, newRoot);
  });

  applyNonMagicFeePayerFix(tx as any);
  await tx.prove();
  await tx.sign([sponsor]);
  const sent = await tx.send();
  const hash =
    (sent as any)?.hash?.toString?.() ??
    (sent as any)?.hash ??
    (sent as any)?.transactionHash ??
    null;
  return { hash };
}

export async function buildUnsignedAgentRegistrationTx(payload: AgentRegistrationPayload, feePayer: string) {
  const { config, zkapp, zkappNonce } = await getZkappInstance();
  const agentIdHash = Field.fromJSON(payload.agentIdHash);
  const ownerHash = Field.fromJSON(payload.ownerHash);
  const treasuryHash = Field.fromJSON(payload.treasuryHash);
  const stakeAmount = Field.fromJSON(payload.stakeAmount);
  const oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
  const signature = Signature.fromJSON(payload.signature as any);
  const newRoot = Field.fromJSON(payload.merkleRoot);
  const feePayerPk = PublicKey.fromBase58(feePayer);

  const tx = await Mina.transaction({ sender: feePayerPk, fee: config.txFee }, async () => {
    zkapp.account.nonce.requireEquals(zkappNonce);
    await zkapp.registerAgent(agentIdHash, ownerHash, treasuryHash, stakeAmount, oraclePk, signature, newRoot);
  });

  applyNonMagicFeePayerFix(tx as any);
  await tx.prove();

  return {
    tx: tx.toJSON() as any,
    fee: config.txFee,
    networkId: config.networkId
  };
}

export async function submitAgentRegistrationTxWithSponsor(payload: AgentRegistrationPayload) {
  const sponsorKey = requireSponsorKeyForLane('registry');
  const { config, zkapp, zkappNonce } = await getZkappInstance();
  const sponsor = PrivateKey.fromBase58(sponsorKey);
  const sponsorPk = sponsor.toPublicKey();
  const agentIdHash = Field.fromJSON(payload.agentIdHash);
  const ownerHash = Field.fromJSON(payload.ownerHash);
  const treasuryHash = Field.fromJSON(payload.treasuryHash);
  const stakeAmount = Field.fromJSON(payload.stakeAmount);
  const oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
  const signature = Signature.fromJSON(payload.signature as any);
  const newRoot = Field.fromJSON(payload.merkleRoot);

  const tx = await Mina.transaction({ sender: sponsorPk, fee: config.txFee }, async () => {
    zkapp.account.nonce.requireEquals(zkappNonce);
    await zkapp.registerAgent(agentIdHash, ownerHash, treasuryHash, stakeAmount, oraclePk, signature, newRoot);
  });

  applyNonMagicFeePayerFix(tx as any);
  await tx.prove();
  await tx.sign([sponsor]);
  const sent = await tx.send();
  const hash =
    (sent as any)?.hash?.toString?.() ??
    (sent as any)?.hash ??
    (sent as any)?.transactionHash ??
    null;
  return { hash };
}

export async function buildUnsignedCreditsTx(payload: CreditsUpdatePayload, feePayer: string) {
  const { config, zkapp, zkappNonce } = await getZkappInstance();
  const creditsRoot = Field.fromJSON(payload.creditsRoot);
  const nullifierRoot = Field.fromJSON(payload.nullifierRoot);
  const oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
  const signature = Signature.fromJSON(payload.signature as any);
  const feePayerPk = PublicKey.fromBase58(feePayer);
  const depositMina = typeof payload.depositMina === 'number' ? payload.depositMina : 0;
  const spendAmountMina = typeof payload.spendAmountMina === 'number' ? payload.spendAmountMina : 0;
  const platformAmountMina = typeof payload.platformAmountMina === 'number' ? payload.platformAmountMina : 0;

  let spendToPk: PublicKey | null = null;
  if (payload.spendTo) {
    spendToPk = PublicKey.fromBase58(payload.spendTo);
  }
  let platformPk: PublicKey | null = null;
  if (payload.platformPayee) {
    platformPk = PublicKey.fromBase58(payload.platformPayee);
  }

  const tx = await Mina.transaction({ sender: feePayerPk, fee: config.txFee }, async () => {
    if (depositMina > 0) {
      const payment = AccountUpdate.createSigned(feePayerPk);
      payment.send({
        to: zkapp.address,
        amount: UInt64.from(BigInt(Math.round(depositMina * 1e9)))
      });
    }
    zkapp.account.nonce.requireEquals(zkappNonce);
    if (spendToPk && spendAmountMina > 0) {
      if (!platformPk) {
        throw new Error('platformPayee is required for credits spend.');
      }
      await zkapp.submitSignedCreditsSpend(
        creditsRoot,
        nullifierRoot,
        oraclePk,
        signature,
        spendToPk,
        UInt64.from(BigInt(Math.round(spendAmountMina * 1e9))),
        platformPk,
        UInt64.from(BigInt(Math.round(platformAmountMina * 1e9)))
      );
    } else {
      await zkapp.submitSignedCreditsUpdate(creditsRoot, nullifierRoot, oraclePk, signature);
    }
  });

  applyNonMagicFeePayerFix(tx as any);
  await tx.prove();

  return {
    tx: tx.toJSON() as any,
    fee: config.txFee,
    networkId: config.networkId
  };
}

export async function submitCreditsTxWithSponsor(payload: CreditsUpdatePayload) {
  const sponsorKey = requireSponsorKeyForLane('credits');
  if ((payload.depositMina || 0) > 0) {
    throw new Error('Sponsor submission does not support depositMina > 0. Build an unsigned credits tx instead.');
  }

  const { config, zkapp, zkappNonce } = await getZkappInstance();
  const sponsor = PrivateKey.fromBase58(sponsorKey);
  const sponsorPk = sponsor.toPublicKey();
  const creditsRoot = Field.fromJSON(payload.creditsRoot);
  const nullifierRoot = Field.fromJSON(payload.nullifierRoot);
  const oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
  const signature = Signature.fromJSON(payload.signature as any);
  const spendAmountMina = typeof payload.spendAmountMina === 'number' ? payload.spendAmountMina : 0;
  const platformAmountMina = typeof payload.platformAmountMina === 'number' ? payload.platformAmountMina : 0;

  let spendToPk: PublicKey | null = null;
  if (payload.spendTo) {
    spendToPk = PublicKey.fromBase58(payload.spendTo);
  }
  let platformPk: PublicKey | null = null;
  if (payload.platformPayee) {
    platformPk = PublicKey.fromBase58(payload.platformPayee);
  }
  if (!platformPk) {
    platformPk = sponsorPk;
  }

  const tx = await Mina.transaction({ sender: sponsorPk, fee: config.txFee }, async () => {
    zkapp.account.nonce.requireEquals(zkappNonce);
    if (spendToPk && spendAmountMina > 0) {
      await zkapp.submitSignedCreditsSpend(
        creditsRoot,
        nullifierRoot,
        oraclePk,
        signature,
        spendToPk,
        UInt64.from(BigInt(Math.round(spendAmountMina * 1e9))),
        platformPk!,
        UInt64.from(BigInt(Math.round(platformAmountMina * 1e9)))
      );
    } else {
      await zkapp.submitSignedCreditsUpdate(creditsRoot, nullifierRoot, oraclePk, signature);
    }
  });

  applyNonMagicFeePayerFix(tx as any);
  await tx.prove();
  await tx.sign([sponsor]);
  const sent = await tx.send();
  const hash =
    (sent as any)?.hash?.toString?.() ??
    (sent as any)?.hash ??
    (sent as any)?.transactionHash ??
    null;
  return { hash };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchZkappAccountState(): Promise<ZkappAccountState> {
  const config = requireNetwork();
  if (!config.zkappPublicKey) {
    throw new Error('ZKAPP_PUBLIC_KEY or ZKAPP_PRIVATE_KEY must be set');
  }

  const response = await fetch(config.graphql!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query:
        'query Account($pk: PublicKey!) { account(publicKey: $pk) { publicKey nonce zkappState } }',
      variables: { pk: config.zkappPublicKey }
    })
  });

  const json = (await response.json()) as {
    data?: {
      account?: {
        publicKey?: string;
        nonce?: string;
        zkappState?: string[];
      } | null;
    };
    errors?: Array<{ message?: string }>;
  };

  if (!response.ok) {
    throw new Error(`graphql http ${response.status}`);
  }
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(json.errors.map((entry) => entry.message || 'unknown graphql error').join('; '));
  }
  if (!json.data?.account) {
    throw new Error('zkapp account query returned no account');
  }

  return {
    publicKey: json.data.account.publicKey || config.zkappPublicKey,
    nonce: json.data.account.nonce || null,
    zkappState: Array.isArray(json.data.account.zkappState) ? json.data.account.zkappState : []
  };
}

export async function waitForZkappStateValue(
  index: number,
  expectedValue: string,
  options: WaitForZkappStateOptions = {}
) {
  const attempts = Math.max(1, options.attempts ?? 60);
  const pollIntervalMs = Math.max(250, options.pollIntervalMs ?? 3000);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await fetchZkappAccountState();
    if (state.zkappState[index] === expectedValue) {
      return state;
    }
    if (attempt < attempts - 1) {
      await sleep(pollIntervalMs);
    }
  }

  return null;
}

export async function fetchZekoTransactionStatus(hash: string) {
  const config = setActiveNetwork();
  try {
    const status = await fetchTransactionStatus(hash);
    return { status, networkId: config.networkId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Field 'transactionStatus' is not defined on type 'query'")) {
      return {
        status: 'unsupported_on_endpoint',
        networkId: config.networkId,
        note: 'This Zeko GraphQL endpoint does not expose the transactionStatus query.'
      };
    }
    throw error;
  }
}

export async function getZekoPreflight() {
  const config = getZekoRuntimeConfig();
  const issues: string[] = [];
  if (!config.graphql) issues.push('ZEKO_GRAPHQL is not set.');
  if (!config.zkappPublicKey) issues.push('ZKAPP_PUBLIC_KEY or ZKAPP_PRIVATE_KEY is not set.');
  return {
    ok: issues.length === 0,
    config,
    issues,
    notes: [
      'Runtime settlement and unsigned tx build use current Zeko testnet defaults and require the zkApp public key; deploy/rekey flows require the zkApp private key.',
      'Sponsored submit supports lane-specific keys via OPENGRADIENT_{REQUEST,OUTPUT,REGISTRY,CREDITS}_SPONSOR_PRIVATE_KEY, with SPONSOR_PRIVATE_KEY as shared fallback.',
      'This runtime uses the existing single-signer-compatible request/output payloads.'
    ]
  };
}

export function describeZekoPayloadError(error: unknown) {
  if (error instanceof Error) return error.message;
  return `Zeko runtime error: ${String(error)}`;
}
