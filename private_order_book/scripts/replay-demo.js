const API_BASE = (process.env.DARKPOOL_API || 'http://127.0.0.1:8791').replace(/\/$/, '');

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `request failed: ${path}`);
  return json;
}

async function main() {
  const makerWallet = process.env.REPLAY_MAKER_WALLET || 'B62qdemo_maker_wallet_replay';
  const takerWalletA = process.env.REPLAY_TAKER_WALLET_A || 'B62qdemo_taker_wallet_a';
  const takerWalletB = process.env.REPLAY_TAKER_WALLET_B || 'B62qdemo_taker_wallet_b';
  const pair = 'tETH/tZEKO';

  await request('/api/darkpool/accounts/sync-onchain', { method: 'POST', body: { wallet: makerWallet } });
  await request('/api/darkpool/accounts/sync-onchain', { method: 'POST', body: { wallet: takerWalletA } });
  await request('/api/darkpool/accounts/sync-onchain', { method: 'POST', body: { wallet: takerWalletB } });

  await request('/api/darkpool/maker/quote', {
    method: 'POST',
    headers: { 'x-maker-key': process.env.MAKER_API_KEY || 'demo-maker-key' },
    body: {
      wallet: makerWallet,
      pair,
      bidPrice: 63950,
      askPrice: 64050,
      bidSize: 1.2,
      askSize: 1.2,
      timeInForce: 'GTC',
      replace: true,
      makerTag: 'replay-mm',
      frontendId: 'maker.replay'
    }
  });

  const buy = await request('/api/darkpool/orders/place', {
    method: 'POST',
    body: {
      wallet: takerWalletA,
      pair,
      side: 'BUY',
      timeInForce: 'IOC',
      limitPrice: 64080,
      quantity: 0.4,
      privateMemo: 'replay buy',
      frontendId: 'partner.alpha'
    }
  });

  const sell = await request('/api/darkpool/orders/place', {
    method: 'POST',
    body: {
      wallet: takerWalletB,
      pair,
      side: 'SELL',
      timeInForce: 'IOC',
      limitPrice: 63920,
      quantity: 0.22,
      privateMemo: 'replay sell',
      frontendId: 'partner.beta'
    }
  });

  const status = await request('/api/darkpool/status');
  const fees = await request('/api/darkpool/frontends/fees');
  const batches = await request('/api/darkpool/settlement/batches?limit=20');

  console.log(
    JSON.stringify(
      {
        ok: true,
        replay: {
          buyMatchCount: buy.matchCount,
          sellMatchCount: sell.matchCount
        },
        pendingBatches: (batches.batches || []).filter((b) => b.status === 'pending').length,
        matching: status.matching,
        frontends: fees.frontends || []
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[replay-demo] failed:', error);
  process.exit(1);
});
