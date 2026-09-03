import 'reflect-metadata';
import {
  AccountUpdate,
  Bool,
  fetchAccount,
  Mina,
  PrivateKey,
  PublicKey,
  TokenId,
  UInt64,
  UInt8,
} from 'o1js';
import { FungibleToken, FungibleTokenAdmin } from 'mina-fungible-token';
import { appendFile, writeFile } from 'node:fs/promises';

const GRAPHQL = process.env.ZEKO_GRAPHQL || 'https://sepolia.zeko.io/graphql';
const NETWORK_ID = 'testnet';
const SYMBOL = process.env.TOKEN_SYMBOL || 'sZEKO';
const DECIMALS = Number.parseInt(process.env.TOKEN_DECIMALS || '9', 10);
const SUPPLY_WHOLE = process.env.TOKEN_SUPPLY_WHOLE || '100000';
const RECIPIENT = process.env.TOKEN_RECIPIENT || 'B62qipa4xp6pQKqAm5qoviGoHyKaurHvLZiWf3djDNgrzdERm6AowSQ';
const DEPLOY_FEE = UInt64.from(process.env.TOKEN_DEPLOY_FEE || '200000');
const MINT_FEE = UInt64.from(process.env.TOKEN_MINT_FEE || '200000');
const SRC = process.env.TOKEN_SRC || 'https://github.com/Evan-k-global/private_order_book';
const ENV_OUT = process.env.TOKEN_ENV_OUT || 'data/zeko-sepolia-szeko.env';
const RESUME_EXISTING =
  process.env.TOKEN_RESUME_EXISTING === '1' ||
  (process.env.TOKEN_ADMIN_PRIVATE_KEY && process.env.TOKEN_CONTRACT_PRIVATE_KEY);

function toBaseUnits(whole, decimals) {
  return BigInt(whole) * 10n ** BigInt(decimals);
}

function isGatewayTimeoutError(error) {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('504') || msg.toLowerCase().includes('gateway timeout');
}

function shouldUseSinglePassFallback(graphql, error) {
  const msg = error instanceof Error ? error.message : String(error);
  return graphql.includes('sepolia.zeko.io') && msg.includes('getAccount: Could not find account for public key');
}

async function fetchGenesisConstantsWithRetry(fetchModule, graphql) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await fetchModule.fetchGenesisConstants(graphql);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw lastError;
}

const o1jsTransactionModuleUrl = new URL(
  '../node_modules/.pnpm/o1js@2.13.0/node_modules/o1js/dist/node/lib/mina/v1/transaction.js',
  import.meta.url
).href;
const o1jsFetchModuleUrl = new URL(
  '../node_modules/.pnpm/o1js@2.13.0/node_modules/o1js/dist/node/lib/mina/v1/fetch.js',
  import.meta.url
).href;
async function buildTransactionWithFallback(network, graphql, sender, fee, fn, options = {}) {
  const { preferSinglePass = false } = options;
  const useSinglePass = preferSinglePass && graphql.includes('sepolia.zeko.io');
  Mina.setActiveInstance(network);
  if (useSinglePass) {
    const internal = await import(o1jsTransactionModuleUrl);
    Mina.setActiveInstance(network);
    return await internal.createTransaction(
      { sender, fee },
      fn,
      0,
      {
        fetchMode: 'test',
        isFinalRunOutsideCircuit: false,
        proofsEnabled: true,
      }
    );
  }
  try {
    return await Mina.transaction({ sender, fee }, fn);
  } catch (error) {
    if (!shouldUseSinglePassFallback(graphql, error)) throw error;
    const internal = await import(o1jsTransactionModuleUrl);
    Mina.setActiveInstance(network);
    return await internal.createTransaction(
      { sender, fee },
      fn,
      0,
      {
        fetchMode: 'test',
        isFinalRunOutsideCircuit: false,
        proofsEnabled: true,
      }
    );
  }
}

async function readAccountNonce(publicKey) {
  try {
    const result = await fetchAccount({ publicKey });
    if (result.error) return null;
    const nonceLike = result?.account?.nonce;
    if (nonceLike && typeof nonceLike.toBigInt === 'function') return nonceLike.toBigInt();
    if (nonceLike && typeof nonceLike.toString === 'function') return BigInt(nonceLike.toString());
    return null;
  } catch {
    return null;
  }
}

async function accountExists(publicKey, tokenId) {
  try {
    const result = tokenId ? await fetchAccount({ publicKey, tokenId }) : await fetchAccount({ publicKey });
    return !result.error;
  } catch {
    return false;
  }
}

async function waitForNonceAtLeast(publicKey, minimumNonce, attempts = 40, intervalMs = 3000) {
  for (let i = 0; i < attempts; i += 1) {
    const nonce = await readAccountNonce(publicKey);
    if (nonce !== null && nonce >= minimumNonce) return nonce;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

async function waitForAccountVisible(publicKey, tokenId, attempts = 40, intervalMs = 3000) {
  for (let i = 0; i < attempts; i += 1) {
    if (await accountExists(publicKey, tokenId)) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function main() {
  const deployerKey = PrivateKey.fromBase58(process.env.DEPLOYER_PRIVATE_KEY);
  const deployer = deployerKey.toPublicKey();
  const recipient = PublicKey.fromBase58(RECIPIENT);
  const adminKey = process.env.TOKEN_ADMIN_PRIVATE_KEY
    ? PrivateKey.fromBase58(process.env.TOKEN_ADMIN_PRIVATE_KEY)
    : PrivateKey.random();
  const tokenKey = process.env.TOKEN_CONTRACT_PRIVATE_KEY
    ? PrivateKey.fromBase58(process.env.TOKEN_CONTRACT_PRIVATE_KEY)
    : PrivateKey.random();
  const adminAddress = adminKey.toPublicKey();
  const tokenAddress = tokenKey.toPublicKey();
  const mintAmount = UInt64.from(toBaseUnits(SUPPLY_WHOLE, DECIMALS).toString());
  const predeployEnvContent = `# sZEKO token deployment on Zeko Sepolia\nZEKO_GRAPHQL=${GRAPHQL}\nTOKEN_SYMBOL=${SYMBOL}\nTOKEN_DECIMALS=${DECIMALS}\nTOKEN_SUPPLY_WHOLE=${SUPPLY_WHOLE}\nTOKEN_RECIPIENT=${recipient.toBase58()}\nTOKEN_ADMIN_PRIVATE_KEY=${adminKey.toBase58()}\nTOKEN_ADMIN_PUBLIC_KEY=${adminAddress.toBase58()}\nTOKEN_CONTRACT_PRIVATE_KEY=${tokenKey.toBase58()}\nTOKEN_CONTRACT_PUBLIC_KEY=${tokenAddress.toBase58()}\n`;
  await writeFile(new URL(`../${ENV_OUT}`, import.meta.url), predeployEnvContent, 'utf8');

  const network = Mina.Network({ networkId: NETWORK_ID, mina: GRAPHQL, archive: GRAPHQL });
  Mina.setActiveInstance(network);
  const fetchInternal = await import(o1jsFetchModuleUrl);
  await fetchGenesisConstantsWithRetry(fetchInternal, GRAPHQL);

  console.log('[sZEKO] compiling token contracts...');
  await FungibleTokenAdmin.compile();
  await FungibleToken.compile();
  Mina.setActiveInstance(network);

  const adminContract = new FungibleTokenAdmin(adminAddress);
  const token = new FungibleToken(tokenAddress);

  const deployerNonceBefore = (await readAccountNonce(deployer)) ?? 0n;
  const adminExists = await accountExists(adminAddress);
  const tokenExists = await accountExists(tokenAddress);

  if (!RESUME_EXISTING && (adminExists || tokenExists)) {
    throw new Error('fresh admin/token keys are required; generated addresses already exist unexpectedly');
  }

  console.log(
    JSON.stringify(
      {
        symbol: SYMBOL,
        recipient: recipient.toBase58(),
        adminContractAddress: adminAddress.toBase58(),
        tokenContractAddress: tokenAddress.toBase58(),
      },
      null,
      2
    )
  );

  let deployResult = null;
  let deployerNonceAfterDeploy = deployerNonceBefore;
  if (!adminExists || !tokenExists) {
    console.log('[sZEKO] deploying admin + token contracts...');
    const deployTx = await buildTransactionWithFallback(network, GRAPHQL, deployer, DEPLOY_FEE, async () => {
      AccountUpdate.fundNewAccount(deployer, 3);
      await adminContract.deploy({ adminPublicKey: adminAddress });
      await token.deploy({
        symbol: SYMBOL,
        src: SRC,
        allowUpdates: true,
      });
      await token.initialize(adminAddress, UInt8.from(DECIMALS), Bool(false));
    });

    await deployTx.prove();
    deployTx.sign([deployerKey, adminKey, tokenKey]);
    try {
      deployResult = await deployTx.send();
    } catch (error) {
      if (!isGatewayTimeoutError(error)) throw error;
      console.warn('[sZEKO] deploy send timed out (504); checking chain state...');
    }

    deployerNonceAfterDeploy = await waitForNonceAtLeast(deployer, deployerNonceBefore + 1n, 40, 3000);
    if (deployerNonceAfterDeploy === null) throw new Error('deployer nonce did not advance after deploy tx');
    const tokenVisible = await waitForAccountVisible(tokenAddress, undefined, 40, 3000);
    const adminVisible = await waitForAccountVisible(adminAddress, undefined, 40, 3000);
    if (!tokenVisible || !adminVisible) throw new Error('token/admin contracts not visible after deploy');
  } else {
    console.log('[sZEKO] using existing admin + token contracts...');
  }

  console.log('[sZEKO] minting recipient supply...');
  const mintTx = await buildTransactionWithFallback(network, GRAPHQL, deployer, MINT_FEE, async () => {
    AccountUpdate.fundNewAccount(deployer, 1);
    await token.mint(recipient, mintAmount);
  });

  await mintTx.prove();
  mintTx.sign([deployerKey, adminKey]);
  let mintResult = null;
  try {
    mintResult = await mintTx.send();
  } catch (error) {
    if (!isGatewayTimeoutError(error)) throw error;
    console.warn('[sZEKO] mint send timed out (504); checking chain state...');
  }

  const deployerNonceAfterMint = await waitForNonceAtLeast(deployer, deployerNonceAfterDeploy + 1n, 40, 3000);
  if (deployerNonceAfterMint === null) throw new Error('deployer nonce did not advance after mint tx');

  const tokenId = token.deriveTokenId();
  const recipientTokenAccountVisible = await waitForAccountVisible(recipient, tokenId, 40, 3000);
  if (!recipientTokenAccountVisible) throw new Error('recipient token account not visible after mint');

  const balance = await token.getBalanceOf(recipient);
  const balanceStr = balance.toString();
  const tokenIdBase58 = TokenId.toBase58(tokenId);

  const envContent = `# sZEKO token deployment on Zeko Sepolia\nZEKO_GRAPHQL=${GRAPHQL}\nTOKEN_SYMBOL=${SYMBOL}\nTOKEN_DECIMALS=${DECIMALS}\nTOKEN_SUPPLY_WHOLE=${SUPPLY_WHOLE}\nTOKEN_RECIPIENT=${recipient.toBase58()}\nTOKEN_ADMIN_PRIVATE_KEY=${adminKey.toBase58()}\nTOKEN_ADMIN_PUBLIC_KEY=${adminAddress.toBase58()}\nTOKEN_CONTRACT_PRIVATE_KEY=${tokenKey.toBase58()}\nTOKEN_CONTRACT_PUBLIC_KEY=${tokenAddress.toBase58()}\nTOKEN_ID=${tokenIdBase58}\nDEPLOY_TX_HASH=${deployResult?.hash || ''}\nMINT_TX_HASH=${mintResult?.hash || ''}\nRECIPIENT_BALANCE_BASE_UNITS=${balanceStr}\n`;
  await writeFile(new URL(`../${ENV_OUT}`, import.meta.url), envContent, 'utf8');

  console.log(JSON.stringify({
    ok: true,
    symbol: SYMBOL,
    decimals: DECIMALS,
    supplyWhole: SUPPLY_WHOLE,
    recipient: recipient.toBase58(),
    tokenContractAddress: tokenAddress.toBase58(),
    adminContractAddress: adminAddress.toBase58(),
    tokenId: tokenIdBase58,
    deployTxHash: deployResult?.hash || null,
    deployStatus: deployResult?.status || 'unknown',
    mintTxHash: mintResult?.hash || null,
    mintStatus: mintResult?.status || 'unknown',
    recipientBalanceBaseUnits: balanceStr,
    envOut: ENV_OUT,
  }, null, 2));
}

main().catch((error) => {
  console.error('[sZEKO] failed', error);
  process.exit(1);
});
