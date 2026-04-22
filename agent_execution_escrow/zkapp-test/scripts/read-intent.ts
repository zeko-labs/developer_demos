import 'reflect-metadata';
import 'dotenv/config';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Mina, PublicKey, fetchAccount } from 'o1js';

type SupportedNetworkId = 'mainnet' | 'testnet' | { custom: string };

const STATUS_LABELS = new Map<string, string>([
  ['0', 'PENDING'],
  ['1', 'APPROVED'],
  ['2', 'EXECUTED'],
  ['3', 'SETTLED'],
  ['4', 'REJECTED'],
  ['5', 'UNDECIDED']
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

function requiredEnv(name: string) {
  const value = process.env[name];
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error(`missing_${name.toLowerCase()}`);
}

function decodeStatusCode(value: string | null | undefined) {
  return STATUS_LABELS.get(String(value ?? '')) || `UNKNOWN(${String(value ?? '')})`;
}

async function main() {
  const requestHash = requiredEnv('ZKAPP_REQUEST_HASH').toLowerCase();
  const intentKey = requestHash.replace(/[^a-z0-9]/gi, '').slice(0, 64);
  const recordPath = path.join(process.cwd(), 'data', 'intents', `${intentKey}.json`);
  const rawRecord = await fs.readFile(recordPath, 'utf8');
  const record = JSON.parse(rawRecord) as {
    contractVersion?: string;
    zkappPublicKey: string;
    deployerPublicKey: string;
    lifecycle: Record<string, unknown>;
    fieldState: Record<string, unknown>;
  };

  const networkId = resolveNetworkId(process.env.ZEKO_NETWORK_ID);
  const graphql = normalizeGraphqlUrl(process.env.ZEKO_GRAPHQL, 'https://testnet.zeko.io/graphql');
  const archive = normalizeGraphqlUrl(process.env.ZEKO_ARCHIVE_GRAPHQL, 'https://archive.testnet.zeko.io/graphql');

  Mina.setActiveInstance(
    Mina.Network({
      networkId,
      mina: graphql,
      archive
    })
  );

  const result = await fetchAccount({ publicKey: PublicKey.fromBase58(record.zkappPublicKey) });
  if (result.error) {
    throw new Error(`zkapp account not found: ${result.error.statusCode}`);
  }

  process.stdout.write(
    JSON.stringify(
      {
        requestHash,
        contractVersion: typeof record.contractVersion === 'string' ? record.contractVersion : null,
        zkappPublicKey: record.zkappPublicKey,
        deployerPublicKey: record.deployerPublicKey,
        lifecycle: record.lifecycle,
        fieldState: record.fieldState,
        onChainState: result.account.zkapp?.appState?.map((entry) => entry.toString()) || null,
        onChainStatus: decodeStatusCode(result.account.zkapp?.appState?.[3]?.toString() || null),
        nonce: result.account.nonce.toString(),
        balance: result.account.balance.toString(),
        verificationKeyHash: result.account.zkapp?.verificationKey?.hash.toString() || null
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[zkapp-intent:read] failed', error);
  process.exit(1);
});
