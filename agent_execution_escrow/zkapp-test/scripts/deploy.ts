import 'reflect-metadata';
import 'dotenv/config';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import process from 'node:process';
import { AccountUpdate, Field, Mina, Permissions, PrivateKey, UInt64, fetchAccount } from 'o1js';
import Client from 'mina-signer';
import { TestValueZkApp } from '../src/TestValueZkApp.js';

type SupportedNetworkId = 'mainnet' | 'testnet' | { custom: string };

function normalizeGraphqlUrl(value: string | null | undefined, fallback: string) {
  const raw = value?.trim() || fallback;
  if (raw.endsWith('/graphql')) return raw;
  return `${raw.replace(/\/+$/, '')}/graphql`;
}

function getSecret(name: string) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isGatewayTimeoutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('504') || message.toLowerCase().includes('gateway timeout');
}

function resolveNetworkId(raw: string | null | undefined): SupportedNetworkId {
  const value = raw?.trim();
  if (value === 'mainnet' || value === 'testnet') return value;
  return value ? { custom: value } : 'testnet';
}

function networkIdLabel(networkId: SupportedNetworkId) {
  return typeof networkId === 'string' ? networkId : networkId.custom;
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

async function waitForAccountVisible(publicKey: ReturnType<PrivateKey['toPublicKey']>, attempts = 40, intervalMs = 3000) {
  for (let i = 0; i < attempts; i += 1) {
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

async function accountExists(publicKey: ReturnType<PrivateKey['toPublicKey']>) {
  try {
    const result = await fetchAccount({ publicKey });
    return !result.error;
  } catch {
    return false;
  }
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

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function loadOrCreateZkappKey(keyPath: string) {
  const envKey = getSecret('ZKAPP_PRIVATE_KEY');
  if (envKey) {
    return {
      key: PrivateKey.fromBase58(envKey),
      status: 'used-env-key'
    };
  }
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
      memo: 'agent-execution-escrow-zkapp-test'
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

async function main() {
  const networkId = resolveNetworkId(process.env.ZEKO_NETWORK_ID);
  const networkIdText = networkIdLabel(networkId);
  const graphql = normalizeGraphqlUrl(process.env.ZEKO_GRAPHQL, 'https://testnet.zeko.io/graphql');
  const archive = normalizeGraphqlUrl(process.env.ZEKO_ARCHIVE_GRAPHQL, 'https://archive.testnet.zeko.io/graphql');
  const explorer = process.env.ZEKO_EXPLORER || 'https://zekoscan.io/testnet';
  const txFee = UInt64.from(process.env.TX_FEE || '100000000');
  const prefundAmount = UInt64.from(process.env.ZKAPP_PREFUND_AMOUNT || '1000000000');
  const deployValue = Field(process.env.DEPLOY_VALUE || '1');
  const deploymentDir = path.join(process.cwd(), 'data', 'deployments');
  const zkappKeyPath = path.join(deploymentDir, 'test-value.zkapp-private-key.txt');
  const deploymentRecordPath = path.join(deploymentDir, 'test-value.latest.json');

  const deployerSecret =
    getSecret('DEPLOYER_PRIVATE_KEY') ||
    getSecret('SPONSOR_PRIVATE_KEY') ||
    (await promptHidden('Deployer private key: '));
  if (!deployerSecret) {
    throw new Error('Missing DEPLOYER_PRIVATE_KEY or SPONSOR_PRIVATE_KEY.');
  }

  await ensureDir(deploymentDir);
  const deployerKey = PrivateKey.fromBase58(deployerSecret);
  const deployerPublicKey = deployerKey.toPublicKey();
  const { key: zkappKey, status: keySource } = await loadOrCreateZkappKey(zkappKeyPath);
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
    throw new Error('Deployer account not found on Zeko testnet. Fund it before deploying.');
  }

  const deployerBalance = deployerAccount.account.balance.toBigInt();
  if (deployerBalance < txFee.toBigInt()) {
    throw new Error(`Deployer balance ${deployerBalance.toString()} is below tx fee ${txFee.toBigInt().toString()}.`);
  }

  const alreadyExists = await accountExists(zkappPublicKey);
  console.log(
    JSON.stringify(
      {
        step: 'preflight',
        networkId: networkIdText,
        graphql,
        archive,
        explorer,
        txFee: txFee.toString(),
        prefundAmount: prefundAmount.toString(),
        deployValue: deployValue.toString(),
        deployerPublicKey: deployerPublicKey.toBase58(),
        zkappPublicKey: zkappPublicKey.toBase58(),
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
    console.log('[zkapp-test:deploy] funding fresh zkapp account with signed payment...');
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
  }

  console.log('[zkapp-test:deploy] compiling TestValueZkApp...');
  await TestValueZkApp.compile();
  const needsAccountFunding = !(await accountExists(zkappPublicKey));

  console.log('[zkapp-test:deploy] building deploy tx...');
  const zkapp = new TestValueZkApp(zkappPublicKey);
  const tx = await Mina.transaction(
    {
      sender: deployerPublicKey,
      fee: txFee
    },
    async () => {
      if (needsAccountFunding) {
        AccountUpdate.fundNewAccount(deployerPublicKey);
      }
      await zkapp.deploy();
      zkapp.account.permissions.set({
        ...Permissions.default(),
        editState: Permissions.proof()
      });
      zkapp.value.set(deployValue);
      zkapp.lastUpdatedAt.set(Field(Math.floor(Date.now() / 1000)));
    }
  );

  await tx.prove();
  tx.sign([deployerKey, zkappKey]);

  console.log('[zkapp-test:deploy] sending deploy tx...');
  let sent: Awaited<ReturnType<typeof tx.send>> | null = null;
  try {
    sent = await tx.send();
  } catch (error) {
    if (!isGatewayTimeoutError(error)) throw error;
    console.warn('[zkapp-test:deploy] deploy send timed out (504); checking chain state instead...');
  }

  const visible = await waitForAccountVisible(zkappPublicKey);
  if (!visible) {
    throw new Error('zkapp account did not become visible after deploy attempt.');
  }

  const record = {
    zkappPublicKey: zkappPublicKey.toBase58(),
    deployerPublicKey: deployerPublicKey.toBase58(),
    networkId: networkIdText,
    graphql,
    archive,
    explorer,
    txFee: txFee.toString(),
    prefundAmount: prefundAmount.toString(),
    deployValue: deployValue.toString(),
    prefundTxHash,
    deployTxHash: sent?.hash ?? null,
    deployStatus: sent?.status ?? null,
    deployedAt: new Date().toISOString(),
    keySource,
    zkappKeyPath
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
  console.error('[zkapp-test:deploy] failed', error);
  process.exit(1);
});
