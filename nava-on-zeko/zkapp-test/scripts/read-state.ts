import 'reflect-metadata';
import 'dotenv/config';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Mina, PublicKey, fetchAccount } from 'o1js';

type SupportedNetworkId = 'mainnet' | 'testnet' | { custom: string };

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

async function readDeploymentRecord() {
  const recordPath = path.join(process.cwd(), 'data', 'deployments', 'test-value.latest.json');
  const raw = await fs.readFile(recordPath, 'utf8');
  return JSON.parse(raw) as { zkappPublicKey: string; deployerPublicKey: string };
}

async function main() {
  const networkId = resolveNetworkId(process.env.ZEKO_NETWORK_ID);
  const graphql = normalizeGraphqlUrl(process.env.ZEKO_GRAPHQL, 'https://testnet.zeko.io/graphql');
  const archive = normalizeGraphqlUrl(process.env.ZEKO_ARCHIVE_GRAPHQL, 'https://archive.testnet.zeko.io/graphql');
  const { zkappPublicKey, deployerPublicKey } = await readDeploymentRecord();

  Mina.setActiveInstance(
    Mina.Network({
      networkId,
      mina: graphql,
      archive
    })
  );

  const result = await fetchAccount({ publicKey: PublicKey.fromBase58(zkappPublicKey) });
  if (result.error) {
    throw new Error(`zkapp account not found: ${result.error.statusCode}`);
  }

  console.log(
    JSON.stringify(
      {
        zkappPublicKey,
        deployerPublicKey,
        nonce: result.account.nonce.toString(),
        balance: result.account.balance.toString(),
        zkappState: result.account.zkapp?.appState?.map((entry) => entry.toString()) || null,
        verificationKeyHash: result.account.zkapp?.verificationKey?.hash.toString() || null
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[zkapp-test:read] failed', error);
  process.exit(1);
});
