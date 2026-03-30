import 'reflect-metadata';
import { Mina, PublicKey, fetchAccount } from 'o1js';
import { ShadowBookOnchainOrderBookZkApp } from './onchain-orderbook-contract.js';
import { requireEnv } from './utils.js';

async function main() {
  const graphql = requireEnv('ZEKO_GRAPHQL');
  const zkappAddress = PublicKey.fromBase58(requireEnv('ONCHAIN_OB_ZKAPP_PUBLIC_KEY'));
  Mina.setActiveInstance(Mina.Network({ mina: graphql, archive: graphql }));
  const result = await fetchAccount({ publicKey: zkappAddress });
  if (result.error) {
    throw new Error(`on-chain order book zkapp not found at ${zkappAddress.toBase58()}`);
  }
  const zkapp = new ShadowBookOnchainOrderBookZkApp(zkappAddress);
  console.log(JSON.stringify({
    ok: true,
    zkappAddress: zkappAddress.toBase58(),
    marketConfigHash: zkapp.marketConfigHash.get().toString(),
    settlementRoot: zkapp.settlementRoot.get().toString(),
    orderRoot: zkapp.orderRoot.get().toString(),
    accountRoot: zkapp.accountRoot.get().toString(),
    lastSequence: zkapp.lastSequence.get().toString()
  }, null, 2));
}

main().catch((error) => {
  console.error('[zkapp:get-state:onchain-orderbook] failed', error);
  process.exit(1);
});
