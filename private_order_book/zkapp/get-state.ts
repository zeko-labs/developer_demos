import 'reflect-metadata';
import { fetchAccount, Mina, PublicKey } from 'o1js';
import { ShadowBookSettlementZkApp } from './contract.js';
import { ShadowBookSettlementAdvancedZkApp } from './advanced-contract.js';
import { readOptionalEnv, requireEnv } from './utils.js';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const graphql = requireEnv('ZEKO_GRAPHQL');
  const zkappAddress = PublicKey.fromBase58(requireEnv('ZKAPP_PUBLIC_KEY'));
  const useAdvanced = readOptionalEnv('ZKAPP_GET_STATE_USE_ADVANCED', 'false').toLowerCase() === 'true';
  const attempts = Number.parseInt(readOptionalEnv('GET_STATE_RETRY_ATTEMPTS', '20'), 10);
  const intervalMs = Number.parseInt(readOptionalEnv('GET_STATE_RETRY_INTERVAL_MS', '3000'), 10);

  const network = Mina.Network({
    mina: graphql,
    archive: graphql
  });
  Mina.setActiveInstance(network);

  let accountVisible = false;
  for (let i = 0; i < Math.max(1, attempts); i += 1) {
    const result = await fetchAccount({ publicKey: zkappAddress });
    if (!result.error) {
      accountVisible = true;
      break;
    }
    await sleep(Math.max(500, intervalMs));
  }

  if (!accountVisible) {
    throw new Error(
      `zkapp account not visible yet at ${zkappAddress.toBase58()} on ${graphql}. ` +
      'If deploy tx is still pending, wait and retry.'
    );
  }

  const zkapp = useAdvanced
    ? new ShadowBookSettlementAdvancedZkApp(zkappAddress)
    : new ShadowBookSettlementZkApp(zkappAddress);
  const marketConfigHash = zkapp.marketConfigHash.get();
  const settlementRoot = zkapp.settlementRoot.get();
  const bookRoot = zkapp.bookRoot.get();
  const noteRoot = zkapp.noteRoot.get();
  const nullifierRoot = zkapp.nullifierRoot.get();
  const sequencingRoot = zkapp.sequencingRoot.get();
  const lastBatchId = zkapp.lastBatchId.get();

  console.log(
    JSON.stringify(
      {
        ok: true,
        zkappAddress: zkappAddress.toBase58(),
        contractMode: useAdvanced ? 'advanced' : 'lean',
        marketConfigured: !marketConfigHash.equals(0).toBoolean(),
        marketConfigHash: marketConfigHash.toString(),
        settlementRoot: settlementRoot.toString(),
        bookRoot: bookRoot.toString(),
        noteRoot: noteRoot.toString(),
        nullifierRoot: nullifierRoot.toString(),
        sequencingRoot: sequencingRoot.toString(),
        lastBatchId: lastBatchId.toString()
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[zkapp:get-state] failed', error);
  process.exit(1);
});
