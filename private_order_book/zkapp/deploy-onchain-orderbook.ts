import 'reflect-metadata';
import { AccountUpdate, Mina, PrivateKey, PublicKey, UInt64, fetchAccount } from 'o1js';
import { ShadowBookOnchainOrderBookZkApp } from './onchain-orderbook-contract.js';
import { compileOnchainOrderBookTransitionProgram } from './onchain-orderbook-prover.js';
import { hashStringToField, readOptionalEnv, requireEnv } from './utils.js';

async function main() {
  const graphql = requireEnv('ZEKO_GRAPHQL');
  const txFee = UInt64.from(readOptionalEnv('TX_FEE', '2000000000'));
  const deployerKey = PrivateKey.fromBase58(requireEnv('DEPLOYER_PRIVATE_KEY'));
  const zkappKey = PrivateKey.fromBase58(requireEnv('ONCHAIN_OB_ZKAPP_PRIVATE_KEY'));
  const zkappAddress = PublicKey.fromBase58(requireEnv('ONCHAIN_OB_ZKAPP_PUBLIC_KEY'));
  const marketSymbol = readOptionalEnv('ONCHAIN_OB_MARKET_SYMBOL', readOptionalEnv('MARKET_SYMBOL', 'sETH/sZEKO'));
  const baseTokenId = readOptionalEnv('ONCHAIN_OB_BASE_TOKEN_ID', readOptionalEnv('BASE_TOKEN_ID', 'base'));
  const quoteTokenId = readOptionalEnv('ONCHAIN_OB_QUOTE_TOKEN_ID', readOptionalEnv('QUOTE_TOKEN_ID', 'quote'));

  Mina.setActiveInstance(Mina.Network({ mina: graphql, archive: graphql }));

  await compileOnchainOrderBookTransitionProgram();
  await ShadowBookOnchainOrderBookZkApp.compile();

  const zkapp = new ShadowBookOnchainOrderBookZkApp(zkappAddress);
  let exists = false;
  try {
    const account = await fetchAccount({ publicKey: zkappAddress });
    exists = !account.error;
  } catch {
    exists = false;
  }

  const tx = await Mina.transaction({ sender: deployerKey.toPublicKey(), fee: txFee }, async () => {
    if (!exists) {
      AccountUpdate.fundNewAccount(deployerKey.toPublicKey());
    }
    await zkapp.deploy();
    await zkapp.configureMarket(hashStringToField(`${marketSymbol}:${baseTokenId}:${quoteTokenId}:onchain-orderbook`));
  });

  await tx.prove();
  tx.sign([deployerKey, zkappKey]);
  const sent = await tx.send();
  console.log(JSON.stringify({
    ok: true,
    zkappAddress: zkappAddress.toBase58(),
    marketSymbol,
    baseTokenId,
    quoteTokenId,
    txHash: sent.hash,
    status: sent.status
  }, null, 2));
}

main().catch((error) => {
  console.error('[zkapp:deploy:onchain-orderbook] failed', error);
  process.exit(1);
});
