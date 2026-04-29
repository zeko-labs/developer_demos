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
import { AgentRequestContractV2 } from './zk/agentContractV2.js';
import {
  hasAnySponsorLanePrivateKey,
  listSponsorLaneStatuses,
  resolveSponsorPrivateKeyForLane,
  type SponsorLane
} from './sponsor-lanes.js';

export interface ThresholdReceiptPayloadV2 {
  requestHash: string;
  merkleRoot: string;
  attester1PublicKey: string;
  attester1Signature: unknown;
  attester2PublicKey: string;
  attester2Signature: unknown;
}

export interface RequestReceiptPayloadV2 extends ThresholdReceiptPayloadV2 {
  agentIdHash: string;
}

export interface OutputReceiptPayloadV2 extends ThresholdReceiptPayloadV2 {
  outputHash: string;
}

export interface AgentRegistrationPayloadV2 {
  agentIdHash: string;
  ownerHash: string;
  treasuryHash: string;
  stakeAmount: string;
  merkleRoot: string;
  attester1PublicKey: string;
  attester1Signature: unknown;
  attester2PublicKey: string;
  attester2Signature: unknown;
}

export interface CreditsUpdatePayloadV2 {
  creditsRoot: string;
  nullifierRoot: string;
  attester1PublicKey: string;
  attester1Signature: unknown;
  attester2PublicKey: string;
  attester2Signature: unknown;
  depositMina?: number;
  spendTo?: string | null;
  spendAmountMina?: number;
  platformAmountMina?: number;
  platformPayee?: string | null;
}

export interface ZekoRuntimeConfigV2 {
  networkId: string;
  graphql: string | null;
  archive: string | null;
  explorer: string | null;
  txFee: string;
  zkappPublicKey: string | null;
  hasZkappPrivateKey: boolean;
  hasSponsorPrivateKey: boolean;
}

export interface ZkappAccountStateV2 {
  publicKey: string;
  nonce: string | null;
  zkappState: string[];
}

export interface WaitForZkappStateOptionsV2 {
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

function readStoredZkappPrivateKeyV2() {
  return readLocalTextFile(path.join(getDeploymentDir(), 'agent-request-v2.zkapp-private-key.txt'));
}

function readStoredZkappPublicKeyV2() {
  const raw = readLocalTextFile(path.join(getDeploymentDir(), 'agent-request-v2.latest.json'));
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

function resolveZkappPublicKeyV2(): string | null {
  if (process.env.ZKAPP_V2_PUBLIC_KEY) return process.env.ZKAPP_V2_PUBLIC_KEY.trim();
  const zkappPrivateKey = getSecret('ZKAPP_V2_PRIVATE_KEY');
  const storedZkappPrivateKey = readStoredZkappPrivateKeyV2();
  const effectivePrivateKey = zkappPrivateKey || storedZkappPrivateKey;
  if (effectivePrivateKey) {
    try {
      return PrivateKey.fromBase58(effectivePrivateKey).toPublicKey().toBase58();
    } catch {
      return null;
    }
  }
  return readStoredZkappPublicKeyV2();
}

export function getZekoRuntimeConfigV2(): ZekoRuntimeConfigV2 {
  const graphql = normalizeGraphqlUrl(process.env.ZEKO_GRAPHQL || null, 'https://testnet.zeko.io/graphql');
  const archive = normalizeGraphqlUrl(
    process.env.ZEKO_ARCHIVE_GRAPHQL || null,
    'https://archive.testnet.zeko.io/graphql'
  );
  const hasStoredZkappPrivateKey = Boolean(readStoredZkappPrivateKeyV2());
  return {
    networkId: process.env.ZEKO_NETWORK_ID || 'testnet',
    graphql,
    archive,
    explorer: process.env.ZEKO_EXPLORER || 'https://zekoscan.io/testnet',
    txFee: process.env.TX_FEE || '100000000',
    zkappPublicKey: resolveZkappPublicKeyV2(),
    hasZkappPrivateKey: Boolean(getSecret('ZKAPP_V2_PRIVATE_KEY')) || hasStoredZkappPrivateKey,
    hasSponsorPrivateKey: hasAnySponsorLanePrivateKey()
  };
}

function requireSponsorKeyForLaneV2(lane: SponsorLane) {
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

function requireNetworkV2() {
  const config = getZekoRuntimeConfigV2();
  if (!config.graphql) {
    throw new Error('ZEKO_GRAPHQL env var not set');
  }
  return config;
}

function setActiveNetworkV2() {
  const config = requireNetworkV2();
  const network = Mina.Network({
    networkId: config.networkId as any,
    mina: config.graphql!,
    archive: config.archive || config.graphql!
  });
  Mina.setActiveInstance(network);
  return config;
}

function requireZkappKeysV2() {
  const zkappPublicKey = resolveZkappPublicKeyV2();
  const zkappPrivateKey = getSecret('ZKAPP_V2_PRIVATE_KEY') || readStoredZkappPrivateKeyV2();
  if (!zkappPublicKey) throw new Error('ZKAPP_V2_PUBLIC_KEY or ZKAPP_V2_PRIVATE_KEY must be set');
  if (zkappPrivateKey) {
    const derived = PrivateKey.fromBase58(zkappPrivateKey).toPublicKey().toBase58();
    if (derived !== zkappPublicKey) {
      throw new Error(`ZKAPP_V2_PRIVATE_KEY does not match ZKAPP_V2_PUBLIC_KEY (derived ${derived})`);
    }
  }
  return { zkappPublicKey };
}

export async function ensureZekoContractCompiledV2() {
  if (contractCompiled) return;
  await AgentRequestContractV2.compile();
  contractCompiled = true;
}

async function getZkappInstanceV2() {
  const config = setActiveNetworkV2();
  const { zkappPublicKey } = requireZkappKeysV2();
  await ensureZekoContractCompiledV2();
  const zkappAddress = PublicKey.fromBase58(zkappPublicKey);
  const zkapp = new AgentRequestContractV2(zkappAddress);
  const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
  if (zkappAccount.error) {
    throw new Error('ZkApp v2 account not found on-chain');
  }
  return {
    config,
    zkapp,
    zkappNonce: zkappAccount.account.nonce
  };
}

async function readAccountNonceV2(publicKey: PublicKey): Promise<bigint | null> {
  try {
    const result = await fetchAccount({ publicKey });
    if (result.error) return null;
    const nonceLike: any = result.account.nonce;
    if (nonceLike && typeof nonceLike.toBigInt === 'function') return nonceLike.toBigInt();
    if (nonceLike && typeof nonceLike.toString === 'function') return BigInt(nonceLike.toString());
    return null;
  } catch {
    return null;
  }
}

function isNoncePreconditionUnsatisfied(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Account_nonce_precondition_unsatisfied');
}

function extractSentTransactionHash(sent: unknown) {
  return (
    (sent as any)?.hash?.toString?.() ??
    (sent as any)?.hash ??
    (sent as any)?.transactionHash ??
    null
  );
}

let o1jsTransactionLock: Promise<void> = Promise.resolve();

async function withO1jsTransactionLock<T>(action: () => Promise<T>): Promise<T> {
  const previous = o1jsTransactionLock;
  let release!: () => void;
  o1jsTransactionLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

async function sendSignedZkappTxWithKeyV2(
  feePayerKey: PrivateKey,
  build: (context: {
    config: ZekoRuntimeConfigV2;
    zkapp: AgentRequestContractV2;
    zkappNonce: UInt32;
    feePayerPk: PublicKey;
  }) => Promise<void>,
  options: { maxAttempts?: number; retryDelayMs?: number } = {}
) {
  const feePayerPk = feePayerKey.toPublicKey();
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const retryDelayMs = Math.max(250, options.retryDelayMs ?? 1200);

  let nextNonce: bigint | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { config, zkapp, zkappNonce } = await getZkappInstanceV2();
    const chainNonce = await readAccountNonceV2(feePayerPk);
    if (chainNonce === null) {
      throw new Error(`Fee payer account not found on-chain: ${feePayerPk.toBase58()}`);
    }

    const selectedNonce: bigint = nextNonce !== null && nextNonce > chainNonce ? nextNonce : chainNonce;
    const tx = await withO1jsTransactionLock(async () => {
      const builtTx = await Mina.transaction(
        { sender: feePayerPk, fee: config.txFee, nonce: Number(selectedNonce) },
        async () => {
          await build({ config, zkapp, zkappNonce, feePayerPk });
        }
      );

      applyNonMagicFeePayerFix(builtTx as any);
      await builtTx.prove();
      await builtTx.sign([feePayerKey]);
      return builtTx;
    });

    try {
      const sent = await tx.send();
      return {
        hash: extractSentTransactionHash(sent),
        nonce: selectedNonce.toString()
      };
    } catch (error) {
      if (!isNoncePreconditionUnsatisfied(error) || attempt >= maxAttempts - 1) {
        throw error;
      }
      const refreshedNonce = await readAccountNonceV2(feePayerPk);
      nextNonce =
        refreshedNonce === null
          ? selectedNonce + 1n
          : refreshedNonce === selectedNonce
            ? refreshedNonce + 1n
            : refreshedNonce;
      await sleep(retryDelayMs * (attempt + 1));
    }
  }

  throw new Error(`Failed to submit zkApp transaction after ${maxAttempts} attempts.`);
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

export async function buildUnsignedRequestReceiptTxV2(payload: RequestReceiptPayloadV2, feePayer: string) {
  const { config, zkapp, zkappNonce } = await getZkappInstanceV2();
  const requestHash = Field.fromJSON(payload.requestHash);
  const agentIdHash = Field.fromJSON(payload.agentIdHash);
  const attester1PublicKey = PublicKey.fromBase58(payload.attester1PublicKey);
  const attester2PublicKey = PublicKey.fromBase58(payload.attester2PublicKey);
  const attester1Signature = Signature.fromJSON(payload.attester1Signature as any);
  const attester2Signature = Signature.fromJSON(payload.attester2Signature as any);
  const newRoot = Field.fromJSON(payload.merkleRoot);
  const feePayerPk = PublicKey.fromBase58(feePayer);

  const tx = await withO1jsTransactionLock(async () => {
    const builtTx = await Mina.transaction({ sender: feePayerPk, fee: config.txFee }, async () => {
      zkapp.account.nonce.requireEquals(zkappNonce);
      await zkapp.submitThresholdRequest(
        requestHash,
        agentIdHash,
        attester1PublicKey,
        attester1Signature,
        attester2PublicKey,
        attester2Signature,
        newRoot
      );
    });

    applyNonMagicFeePayerFix(builtTx as any);
    await builtTx.prove();
    return builtTx;
  });

  return {
    tx: tx.toJSON() as any,
    fee: config.txFee,
    networkId: config.networkId
  };
}

export async function buildUnsignedOutputReceiptTxV2(payload: OutputReceiptPayloadV2, feePayer: string) {
  const { config, zkapp, zkappNonce } = await getZkappInstanceV2();
  const requestHash = Field.fromJSON(payload.requestHash);
  const outputHash = Field.fromJSON(payload.outputHash);
  const attester1PublicKey = PublicKey.fromBase58(payload.attester1PublicKey);
  const attester2PublicKey = PublicKey.fromBase58(payload.attester2PublicKey);
  const attester1Signature = Signature.fromJSON(payload.attester1Signature as any);
  const attester2Signature = Signature.fromJSON(payload.attester2Signature as any);
  const newRoot = Field.fromJSON(payload.merkleRoot);
  const feePayerPk = PublicKey.fromBase58(feePayer);

  const tx = await withO1jsTransactionLock(async () => {
    const builtTx = await Mina.transaction({ sender: feePayerPk, fee: config.txFee }, async () => {
      zkapp.account.nonce.requireEquals(zkappNonce);
      await zkapp.submitThresholdOutput(
        requestHash,
        outputHash,
        attester1PublicKey,
        attester1Signature,
        attester2PublicKey,
        attester2Signature,
        newRoot
      );
    });

    applyNonMagicFeePayerFix(builtTx as any);
    await builtTx.prove();
    return builtTx;
  });

  return {
    tx: tx.toJSON() as any,
    fee: config.txFee,
    networkId: config.networkId
  };
}

export async function submitRequestReceiptTxWithSponsorV2(payload: RequestReceiptPayloadV2) {
  const sponsorKey = requireSponsorKeyForLaneV2('request');
  const sponsor = PrivateKey.fromBase58(sponsorKey);
  const requestHash = Field.fromJSON(payload.requestHash);
  const agentIdHash = Field.fromJSON(payload.agentIdHash);
  const attester1PublicKey = PublicKey.fromBase58(payload.attester1PublicKey);
  const attester2PublicKey = PublicKey.fromBase58(payload.attester2PublicKey);
  const attester1Signature = Signature.fromJSON(payload.attester1Signature as any);
  const attester2Signature = Signature.fromJSON(payload.attester2Signature as any);
  const newRoot = Field.fromJSON(payload.merkleRoot);

  return await sendSignedZkappTxWithKeyV2(sponsor, async ({ zkapp, zkappNonce }) => {
    zkapp.account.nonce.requireEquals(zkappNonce);
    await zkapp.submitThresholdRequest(
      requestHash,
      agentIdHash,
      attester1PublicKey,
      attester1Signature,
      attester2PublicKey,
      attester2Signature,
      newRoot
    );
  });
}

export async function submitOutputReceiptTxWithSponsorV2(payload: OutputReceiptPayloadV2) {
  const sponsorKey = requireSponsorKeyForLaneV2('output');
  const sponsor = PrivateKey.fromBase58(sponsorKey);
  const requestHash = Field.fromJSON(payload.requestHash);
  const outputHash = Field.fromJSON(payload.outputHash);
  const attester1PublicKey = PublicKey.fromBase58(payload.attester1PublicKey);
  const attester2PublicKey = PublicKey.fromBase58(payload.attester2PublicKey);
  const attester1Signature = Signature.fromJSON(payload.attester1Signature as any);
  const attester2Signature = Signature.fromJSON(payload.attester2Signature as any);
  const newRoot = Field.fromJSON(payload.merkleRoot);

  return await sendSignedZkappTxWithKeyV2(sponsor, async ({ zkapp, zkappNonce }) => {
    zkapp.account.nonce.requireEquals(zkappNonce);
    await zkapp.submitThresholdOutput(
      requestHash,
      outputHash,
      attester1PublicKey,
      attester1Signature,
      attester2PublicKey,
      attester2Signature,
      newRoot
    );
  });
}

export async function buildUnsignedAgentRegistrationTxV2(payload: AgentRegistrationPayloadV2, feePayer: string) {
  const { config, zkapp, zkappNonce } = await getZkappInstanceV2();
  const agentIdHash = Field.fromJSON(payload.agentIdHash);
  const ownerHash = Field.fromJSON(payload.ownerHash);
  const treasuryHash = Field.fromJSON(payload.treasuryHash);
  const stakeAmount = Field.fromJSON(payload.stakeAmount);
  const attester1PublicKey = PublicKey.fromBase58(payload.attester1PublicKey);
  const attester2PublicKey = PublicKey.fromBase58(payload.attester2PublicKey);
  const attester1Signature = Signature.fromJSON(payload.attester1Signature as any);
  const attester2Signature = Signature.fromJSON(payload.attester2Signature as any);
  const newRoot = Field.fromJSON(payload.merkleRoot);
  const feePayerPk = PublicKey.fromBase58(feePayer);

  const tx = await withO1jsTransactionLock(async () => {
    const builtTx = await Mina.transaction({ sender: feePayerPk, fee: config.txFee }, async () => {
      zkapp.account.nonce.requireEquals(zkappNonce);
      await zkapp.registerThresholdAgent(
        agentIdHash,
        ownerHash,
        treasuryHash,
        stakeAmount,
        attester1PublicKey,
        attester1Signature,
        attester2PublicKey,
        attester2Signature,
        newRoot
      );
    });

    applyNonMagicFeePayerFix(builtTx as any);
    await builtTx.prove();
    return builtTx;
  });

  return {
    tx: tx.toJSON() as any,
    fee: config.txFee,
    networkId: config.networkId
  };
}

export async function submitAgentRegistrationTxWithSponsorV2(payload: AgentRegistrationPayloadV2) {
  const sponsorKey = requireSponsorKeyForLaneV2('registry');
  const sponsor = PrivateKey.fromBase58(sponsorKey);
  const agentIdHash = Field.fromJSON(payload.agentIdHash);
  const ownerHash = Field.fromJSON(payload.ownerHash);
  const treasuryHash = Field.fromJSON(payload.treasuryHash);
  const stakeAmount = Field.fromJSON(payload.stakeAmount);
  const attester1PublicKey = PublicKey.fromBase58(payload.attester1PublicKey);
  const attester2PublicKey = PublicKey.fromBase58(payload.attester2PublicKey);
  const attester1Signature = Signature.fromJSON(payload.attester1Signature as any);
  const attester2Signature = Signature.fromJSON(payload.attester2Signature as any);
  const newRoot = Field.fromJSON(payload.merkleRoot);

  return await sendSignedZkappTxWithKeyV2(sponsor, async ({ zkapp, zkappNonce }) => {
    zkapp.account.nonce.requireEquals(zkappNonce);
    await zkapp.registerThresholdAgent(
      agentIdHash,
      ownerHash,
      treasuryHash,
      stakeAmount,
      attester1PublicKey,
      attester1Signature,
      attester2PublicKey,
      attester2Signature,
      newRoot
    );
  });
}

export async function buildUnsignedCreditsTxV2(payload: CreditsUpdatePayloadV2, feePayer: string) {
  const { config, zkapp, zkappNonce } = await getZkappInstanceV2();
  const creditsRoot = Field.fromJSON(payload.creditsRoot);
  const nullifierRoot = Field.fromJSON(payload.nullifierRoot);
  const attester1PublicKey = PublicKey.fromBase58(payload.attester1PublicKey);
  const attester2PublicKey = PublicKey.fromBase58(payload.attester2PublicKey);
  const attester1Signature = Signature.fromJSON(payload.attester1Signature as any);
  const attester2Signature = Signature.fromJSON(payload.attester2Signature as any);
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

  const tx = await withO1jsTransactionLock(async () => {
    const builtTx = await Mina.transaction({ sender: feePayerPk, fee: config.txFee }, async () => {
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
        await zkapp.submitThresholdCreditsSpend(
          creditsRoot,
          nullifierRoot,
          attester1PublicKey,
          attester1Signature,
          attester2PublicKey,
          attester2Signature,
          spendToPk,
          UInt64.from(BigInt(Math.round(spendAmountMina * 1e9))),
          platformPk,
          UInt64.from(BigInt(Math.round(platformAmountMina * 1e9)))
        );
      } else {
        await zkapp.submitThresholdCreditsUpdate(
          creditsRoot,
          nullifierRoot,
          attester1PublicKey,
          attester1Signature,
          attester2PublicKey,
          attester2Signature
        );
      }
    });

    applyNonMagicFeePayerFix(builtTx as any);
    await builtTx.prove();
    return builtTx;
  });

  return {
    tx: tx.toJSON() as any,
    fee: config.txFee,
    networkId: config.networkId
  };
}

export async function submitCreditsTxWithPrivateKeyV2(payload: CreditsUpdatePayloadV2, feePayerPrivateKey: string) {
  const feePayerKey = PrivateKey.fromBase58(feePayerPrivateKey);
  const feePayerPk = feePayerKey.toPublicKey();
  const creditsRoot = Field.fromJSON(payload.creditsRoot);
  const nullifierRoot = Field.fromJSON(payload.nullifierRoot);
  const attester1PublicKey = PublicKey.fromBase58(payload.attester1PublicKey);
  const attester2PublicKey = PublicKey.fromBase58(payload.attester2PublicKey);
  const attester1Signature = Signature.fromJSON(payload.attester1Signature as any);
  const attester2Signature = Signature.fromJSON(payload.attester2Signature as any);
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

  return await sendSignedZkappTxWithKeyV2(feePayerKey, async ({ zkapp, zkappNonce }) => {
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
      await zkapp.submitThresholdCreditsSpend(
        creditsRoot,
        nullifierRoot,
        attester1PublicKey,
        attester1Signature,
        attester2PublicKey,
        attester2Signature,
        spendToPk,
        UInt64.from(BigInt(Math.round(spendAmountMina * 1e9))),
        platformPk,
        UInt64.from(BigInt(Math.round(platformAmountMina * 1e9)))
      );
    } else {
      await zkapp.submitThresholdCreditsUpdate(
        creditsRoot,
        nullifierRoot,
        attester1PublicKey,
        attester1Signature,
        attester2PublicKey,
        attester2Signature
      );
    }
  });
}

export async function submitCreditsTxWithSponsorV2(payload: CreditsUpdatePayloadV2) {
  const sponsorKey = requireSponsorKeyForLaneV2('credits');
  if ((payload.depositMina || 0) > 0) {
    throw new Error('Sponsor submission does not support depositMina > 0. Build an unsigned credits tx instead.');
  }

  const sponsor = PrivateKey.fromBase58(sponsorKey);
  const sponsorPk = sponsor.toPublicKey();
  const creditsRoot = Field.fromJSON(payload.creditsRoot);
  const nullifierRoot = Field.fromJSON(payload.nullifierRoot);
  const attester1PublicKey = PublicKey.fromBase58(payload.attester1PublicKey);
  const attester2PublicKey = PublicKey.fromBase58(payload.attester2PublicKey);
  const attester1Signature = Signature.fromJSON(payload.attester1Signature as any);
  const attester2Signature = Signature.fromJSON(payload.attester2Signature as any);
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

  return await sendSignedZkappTxWithKeyV2(sponsor, async ({ zkapp, zkappNonce }) => {
    zkapp.account.nonce.requireEquals(zkappNonce);
    if (spendToPk && spendAmountMina > 0) {
      await zkapp.submitThresholdCreditsSpend(
        creditsRoot,
        nullifierRoot,
        attester1PublicKey,
        attester1Signature,
        attester2PublicKey,
        attester2Signature,
        spendToPk,
        UInt64.from(BigInt(Math.round(spendAmountMina * 1e9))),
        platformPk!,
        UInt64.from(BigInt(Math.round(platformAmountMina * 1e9)))
      );
    } else {
      await zkapp.submitThresholdCreditsUpdate(
        creditsRoot,
        nullifierRoot,
        attester1PublicKey,
        attester1Signature,
        attester2PublicKey,
        attester2Signature
      );
    }
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchZkappAccountStateV2(): Promise<ZkappAccountStateV2> {
  const config = requireNetworkV2();
  if (!config.zkappPublicKey) {
    throw new Error('ZKAPP_V2_PUBLIC_KEY or ZKAPP_V2_PRIVATE_KEY must be set');
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
    throw new Error('zkapp v2 account query returned no account');
  }

  return {
    publicKey: json.data.account.publicKey || config.zkappPublicKey,
    nonce: json.data.account.nonce || null,
    zkappState: Array.isArray(json.data.account.zkappState) ? json.data.account.zkappState : []
  };
}

export async function waitForZkappStateValueV2(
  index: number,
  expectedValue: string,
  options: WaitForZkappStateOptionsV2 = {}
) {
  const attempts = Math.max(1, options.attempts ?? 60);
  const pollIntervalMs = Math.max(250, options.pollIntervalMs ?? 3000);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await fetchZkappAccountStateV2();
    if (state.zkappState[index] === expectedValue) {
      return state;
    }
    if (attempt < attempts - 1) {
      await sleep(pollIntervalMs);
    }
  }

  return null;
}

export async function fetchZekoTransactionStatusV2(hash: string) {
  const config = setActiveNetworkV2();
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

export async function getZekoPreflightV2() {
  const config = getZekoRuntimeConfigV2();
  const issues: string[] = [];
  if (!config.graphql) issues.push('ZEKO_GRAPHQL is not set.');
  if (!config.zkappPublicKey) issues.push('ZKAPP_V2_PUBLIC_KEY or ZKAPP_V2_PRIVATE_KEY is not set.');
  return {
    ok: issues.length === 0,
    config,
    issues,
    notes: [
      'v2 uses a fixed 2-of-3 on-chain attester set for threshold receipt verification.',
      'Runtime settlement and unsigned tx build require the zkApp public key; deploy/rekey flows require the zkApp private key.',
      'Sponsored submit supports lane-specific keys via OPENGRADIENT_{REQUEST,OUTPUT,REGISTRY,CREDITS}_SPONSOR_PRIVATE_KEY, with SPONSOR_PRIVATE_KEY as shared fallback.'
    ]
  };
}

export function describeZekoPayloadErrorV2(error: unknown) {
  if (error instanceof Error) return error.message;
  return `Zeko v2 runtime error: ${String(error)}`;
}
