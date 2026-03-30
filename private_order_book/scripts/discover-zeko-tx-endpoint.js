import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(process.cwd());
const ENV_PATH = path.resolve(PROJECT_ROOT, '.env');

const CANDIDATES = [
  'https://testnet.zeko.io/graphql',
  'https://archive.testnet.zeko.io/graphql',
  'https://devnet.zeko.io/graphql'
];

async function gql(endpoint, query) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: {} })
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function inspectEndpoint(endpoint) {
  const introspection = await gql(endpoint, '{ __schema { queryType { fields { name } } } }');
  if (!introspection.ok || introspection.json?.errors) {
    return {
      ok: false,
      endpoint,
      reason: `introspection failed (${introspection.status})`,
      supportsTxByHash: false,
      supportsAccount: false,
      supportsBlocks: false
    };
  }
  const fields = introspection.json?.data?.__schema?.queryType?.fields || [];
  const names = new Set(fields.map((f) => String(f?.name || '')));
  return {
    ok: true,
    endpoint,
    reason: 'reachable',
    supportsTxByHash: names.has('transaction') || names.has('transactionStatus'),
    supportsAccount: names.has('account'),
    supportsBlocks: names.has('blocks'),
    fields: [...names].sort()
  };
}

function upsertEnv(raw, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(raw)) return raw.replace(re, line);
  return `${raw.trimEnd()}\n${line}\n`;
}

async function main() {
  const inspected = [];
  for (const endpoint of CANDIDATES) {
    try {
      const result = await inspectEndpoint(endpoint);
      inspected.push(result);
    } catch (error) {
      inspected.push({
        ok: false,
        endpoint,
        reason: error instanceof Error ? error.message : String(error),
        supportsTxByHash: false,
        supportsAccount: false,
        supportsBlocks: false
      });
    }
  }

  const reachable = inspected.filter((x) => x.ok);
  if (!reachable.length) {
    console.log(JSON.stringify({ ok: false, message: 'No reachable endpoints', inspected }, null, 2));
    process.exit(1);
  }
  const balanceEndpoint =
    reachable.find((x) => x.endpoint.includes('testnet.zeko.io') && x.supportsAccount)?.endpoint ||
    reachable.find((x) => x.supportsAccount)?.endpoint ||
    reachable[0].endpoint;
  const archiveEndpoint =
    reachable.find((x) => x.endpoint.includes('archive.testnet.zeko.io') && x.supportsBlocks)?.endpoint ||
    reachable.find((x) => x.supportsBlocks)?.endpoint ||
    '';
  const txEndpoint = reachable.find((x) => x.supportsTxByHash)?.endpoint || '';

  const envRaw = await readFile(ENV_PATH, 'utf8');
  let next = envRaw;
  next = upsertEnv(next, 'ZEKO_GRAPHQL', balanceEndpoint);
  next = upsertEnv(next, 'ZEKO_ARCHIVE_GRAPHQL', archiveEndpoint);
  next = upsertEnv(next, 'ZEKO_ARCHIVE_RELAY_GRAPHQL', '');
  next = upsertEnv(next, 'ZEKO_TX_GRAPHQL', txEndpoint);
  await writeFile(ENV_PATH, next, 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        selected: { balanceEndpoint, archiveEndpoint, txEndpoint },
        txByHashAvailable: Boolean(txEndpoint),
        inspected
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[discover-zeko-tx-endpoint] failed:', error);
  process.exit(1);
});
