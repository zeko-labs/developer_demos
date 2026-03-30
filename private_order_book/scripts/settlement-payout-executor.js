import {
  AccountUpdate,
  Bool,
  fetchAccount,
  Mina,
  PrivateKey,
  PublicKey,
  TokenId,
  UInt32,
  UInt64
} from 'o1js';
import { FungibleToken } from 'mina-fungible-token';

const API_BASE = (process.env.DARKPOOL_API || 'http://127.0.0.1:8791').replace(/\/$/, '');
const ZEKO_GRAPHQL = String(process.env.ZEKO_GRAPHQL || '').trim();
const TX_FEE = String(process.env.TX_FEE || '100000000').trim();
const OPERATOR_PRIVATE_KEY = String(
  process.env.PAYOUT_OPERATOR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || ''
).trim();
const FEE_PAYER_PRIVATE_KEY = String(process.env.PAYOUT_FEE_PAYER_PRIVATE_KEY || OPERATOR_PRIVATE_KEY).trim();
const EXPECTED_VAULT_ADDRESS = String(process.env.VAULT_DEPOSIT_ADDRESS || '').trim();
const TOKEN_CONTRACT_ADDRESSES = (() => {
  try {
    const parsed = JSON.parse(process.env.TOKEN_CONTRACT_ADDRESSES_JSON || '{}');
    return {
      TETH: typeof parsed.tETH === 'string' ? parsed.tETH.trim() : '',
      TZEKO: typeof parsed.tZEKO === 'string' ? parsed.tZEKO.trim() : '',
      TMINA: typeof parsed.tMINA === 'string' ? parsed.tMINA.trim() : ''
    };
  } catch {
    return { TETH: '', TZEKO: '', TMINA: '' };
  }
})();
const ASSET_DECIMALS = (() => {
  try {
    const parsed = JSON.parse(process.env.ASSET_DECIMALS_JSON || '{}');
    return {
      TETH: Number.isFinite(Number(parsed.tETH)) ? Number(parsed.tETH) : 9,
      TZEKO: Number.isFinite(Number(parsed.tZEKO)) ? Number(parsed.tZEKO) : 9,
      TMINA: Number.isFinite(Number(parsed.tMINA)) ? Number(parsed.tMINA) : 9
    };
  } catch {
    return { TETH: 9, TZEKO: 9, TMINA: 9 };
  }
})();
let fungibleTokenCompilePromise = null;
const PAYOUT_TX_WAIT_MAX_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.PAYOUT_TX_WAIT_MAX_ATTEMPTS || '30', 10) || 30
);
const PAYOUT_TX_WAIT_INTERVAL_MS = Math.max(
  250,
  Number.parseInt(process.env.PAYOUT_TX_WAIT_INTERVAL_MS || '1000', 10) || 1000
);

async function request(pathname, options = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method: options.method || 'GET',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `request failed: ${pathname}`);
  return json;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`stdin JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeAsset(asset) {
  return String(asset || '').trim().toUpperCase();
}

function decimalToRawUInt64(amount, decimals) {
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw new Error(`invalid payout amount ${amount}`);
  }
  const fixed = Number(amount).toFixed(Math.max(0, decimals));
  const [whole, frac = ''] = fixed.split('.');
  const fracPadded = frac.padEnd(decimals, '0').slice(0, decimals);
  const raw = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, '');
  const value = BigInt(raw || '0');
  if (value <= 0n) throw new Error(`invalid raw payout amount from ${amount}`);
  return UInt64.from(value.toString());
}

async function getNextPendingBatch() {
  const data = await request('/api/darkpool/settlement/batches?limit=500');
  const pending = (data.batches || [])
    .filter((b) => b.status === 'pending')
    .sort((a, b) => Number(a.batchId) - Number(b.batchId));
  return pending[0] || null;
}

async function graphqlRequest(query, variables = {}) {
  const response = await fetch(ZEKO_GRAPHQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.errors) {
    throw new Error(
      `graphql request failed: ${response.status} ${JSON.stringify(json.errors || json)}`
    );
  }
  return json.data || {};
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

async function waitForNonceAtLeast(publicKey, minimumNonce, attempts = 30, intervalMs = 1000) {
  for (let i = 0; i < attempts; i += 1) {
    const nonce = await readAccountNonce(publicKey);
    if (nonce !== null && nonce >= minimumNonce) return nonce;
    await sleep(intervalMs);
  }
  return null;
}

async function waitForPayoutInclusion(sent, feePayerPublicKey, expectedNonceAfterSend) {
  if (sent && typeof sent.wait === 'function') {
    try {
      await sent.wait({
        maxAttempts: PAYOUT_TX_WAIT_MAX_ATTEMPTS,
        interval: PAYOUT_TX_WAIT_INTERVAL_MS
      });
      return;
    } catch (error) {
      const observedNonce = await waitForNonceAtLeast(
        feePayerPublicKey,
        expectedNonceAfterSend,
        PAYOUT_TX_WAIT_MAX_ATTEMPTS,
        PAYOUT_TX_WAIT_INTERVAL_MS
      );
      if (observedNonce !== null) return;
      throw error;
    }
  }

  const observedNonce = await waitForNonceAtLeast(
    feePayerPublicKey,
    expectedNonceAfterSend,
    PAYOUT_TX_WAIT_MAX_ATTEMPTS,
    PAYOUT_TX_WAIT_INTERVAL_MS
  );
  if (observedNonce === null) {
    throw new Error(
      `payout transaction was sent but fee payer nonce did not reach ${expectedNonceAfterSend.toString()}`
    );
  }
}

async function doesOnchainTokenAccountExist(publicKey, tokenId) {
  const variants = [
    {
      query: 'query($publicKey:String!,$token:String!){ account(publicKey:$publicKey, token:$token) { publicKey token } }',
      variables: { publicKey, token: tokenId }
    },
    {
      query: 'query($publicKey:String!,$tokenId:String!){ account(publicKey:$publicKey, tokenId:$tokenId) { publicKey token } }',
      variables: { publicKey, tokenId }
    }
  ];
  let lastError = null;
  for (const variant of variants) {
    try {
      const data = await graphqlRequest(variant.query, variant.variables);
      if ('account' in (data || {})) return Boolean(data.account);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return false;
}

async function main() {
  if (!ZEKO_GRAPHQL) throw new Error('ZEKO_GRAPHQL is required');
  if (!OPERATOR_PRIVATE_KEY) throw new Error('PAYOUT_OPERATOR_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY is required');
  if (!FEE_PAYER_PRIVATE_KEY) throw new Error('PAYOUT_FEE_PAYER_PRIVATE_KEY is required');

  const stdin = await readStdinJson();
  const pending = stdin?.batch || (await getNextPendingBatch());
  if (!pending) {
    console.log(JSON.stringify({ ok: true, message: 'no pending batch', payoutTxs: [] }, null, 2));
    return;
  }
  if (pending.batchType !== 'trade_settlement') {
    console.log(JSON.stringify({ ok: true, message: `batch ${pending.batchId} is ${pending.batchType}; no payouts`, payoutTxs: [] }, null, 2));
    return;
  }
  const payouts = Array.isArray(pending.payouts) ? pending.payouts : [];
  if (!payouts.length) {
    console.log(JSON.stringify({ ok: true, message: `batch ${pending.batchId} has no payouts`, payoutTxs: [] }, null, 2));
    return;
  }

  const operatorKey = PrivateKey.fromBase58(OPERATOR_PRIVATE_KEY);
  const operatorPub = operatorKey.toPublicKey();
  const feePayerKey = PrivateKey.fromBase58(FEE_PAYER_PRIVATE_KEY);
  const feePayerPub = feePayerKey.toPublicKey();
  if (EXPECTED_VAULT_ADDRESS && operatorPub.toBase58() !== EXPECTED_VAULT_ADDRESS) {
    throw new Error(
      `PAYOUT_OPERATOR_PRIVATE_KEY public key mismatch: expected ${EXPECTED_VAULT_ADDRESS}, got ${operatorPub.toBase58()}`
    );
  }

  const network = Mina.Network({
    mina: ZEKO_GRAPHQL,
    archive: ZEKO_GRAPHQL
  });
  Mina.setActiveInstance(network);

  const payoutTxs = [];
  for (const payout of payouts) {
    const wallet = String(payout.wallet || '').trim();
    const tokenId58 = String(payout.tokenId || '').trim();
    const asset = normalizeAsset(payout.asset);
    const decimals = Number.isFinite(ASSET_DECIMALS[asset]) ? ASSET_DECIMALS[asset] : 9;
    const amount = Number(payout.amount || 0);
    if (!wallet || !tokenId58 || !(amount > 0)) {
      throw new Error(`invalid payout entry in batch ${pending.batchId}`);
    }
    const tokenId = TokenId.fromBase58(tokenId58);
    const to = PublicKey.fromBase58(wallet);
    const rawAmount = decimalToRawUInt64(amount, decimals);
    const currentFeePayerNonce = await readAccountNonce(feePayerPub);
    if (currentFeePayerNonce === null) {
      throw new Error(`unable to read fee payer nonce for ${feePayerPub.toBase58()}`);
    }
    const nextFeePayerNonce = currentFeePayerNonce + 1n;
    const tx =
      asset === 'TMINA'
        ? await Mina.transaction(
            {
              sender: feePayerPub,
              fee: UInt64.from(TX_FEE),
              nonce: Number(currentFeePayerNonce)
            },
            async () => {
              const payer = AccountUpdate.createSigned(operatorPub);
              payer.send({ to, amount: rawAmount });
            }
          )
        : await (async () => {
            const tokenAddress58 = TOKEN_CONTRACT_ADDRESSES[asset];
            if (!tokenAddress58) {
              throw new Error(`missing token contract address for payout asset ${asset}`);
            }
            const tokenAddress = PublicKey.fromBase58(tokenAddress58);
            const token = new FungibleToken(tokenAddress);
            if (!fungibleTokenCompilePromise) fungibleTokenCompilePromise = FungibleToken.compile();
            await fungibleTokenCompilePromise;
            await fetchAccount({ publicKey: feePayerPub });
            await fetchAccount({ publicKey: operatorPub });
            await fetchAccount({ publicKey: operatorPub, tokenId });
            const receiverNeedsTokenAccount = !(await doesOnchainTokenAccountExist(wallet, tokenId58));
            const builtTx = await Mina.transaction(
              {
                sender: feePayerPub,
                fee: UInt64.from(TX_FEE),
                nonce: Number(currentFeePayerNonce)
              },
              async () => {
                if (receiverNeedsTokenAccount) {
                  AccountUpdate.fundNewAccount(feePayerPub, 1);
                }
                await token.transfer(operatorPub, to, rawAmount);
              }
            );
            const feePayerUpdate = builtTx.feePayer;
            if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
              feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
            }
            if (feePayerUpdate?.body) {
              feePayerUpdate.body.useFullCommitment = Bool(true);
            }
            return builtTx;
          })();
    await tx.prove();
    tx.sign([feePayerKey, operatorKey]);
    const sent = await tx.send();
    if (!sent?.hash) throw new Error(`missing tx hash for payout to ${wallet} token ${tokenId58}`);
    await waitForPayoutInclusion(sent, feePayerPub, nextFeePayerNonce);
    payoutTxs.push({ wallet, tokenId: tokenId58, txHash: sent.hash });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        batchId: pending.batchId,
        payoutCount: payoutTxs.length,
        payoutTxs
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[settlement-payout-executor] failed:', error);
  process.exit(1);
});
