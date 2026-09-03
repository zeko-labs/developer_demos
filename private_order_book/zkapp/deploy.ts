import 'reflect-metadata';
import { AccountUpdate, Bool, fetchAccount, Mina, PrivateKey, PublicKey, UInt32, UInt64 } from 'o1js';
import { ShadowBookSettlementZkApp } from './contract.js';
import { ShadowBookSettlementAdvancedZkApp } from './advanced-contract.js';
import { requireEnv, readOptionalEnv, hashStringToField } from './utils.js';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGatewayTimeoutError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('504') || msg.toLowerCase().includes('gateway timeout');
}

function shouldUseSinglePassDeployFallback(graphql: string, error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  return graphql.includes('sepolia.zeko.io') && msg.includes('getAccount: Could not find account for public key');
}

const o1jsTransactionModuleUrl = new URL(
  '../node_modules/.pnpm/o1js@2.13.0/node_modules/o1js/dist/node/lib/mina/v1/transaction.js',
  import.meta.url
).href;
const o1jsFetchModuleUrl = new URL(
  '../node_modules/.pnpm/o1js@2.13.0/node_modules/o1js/dist/node/lib/mina/v1/fetch.js',
  import.meta.url
).href;

async function buildTransactionWithFallback(
  network: ReturnType<typeof Mina.Network>,
  graphql: string,
  sender: PublicKey,
  fee: UInt64,
  fn: () => Promise<void>
) {
  const useSinglePass = graphql.includes('sepolia.zeko.io');
  Mina.setActiveInstance(network);
  if (useSinglePass) {
    const internal = await import(o1jsTransactionModuleUrl);
    const fetchInternal = await import(o1jsFetchModuleUrl);
    Mina.setActiveInstance(network);
    await fetchInternal.fetchGenesisConstants(graphql);
    return await internal.createTransaction(
      { sender, fee },
      fn,
      0,
      {
        fetchMode: 'test',
        isFinalRunOutsideCircuit: false,
        proofsEnabled: true
      }
    );
  }
  try {
    return await Mina.transaction({ sender, fee }, fn);
  } catch (error) {
    if (!shouldUseSinglePassDeployFallback(graphql, error)) throw error;
    const internal = await import(o1jsTransactionModuleUrl);
    const fetchInternal = await import(o1jsFetchModuleUrl);
    Mina.setActiveInstance(network);
    await fetchInternal.fetchGenesisConstants(graphql);
    return await internal.createTransaction(
      { sender, fee },
      fn,
      0,
      {
        fetchMode: 'test',
        isFinalRunOutsideCircuit: false,
        proofsEnabled: true
      }
    );
  }
}

async function waitForAccountVisible(publicKey: PublicKey, attempts = 30, intervalMs = 3000) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetchAccount({ publicKey });
      if (!res.error) return true;
    } catch {
    }
    await sleep(intervalMs);
  }
  return false;
}

async function accountExists(publicKey: PublicKey) {
  try {
    const res = await fetchAccount({ publicKey });
    return !res.error;
  } catch {
    return false;
  }
}

async function readAccountNonce(publicKey: PublicKey): Promise<bigint | null> {
  try {
    const result = await fetchAccount({ publicKey });
    if (result.error) return null;
    const nonceLike: any = (result as any)?.account?.nonce;
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

async function waitForMarketConfigured(
  zkapp: ShadowBookSettlementZkApp,
  zkappAddress: PublicKey,
  attempts = 30,
  intervalMs = 3000
) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await fetchAccount({ publicKey: zkappAddress });
      const configuredHash = zkapp.marketConfigHash.get();
      if (!configuredHash.equals(0).toBoolean()) return true;
    } catch {
    }
    await sleep(intervalMs);
  }
  return false;
}

function pinAccountUpdateNonce(tx: any, accountPublicKey: PublicKey, nonce: bigint) {
  const target = accountPublicKey.toBase58();
  const update = tx?.transaction?.accountUpdates?.find?.(
    (candidate: any) => candidate?.body?.publicKey?.toBase58?.() === target
  );
  if (!update?.body?.preconditions?.account?.nonce?.value) return;
  const nonceValue = UInt32.from(nonce);
  update.body.preconditions.account.nonce.isSome = Bool(true);
  update.body.preconditions.account.nonce.value.lower = nonceValue;
  update.body.preconditions.account.nonce.value.upper = nonceValue;
}

async function main() {
  const graphql = requireEnv('ZEKO_GRAPHQL');
  if (!graphql.includes('sepolia.zeko.io')) throw new Error('ZEKO_GRAPHQL must point to Zeko Ethereum Sepolia');
  // Sepolia's o1js/Auro signing domain is `testnet`; keep this configurable
  // so deployment can target another Zeko network without changing code.
  const networkId = readOptionalEnv('ZEKO_O1JS_NETWORK_ID', 'testnet');
  const txFee = UInt64.from(readOptionalEnv('TX_FEE', '2000000000'));
  const useAdvanced = readOptionalEnv('ZKAPP_DEPLOY_USE_ADVANCED', 'false').toLowerCase() === 'true';
  const marketSymbol = readOptionalEnv('MARKET_SYMBOL', 'sETH/sZEKO');
  const baseTokenId = readOptionalEnv('BASE_TOKEN_ID', 'wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf');
  const quoteTokenId = readOptionalEnv('QUOTE_TOKEN_ID', 'xpAptwG79jEStACsCv9C6yXUBmKbvurUo8GsTPYapn9QWB5zE5');

  const deployerKey = PrivateKey.fromBase58(requireEnv('DEPLOYER_PRIVATE_KEY'));
  const zkappKey = PrivateKey.fromBase58(requireEnv('ZKAPP_PRIVATE_KEY'));
  const zkappAddress = zkappKey.toPublicKey();
  const deployerPublicKey = deployerKey.toPublicKey();
  const operator = PublicKey.fromBase58(readOptionalEnv('OPERATOR_PUBLIC_KEY', deployerKey.toPublicKey().toBase58()));

  const network = Mina.Network(
    {
      networkId,
      mina: graphql,
      archive: graphql
    } as any
  );
  Mina.setActiveInstance(network);

  console.log(`[zkapp:deploy] compiling ${useAdvanced ? 'advanced' : 'lean'} contract...`);
  if (useAdvanced) {
    await ShadowBookSettlementAdvancedZkApp.compile();
  } else {
    await ShadowBookSettlementZkApp.compile();
  }

  // Some custom-network compile flows can disturb the active Mina instance.
  // Re-assert the intended network before any live account reads or tx builds.
  Mina.setActiveInstance(network);

  const zkapp = useAdvanced
    ? new ShadowBookSettlementAdvancedZkApp(zkappAddress)
    : new ShadowBookSettlementZkApp(zkappAddress);
  const startingDeployerNonce = (await readAccountNonce(deployerPublicKey)) ?? 0n;

  const alreadyExists = await accountExists(zkappAddress);

  console.log('[zkapp:deploy] sending deploy tx...');
  let sentDeploy: Awaited<ReturnType<Awaited<ReturnType<typeof buildTransactionWithFallback>>['send']>> | null = null;
  if (!alreadyExists) {
    const deployTx = await buildTransactionWithFallback(network, graphql, deployerKey.toPublicKey(), txFee, async () => {
      AccountUpdate.fundNewAccount(deployerPublicKey);
      await zkapp.deploy();
    });

    await deployTx.prove();
    deployTx.sign([deployerKey, zkappKey]);
    try {
      sentDeploy = await deployTx.send();
    } catch (error) {
      if (!isGatewayTimeoutError(error)) throw error;
      console.warn('[zkapp:deploy] deploy tx send timed out (504); checking chain state...');
    }
  } else {
    console.log('[zkapp:deploy] zkapp account already exists; skipping deploy tx and continuing to configure');
  }

  const zkappVisible = await waitForAccountVisible(zkappAddress, 40, 3000);
  if (!zkappVisible) {
    throw new Error('zkapp account not visible after deploy tx; wait for inclusion and run deploy again');
  }

  if (!alreadyExists) {
    const deployerNonce = await waitForNonceAtLeast(deployerPublicKey, startingDeployerNonce + 1n, 40, 3000);
    if (deployerNonce === null) {
      throw new Error('deployer nonce did not advance after deploy tx; wait for inclusion and retry');
    }
  }
  await fetchAccount({ publicKey: deployerPublicKey });
  await fetchAccount({ publicKey: zkappAddress });
  const zkappNonce = await readAccountNonce(zkappAddress);
  if (zkappNonce === null) {
    throw new Error('zkapp nonce unavailable after deploy tx; wait for inclusion and retry');
  }

  console.log('[zkapp:deploy] sending market configure tx...');
  const configureTx = await buildTransactionWithFallback(network, graphql, deployerKey.toPublicKey(), txFee, async () => {
    await zkapp.configureMarket(
      hashStringToField(marketSymbol),
      hashStringToField(baseTokenId),
      hashStringToField(quoteTokenId),
      operator
    );
  });
  pinAccountUpdateNonce(configureTx, zkappAddress, zkappNonce);

  await configureTx.prove();
  configureTx.sign([deployerKey, zkappKey]);
  let sentConfigure: Awaited<ReturnType<typeof configureTx.send>> | null = null;
  try {
    sentConfigure = await configureTx.send();
  } catch (error) {
    if (!isGatewayTimeoutError(error)) throw error;
    console.warn('[zkapp:deploy] configure tx send timed out (504); checking chain state...');
  }

  const configured = await waitForMarketConfigured(zkapp, zkappAddress, 40, 3000);
  if (!configured) {
    throw new Error('configure tx not observed on-chain yet; retry `pnpm zkapp:deploy` in ~30s');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        zkappAddress: PublicKey.toBase58(zkappAddress),
        marketSymbol,
        baseTokenId,
        quoteTokenId,
        operatorPublicKey: operator.toBase58(),
        contractMode: useAdvanced ? 'advanced' : 'lean',
        deployTxHash: sentDeploy?.hash ?? null,
        deployStatus: sentDeploy?.status ?? 'unknown (timeout but account became visible)',
        configureTxHash: sentConfigure?.hash ?? null,
        configureStatus: sentConfigure?.status ?? 'unknown (timeout but marketConfigured=true)'
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[zkapp:deploy] failed', error);
  process.exit(1);
});
