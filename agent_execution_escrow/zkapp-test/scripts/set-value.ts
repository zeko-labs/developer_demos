import 'reflect-metadata';
import 'dotenv/config';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import process from 'node:process';
import { Field, Mina, PrivateKey, UInt64, PublicKey, fetchAccount } from 'o1js';
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

async function waitForState(publicKey: PublicKey, expectedValue: string, attempts = 40, intervalMs = 3000) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const result = await fetchAccount({ publicKey });
      if (!result.error) {
        const state = result.account.zkapp?.appState?.map((entry) => entry.toString()) || [];
        if (state[0] === expectedValue) return state;
      }
    } catch {
      // keep polling
    }
    await sleep(intervalMs);
  }
  return null;
}

async function readDeploymentRecord() {
  const recordPath = path.join(process.cwd(), 'data', 'deployments', 'test-value.latest.json');
  const raw = await fs.readFile(recordPath, 'utf8');
  return JSON.parse(raw) as { zkappPublicKey: string };
}

async function main() {
  const networkId = resolveNetworkId(process.env.ZEKO_NETWORK_ID);
  const graphql = normalizeGraphqlUrl(process.env.ZEKO_GRAPHQL, 'https://testnet.zeko.io/graphql');
  const archive = normalizeGraphqlUrl(process.env.ZEKO_ARCHIVE_GRAPHQL, 'https://archive.testnet.zeko.io/graphql');
  const txFee = UInt64.from(process.env.TX_FEE || '100000000');
  const nextValue = Field(process.env.SET_VALUE || '42');
  const timestamp = Field(Math.floor(Date.now() / 1000));

  const deployerSecret =
    getSecret('DEPLOYER_PRIVATE_KEY') ||
    getSecret('SPONSOR_PRIVATE_KEY') ||
    (await promptHidden('Deployer private key: '));
  if (!deployerSecret) {
    throw new Error('Missing DEPLOYER_PRIVATE_KEY or SPONSOR_PRIVATE_KEY.');
  }

  const { zkappPublicKey } = await readDeploymentRecord();
  const deployerKey = PrivateKey.fromBase58(deployerSecret);
  const deployerPublicKey = deployerKey.toPublicKey();
  const zkappAddress = PublicKey.fromBase58(zkappPublicKey);

  Mina.setActiveInstance(
    Mina.Network({
      networkId,
      mina: graphql,
      archive
    })
  );

  const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
  if (zkappAccount.error) {
    throw new Error('zkapp account not found. Deploy first.');
  }

  console.log('[zkapp-test:set] compiling TestValueZkApp...');
  await TestValueZkApp.compile();
  const zkapp = new TestValueZkApp(zkappAddress);

  console.log('[zkapp-test:set] building update tx...');
  const tx = await Mina.transaction(
    {
      sender: deployerPublicKey,
      fee: txFee
    },
    async () => {
      await zkapp.setValue(nextValue, timestamp);
    }
  );
  await tx.prove();
  tx.sign([deployerKey]);

  console.log('[zkapp-test:set] sending update tx...');
  let sent: Awaited<ReturnType<typeof tx.send>> | null = null;
  try {
    sent = await tx.send();
  } catch (error) {
    if (!isGatewayTimeoutError(error)) throw error;
    console.warn('[zkapp-test:set] send timed out (504); checking chain state instead...');
  }

  const finalState = await waitForState(zkappAddress, nextValue.toString());
  if (!finalState) {
    throw new Error('zkapp state did not update to the expected value.');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        zkappPublicKey,
        deployerPublicKey: deployerPublicKey.toBase58(),
        nextValue: nextValue.toString(),
        txHash: sent?.hash ?? null,
        txStatus: sent?.status ?? null,
        state: finalState
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[zkapp-test:set] failed', error);
  process.exit(1);
});
