import 'reflect-metadata';
import { AccountUpdate, fetchAccount, Mina, PrivateKey, PublicKey, UInt64 } from 'o1js';
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

async function main() {
  const graphql = requireEnv('ZEKO_GRAPHQL');
  const txFee = UInt64.from(readOptionalEnv('TX_FEE', '2000000000'));
  const useAdvanced = readOptionalEnv('ZKAPP_DEPLOY_USE_ADVANCED', 'false').toLowerCase() === 'true';
  const marketSymbol = readOptionalEnv('MARKET_SYMBOL', 'tETH/tZEKO');
  const baseTokenId = readOptionalEnv('BASE_TOKEN_ID', 'wpWnRKT383VPM2TWtBWs8R4i927SKUgzAycsSs3AyvyriGXyP2');
  const quoteTokenId = readOptionalEnv('QUOTE_TOKEN_ID', 'x3jovPY75iFmbZ5kTfxZmNmEQ6874mmBu3jufom1QsxMNqPx27');

  const deployerKey = PrivateKey.fromBase58(requireEnv('DEPLOYER_PRIVATE_KEY'));
  const zkappKey = PrivateKey.fromBase58(requireEnv('ZKAPP_PRIVATE_KEY'));
  const zkappAddress = zkappKey.toPublicKey();
  const deployerPublicKey = deployerKey.toPublicKey();
  const operator = PublicKey.fromBase58(readOptionalEnv('OPERATOR_PUBLIC_KEY', deployerKey.toPublicKey().toBase58()));

  const network = Mina.Network({
    mina: graphql,
    archive: graphql
  });
  Mina.setActiveInstance(network);

  console.log(`[zkapp:deploy] compiling ${useAdvanced ? 'advanced' : 'lean'} contract...`);
  if (useAdvanced) {
    await ShadowBookSettlementAdvancedZkApp.compile();
  } else {
    await ShadowBookSettlementZkApp.compile();
  }

  const zkapp = useAdvanced
    ? new ShadowBookSettlementAdvancedZkApp(zkappAddress)
    : new ShadowBookSettlementZkApp(zkappAddress);
  const startingDeployerNonce = (await readAccountNonce(deployerPublicKey)) ?? 0n;

  const alreadyExists = await accountExists(zkappAddress);

  console.log('[zkapp:deploy] sending deploy tx...');
  const deployTx = await Mina.transaction(
    {
      sender: deployerKey.toPublicKey(),
      fee: txFee
    },
    async () => {
      if (!alreadyExists) {
        AccountUpdate.fundNewAccount(deployerPublicKey);
      }
      await zkapp.deploy();
    }
  );

  await deployTx.prove();
  deployTx.sign([deployerKey, zkappKey]);
  let sentDeploy: Awaited<ReturnType<typeof deployTx.send>> | null = null;
  try {
    sentDeploy = await deployTx.send();
  } catch (error) {
    if (!isGatewayTimeoutError(error)) throw error;
    console.warn('[zkapp:deploy] deploy tx send timed out (504); checking chain state...');
  }

  const zkappVisible = await waitForAccountVisible(zkappAddress, 40, 3000);
  if (!zkappVisible) {
    throw new Error('zkapp account not visible after deploy tx; wait for inclusion and run deploy again');
  }

  const deployerNonce = await waitForNonceAtLeast(deployerPublicKey, startingDeployerNonce + 1n, 40, 3000);
  if (deployerNonce === null) {
    throw new Error('deployer nonce did not advance after deploy tx; wait for inclusion and retry');
  }
  await fetchAccount({ publicKey: deployerPublicKey });
  await fetchAccount({ publicKey: zkappAddress });

  console.log('[zkapp:deploy] sending market configure tx...');
  const configureTx = await Mina.transaction(
    {
      sender: deployerKey.toPublicKey(),
      fee: txFee
    },
    async () => {
      await zkapp.configureMarket(
        hashStringToField(marketSymbol),
        hashStringToField(baseTokenId),
        hashStringToField(quoteTokenId),
        operator
      );
    }
  );

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
