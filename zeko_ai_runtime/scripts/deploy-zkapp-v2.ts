import 'reflect-metadata';
import 'dotenv/config';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import process from 'node:process';
import {
  Bool,
  Mina,
  Permissions,
  PrivateKey,
  PublicKey,
  UInt32,
  UInt64,
  fetchAccount
} from 'o1js';
import { AgentRequestContractV2 } from '../src/zk/agentContractV2.js';

type DeployStatus = 'generated-new-key' | 'reused-stored-key' | 'used-env-key';

interface StoredDeploymentRecordV2 {
  zkappPublicKey: string;
  deployerPublicKey: string;
  attesterPublicKeys: string[];
  networkId: string;
  graphql: string;
  archive: string;
  explorer: string;
  txFee: string;
  prefundAmount: string;
  prefundTxHash: string | null;
  deployTxHash: string | null;
  deployStatus: string | null;
  deployedAt: string;
  keySource: DeployStatus;
}

interface AttesterKeyFile {
  attesters?: Array<{ privateKey?: string }>;
}

const sendPaymentMutation = `
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
      fee
      amount
      memo
      failureReason
    }
  }
}
`;

function normalizeGraphqlUrl(value: string | null, fallback: string): string {
  const raw = value?.trim() || fallback;
  if (raw.endsWith('/graphql')) return raw;
  return `${raw.replace(/\/+$/, '')}/graphql`;
}

function getSecret(name: string): string | null {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readLocalTextFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

function getDeploymentDir() {
  return path.join(process.cwd(), 'data', 'deployments');
}

function readStoredSponsorPrivateKey() {
  return readLocalTextFile(path.join(getDeploymentDir(), 'sponsor-private-key.txt'));
}

function isGatewayTimeoutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('504') || message.toLowerCase().includes('gateway timeout');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function promptHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error('A TTY is required to securely prompt for the deployer key.');
  }

  process.stdout.write(prompt);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return await new Promise((resolve, reject) => {
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

async function waitForAccountVisible(publicKey: PublicKey, attempts = 30, intervalMs = 3000) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const result = await fetchAccount({ publicKey });
      if (!result.error) return true;
    } catch {}
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

async function readAccountNonce(publicKey: PublicKey): Promise<bigint | null> {
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

async function waitForNonceAtLeast(publicKey: PublicKey, minimumNonce: bigint, attempts = 40, intervalMs = 3000) {
  for (let i = 0; i < attempts; i += 1) {
    const nonce = await readAccountNonce(publicKey);
    if (nonce !== null && nonce >= minimumNonce) return nonce;
    await sleep(intervalMs);
  }
  return null;
}

async function graphqlRequest<T>(endpoint: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok) throw new Error(`graphql http ${response.status}`);
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(json.errors.map((entry) => entry.message || 'unknown graphql error').join('; '));
  }
  if (!json.data) throw new Error('graphql response missing data');
  return json.data;
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

async function sendPrefundPayment(
  deployerKey: PrivateKey,
  recipient: PublicKey,
  txFee: UInt64,
  amount: UInt64,
  networkId: string,
  graphql: string
) {
  const sender = deployerKey.toPublicKey();
  const sender58 = sender.toBase58();
  const recipient58 = recipient.toBase58();
  const MinaSignerClient = await getMinaSignerClientCtor();
  const signer = new MinaSignerClient({
    network: networkId === 'mainnet' ? 'mainnet' : 'testnet'
  });

  const attemptSend = async (overrideNonce?: number) => {
    const account = await fetchAccount({ publicKey: sender });
    if (account.error) throw new Error('deployer account not found while prefunding zkapp.');
    const chainNonce = Number(account.account.nonce.toString());
    const nonce = overrideNonce ?? chainNonce;
    const signedPayment = signer.signPayment(
      {
        to: recipient58,
        from: sender58,
        fee: txFee.toString(),
        amount: amount.toString(),
        nonce: String(nonce),
        memo: 'prefund-zkapp-v2'
      },
      deployerKey.toBase58()
    );

    const data = await graphqlRequest<{
      sendPayment: {
        payment: {
          hash: string | null;
          failureReason: unknown;
        } | null;
      };
    }>(graphql, sendPaymentMutation, {
      fee: txFee.toString(),
      amount: amount.toString(),
      to: recipient58,
      from: sender58,
      nonce: String(nonce),
      memo: 'prefund-zkapp-v2',
      validUntil: null,
      field: signedPayment.signature.field,
      scalar: signedPayment.signature.scalar
    });

    const payment = data.sendPayment?.payment;
    if (!payment) throw new Error('prefund payment did not return a payment object.');
    const failureReason = Array.isArray(payment.failureReason)
      ? payment.failureReason.join(', ')
      : payment.failureReason;
    if (failureReason) {
      throw new Error(`prefund payment failure: ${String(failureReason)}`);
    }
    return { hash: payment.hash, status: 'submitted' };
  };

  try {
    return await attemptSend();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Account_nonce_precondition_unsatisfied')) throw error;
    await sleep(1200);
    const nonce = await readAccountNonce(sender);
    if (nonce === null) throw error;
    return await attemptSend(Number(nonce + 1n));
  }
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function loadOrCreateZkappKey(keyPath: string): Promise<{ key: PrivateKey; status: DeployStatus }> {
  const envKey = getSecret('ZKAPP_V2_PRIVATE_KEY');
  if (envKey) {
    return { key: PrivateKey.fromBase58(envKey), status: 'used-env-key' };
  }

  try {
    const stored = await fs.readFile(keyPath, 'utf8');
    return { key: PrivateKey.fromBase58(stored.trim()), status: 'reused-stored-key' };
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const generated = PrivateKey.random();
  await fs.writeFile(keyPath, `${generated.toBase58()}\n`, 'utf8');
  return { key: generated, status: 'generated-new-key' };
}

async function readAttesterPublicKeys(): Promise<PublicKey[]> {
  const env = getSecret('OPENGRADIENT_ATTESTER_PRIVATE_KEYS');
  if (env) {
    return env
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .slice(0, 3)
      .map((entry) => PrivateKey.fromBase58(entry).toPublicKey());
  }

  const attesterFilePath = path.join(process.cwd(), 'data', 'opengradient', 'attester-keys.json');
  const raw = await fs.readFile(attesterFilePath, 'utf8');
  const parsed = JSON.parse(raw) as AttesterKeyFile;
  const keys =
    parsed.attesters
      ?.map((entry) => entry.privateKey?.trim() || '')
      .filter((entry) => entry.length > 0)
      .slice(0, 3)
      .map((entry) => PrivateKey.fromBase58(entry).toPublicKey()) || [];

  if (keys.length < 3) {
    throw new Error('Need at least three attester keys to deploy v2.');
  }
  return keys;
}

async function main() {
  const networkId = process.env.ZEKO_NETWORK_ID || 'testnet';
  const graphql = normalizeGraphqlUrl(process.env.ZEKO_GRAPHQL || null, 'https://testnet.zeko.io/graphql');
  const archive = normalizeGraphqlUrl(
    process.env.ZEKO_ARCHIVE_GRAPHQL || null,
    'https://archive.testnet.zeko.io/graphql'
  );
  const explorer = process.env.ZEKO_EXPLORER || 'https://zekoscan.io/testnet';
  const txFee = UInt64.from(process.env.TX_FEE || '100000000');
  const prefundAmount = UInt64.from(process.env.ZKAPP_PREFUND_AMOUNT || '1000000000');
  const deploymentDir = path.join(process.cwd(), 'data', 'deployments');
  const zkappKeyPath = path.join(deploymentDir, 'agent-request-v2.zkapp-private-key.txt');
  const deploymentRecordPath = path.join(deploymentDir, 'agent-request-v2.latest.json');

  const deployerSecret =
    getSecret('DEPLOYER_PRIVATE_KEY') ||
    getSecret('SPONSOR_PRIVATE_KEY') ||
    readStoredSponsorPrivateKey() ||
    (await promptHidden('Deployer private key: '));
  if (!deployerSecret) {
    throw new Error('Missing DEPLOYER_PRIVATE_KEY or SPONSOR_PRIVATE_KEY.');
  }

  await ensureDir(deploymentDir);

  const deployerKey = PrivateKey.fromBase58(deployerSecret);
  const deployerPublicKey = deployerKey.toPublicKey();
  const { key: zkappKey, status: keySource } = await loadOrCreateZkappKey(zkappKeyPath);
  const zkappAddress = zkappKey.toPublicKey();
  const attesterPublicKeys = await readAttesterPublicKeys();
  const startingDeployerNonce = (await readAccountNonce(deployerPublicKey)) ?? 0n;

  Mina.setActiveInstance(
    Mina.Network({
      networkId: networkId as any,
      mina: graphql,
      archive
    })
  );

  const deployerAccount = await fetchAccount({ publicKey: deployerPublicKey });
  if (deployerAccount.error) {
    throw new Error('Deployer account not found on Zeko testnet. Fund it before deploying.');
  }

  const deployerBalance = deployerAccount.account.balance.toBigInt();
  if (deployerBalance < txFee.toBigInt()) {
    throw new Error(`Deployer balance ${deployerBalance.toString()} is below tx fee ${txFee.toBigInt().toString()}.`);
  }

  const alreadyExists = await accountExists(zkappAddress);

  console.log(
    JSON.stringify(
      {
        step: 'preflight',
        networkId,
        graphql,
        archive,
        explorer,
        txFee: txFee.toString(),
        prefundAmount: prefundAmount.toString(),
        deployerPublicKey: deployerPublicKey.toBase58(),
        zkappPublicKey: zkappAddress.toBase58(),
        attesterPublicKeys: attesterPublicKeys.map((entry) => entry.toBase58()),
        deployerBalance: deployerBalance.toString(),
        deployerNonce: deployerAccount.account.nonce.toString(),
        zkappAlreadyExists: alreadyExists,
        keySource
      },
      null,
      2
    )
  );

  let prefundTxHash: string | null = null;
  if (!alreadyExists) {
    console.log('[zkapp:deploy:v2] prefunding zkapp account...');
    const prefund = await sendPrefundPayment(deployerKey, zkappAddress, txFee, prefundAmount, networkId, graphql);
    prefundTxHash = prefund?.hash ?? null;

    const funded = await waitForAccountVisible(zkappAddress, 40, 3000);
    if (!funded) throw new Error('zkapp v2 account did not become visible after prefund payment.');

    const advancedNonce = await waitForNonceAtLeast(deployerPublicKey, startingDeployerNonce + 1n, 40, 3000);
    if (advancedNonce === null) throw new Error('deployer nonce did not advance after prefund payment.');
  }

  console.log('[zkapp:deploy:v2] compiling AgentRequestContractV2...');
  await AgentRequestContractV2.compile();

  console.log('[zkapp:deploy:v2] building deploy tx...');
  const zkapp = new AgentRequestContractV2(zkappAddress);
  const deployNonce = await readAccountNonce(deployerPublicKey);
  if (deployNonce === null) {
    throw new Error('Unable to read deployer nonce before v2 deploy transaction.');
  }
  const tx = await Mina.transaction(
    {
      sender: deployerPublicKey,
      fee: txFee,
      nonce: Number(deployNonce)
    },
    async () => {
      await zkapp.deploy();
      zkapp.account.permissions.set({
        ...Permissions.default(),
        editState: Permissions.proofOrSignature()
      });
      await zkapp.configureAttesters(attesterPublicKeys[0], attesterPublicKeys[1], attesterPublicKeys[2]);
    }
  );

  applyNonMagicFeePayerFix(tx as any);
  await tx.prove();
  tx.sign([deployerKey, zkappKey]);

  console.log('[zkapp:deploy:v2] sending deploy tx...');
  let sent: Awaited<ReturnType<typeof tx.send>> | null = null;
  try {
    sent = await tx.send();
  } catch (error) {
    if (!isGatewayTimeoutError(error)) throw error;
    console.warn('[zkapp:deploy:v2] send timed out (504); checking chain state instead...');
  }

  const visible = await waitForAccountVisible(zkappAddress, 40, 3000);
  if (!visible) {
    throw new Error('zkapp v2 account did not become visible after deploy attempt.');
  }
  const deployedNonce = await waitForNonceAtLeast(zkappAddress, 1n, 40, 3000);
  if (deployedNonce === null) {
    throw new Error('zkapp v2 nonce did not advance after deploy attempt.');
  }

  const record: StoredDeploymentRecordV2 = {
    zkappPublicKey: zkappAddress.toBase58(),
    deployerPublicKey: deployerPublicKey.toBase58(),
    attesterPublicKeys: attesterPublicKeys.map((entry) => entry.toBase58()),
    networkId,
    graphql,
    archive,
    explorer,
    txFee: txFee.toString(),
    prefundAmount: prefundAmount.toString(),
    prefundTxHash,
    deployTxHash: sent?.hash ?? null,
    deployStatus: sent?.status ?? null,
    deployedAt: new Date().toISOString(),
    keySource
  };

  await fs.writeFile(deploymentRecordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        ...record,
        deploymentRecordPath
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[zkapp:deploy:v2] failed', error);
  process.exit(1);
});
