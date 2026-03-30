const API_BASE = (process.env.DARKPOOL_API || 'http://127.0.0.1:8791').replace(/\/$/, '');
const PAIR = (process.env.BOT_PAIR || 'tETH/tZEKO').toUpperCase();
const MARKET_ID = process.env.BOT_MARKET_ID || '';
const BASE_TOKEN_ID = process.env.BOT_BASE_TOKEN_ID || 'wpWnRKT383VPM2TWtBWs8R4i927SKUgzAycsSs3AyvyriGXyP2';
const QUOTE_TOKEN_ID = process.env.BOT_QUOTE_TOKEN_ID || 'x3jovPY75iFmbZ5kTfxZmNmEQ6874mmBu3jufom1QsxMNqPx27';
const BASE_ASSET = process.env.BOT_BASE_ASSET || 'tETH';
const QUOTE_ASSET = process.env.BOT_QUOTE_ASSET || 'tZEKO';
const MAKER_WALLET = process.env.BOT_MAKER_WALLET || 'B62qbot_maker_wallet';
const TAKER_WALLET = process.env.BOT_TAKER_WALLET || 'B62qbot_taker_wallet';
const MAKER_API_KEY = process.env.MAKER_API_KEY || 'demo-maker-key';

const LOOP_MS = Number.parseInt(process.env.BOT_LOOP_MS || '2200', 10);
const QUOTE_SPREAD_BPS = Number.parseFloat(process.env.BOT_QUOTE_SPREAD_BPS || '18');
const QUOTE_SIZE = Number.parseFloat(process.env.BOT_QUOTE_SIZE || '0.14');
const TAKER_SIZE_MIN = Number.parseFloat(process.env.BOT_TAKER_SIZE_MIN || '0.02');
const TAKER_SIZE_MAX = Number.parseFloat(process.env.BOT_TAKER_SIZE_MAX || '0.09');
const TAKER_PROB = Number.parseFloat(process.env.BOT_TAKER_PROB || '0.7');
const MISPRICE_BPS = Number.parseFloat(process.env.BOT_MISPRICE_BPS || '6');
const EXTERNAL_VOL_BPS = Number.parseFloat(process.env.BOT_EXTERNAL_VOL_BPS || '10');

const AUTO_FUND = String(process.env.BOT_AUTO_FUND || 'false').toLowerCase() === 'true';
const BOT_REAL_FUNDS = String(process.env.BOT_REAL_FUNDS || 'true').toLowerCase() === 'true';
const AUTO_FUND_MAKER_QUOTE = Number.parseFloat(process.env.BOT_AUTO_FUND_MAKER_QUOTE || '250000');
const AUTO_FUND_MAKER_BASE = Number.parseFloat(process.env.BOT_AUTO_FUND_MAKER_BASE || '8000');
const AUTO_FUND_TAKER_QUOTE = Number.parseFloat(process.env.BOT_AUTO_FUND_TAKER_QUOTE || '120000');
const AUTO_FUND_TAKER_BASE = Number.parseFloat(process.env.BOT_AUTO_FUND_TAKER_BASE || '4000');

const MIN_MAKER_QUOTE = Number.parseFloat(process.env.BOT_MIN_MAKER_QUOTE || '20000');
const MIN_MAKER_BASE = Number.parseFloat(process.env.BOT_MIN_MAKER_BASE || '500');
const MIN_TAKER_QUOTE = Number.parseFloat(process.env.BOT_MIN_TAKER_QUOTE || '12000');
const MIN_TAKER_BASE = Number.parseFloat(process.env.BOT_MIN_TAKER_BASE || '250');

const FRONTEND_MAKER = process.env.BOT_FRONTEND_MAKER || 'bot.maker';
const FRONTEND_TAKER = process.env.BOT_FRONTEND_TAKER || 'bot.taker';

let syntheticMid = null;
let tick = 0;
let placed = 0;
let fillsSeen = 0;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

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

async function getMarket() {
  const data = await request('/api/darkpool/markets');
  let m = null;
  if (MARKET_ID) {
    m = (data.markets || []).find((x) => String(x.marketId || '') === MARKET_ID);
  }
  if (!m && BASE_TOKEN_ID && QUOTE_TOKEN_ID) {
    m = (data.markets || []).find(
      (x) => String(x.baseTokenId || '') === BASE_TOKEN_ID && String(x.quoteTokenId || '') === QUOTE_TOKEN_ID
    );
  }
  if (!m) {
    m = (data.markets || []).find((x) => String(x.pair || '').toUpperCase() === PAIR);
  }
  if (!m) throw new Error(`pair not found: ${PAIR}`);
  return m;
}

async function getBook(marketId, levels = 5) {
  return request(`/api/darkpool/book?marketId=${encodeURIComponent(marketId)}&levels=${levels}`);
}

async function getBalances(wallet) {
  const data = await request(`/api/darkpool/accounts/balance?wallet=${encodeURIComponent(wallet)}`);
  return data.balances || {};
}

async function syncOnchain(wallet) {
  return request('/api/darkpool/accounts/sync-onchain', {
    method: 'POST',
    body: { wallet }
  });
}

function getAssetBalance(balances, asset) {
  const raw = balances || {};
  if (Object.prototype.hasOwnProperty.call(raw, asset)) return Number(raw[asset] || 0);
  const upper = String(asset || '').toUpperCase();
  const lower = String(asset || '').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(raw, upper)) return Number(raw[upper] || 0);
  if (Object.prototype.hasOwnProperty.call(raw, lower)) return Number(raw[lower] || 0);
  return 0;
}

function pickMid(market) {
  const anchor =
    market.indicativeMid ?? market.referencePrice ?? market.bestBid ?? market.bestAsk ?? 64000;
  if (!Number.isFinite(syntheticMid) || syntheticMid <= 0) syntheticMid = Number(anchor);
  const jitter = syntheticMid * (rand(-EXTERNAL_VOL_BPS, EXTERNAL_VOL_BPS) / 10000);
  syntheticMid = Math.max(1, syntheticMid + jitter);
  return syntheticMid;
}

async function placeMakerQuote(mid, market) {
  const halfSpread = mid * (QUOTE_SPREAD_BPS / 20000);
  const bid = Math.max(1, mid - halfSpread);
  const ask = Math.max(bid + 0.5, mid + halfSpread);

  return request('/api/darkpool/maker/quote', {
    method: 'POST',
    headers: { 'x-maker-key': MAKER_API_KEY },
    body: {
      wallet: MAKER_WALLET,
      marketId: market.marketId,
      bidPrice: Number(bid.toFixed(2)),
      askPrice: Number(ask.toFixed(2)),
      bidSize: Number(QUOTE_SIZE.toFixed(6)),
      askSize: Number(QUOTE_SIZE.toFixed(6)),
      timeInForce: 'GTC',
      replace: true,
      makerTag: 'arb-bot-maker',
      frontendId: FRONTEND_MAKER
    }
  });
}

async function placeTakerOrder(market, side, price, qty) {
  return request('/api/darkpool/orders/place', {
    method: 'POST',
    body: {
      wallet: TAKER_WALLET,
      marketId: market.marketId,
      side,
      timeInForce: 'IOC',
      limitPrice: Number(price.toFixed(2)),
      quantity: Number(qty.toFixed(6)),
      privateMemo: 'arb-bot-ioc',
      frontendId: FRONTEND_TAKER
    }
  });
}

async function maybeTopup() {
  if (BOT_REAL_FUNDS) {
    await syncOnchain(MAKER_WALLET);
    await syncOnchain(TAKER_WALLET);
  }

  const maker = await getBalances(MAKER_WALLET);
  const taker = await getBalances(TAKER_WALLET);

  const makerQuote = getAssetBalance(maker, QUOTE_ASSET);
  const makerBase = getAssetBalance(maker, BASE_ASSET);
  const takerQuote = getAssetBalance(taker, QUOTE_ASSET);
  const takerBase = getAssetBalance(taker, BASE_ASSET);

  if (AUTO_FUND) {
    if (BOT_REAL_FUNDS) return;
    console.log('[arb-bot] BOT_AUTO_FUND requested but manual funding endpoint is removed in real-funds-only mode.');
    return;
  }

  if (makerQuote < MIN_MAKER_QUOTE || makerBase < MIN_MAKER_BASE || takerQuote < MIN_TAKER_QUOTE || takerBase < MIN_TAKER_BASE) {
    console.log(
      `[arb-bot] low balances: maker(${QUOTE_ASSET}=${makerQuote.toFixed(2)}, ${BASE_ASSET}=${makerBase.toFixed(5)}), ` +
      `taker(${QUOTE_ASSET}=${takerQuote.toFixed(2)}, ${BASE_ASSET}=${takerBase.toFixed(5)}). ` +
      (BOT_REAL_FUNDS ? 'Add real on-chain token balances to bot wallets.' : 'Add funds or set BOT_AUTO_FUND=true.')
    );
  }
}

async function runOneCycle() {
  tick += 1;
  const market = await getMarket();
  const mid = pickMid(market);

  await placeMakerQuote(mid, market);

  if (Math.random() < TAKER_PROB) {
    const book = await getBook(market.marketId, 3);
    const bestBid = Number(book.depth?.bids?.[0]?.price || 0);
    const bestAsk = Number(book.depth?.asks?.[0]?.price || 0);
    const misprice = mid * (MISPRICE_BPS / 10000);
    const qty = rand(TAKER_SIZE_MIN, TAKER_SIZE_MAX);

    let side = null;
    let limit = null;

    if (bestAsk > 0 && bestAsk < mid - misprice) {
      side = 'BUY';
      limit = bestAsk * 1.001;
    } else if (bestBid > 0 && bestBid > mid + misprice) {
      side = 'SELL';
      limit = bestBid * 0.999;
    } else {
      side = Math.random() < 0.5 ? 'BUY' : 'SELL';
      limit = side === 'BUY' ? mid * 1.002 : mid * 0.998;
    }

    const result = await placeTakerOrder(market, side, limit, qty);
    placed += 1;
    const matched = Number(result.matchCount || 0);
    fillsSeen += matched;

    console.log(
      `[arb-bot] tick=${tick} mid=${mid.toFixed(2)} ${side} qty=${qty.toFixed(5)} px=${Number(limit).toFixed(2)} ` +
      `matches=${matched} totalOrders=${placed} totalMatches=${fillsSeen}`
    );
  } else {
    console.log(`[arb-bot] tick=${tick} mid=${mid.toFixed(2)} quote-updated only`);
  }
}

async function main() {
  console.log('[arb-bot] starting', {
    API_BASE,
    PAIR,
    MARKET_ID,
    BASE_TOKEN_ID,
    QUOTE_TOKEN_ID,
    BASE_ASSET,
    QUOTE_ASSET,
    MAKER_WALLET,
    TAKER_WALLET,
    LOOP_MS,
    QUOTE_SPREAD_BPS,
    QUOTE_SIZE,
    TAKER_PROB,
    AUTO_FUND,
    BOT_REAL_FUNDS
  });

  await maybeTopup();

  while (true) {
    try {
      await runOneCycle();
      if (tick % 10 === 0) await maybeTopup();
    } catch (error) {
      console.error('[arb-bot] cycle error:', error.message || error);
    }

    await new Promise((resolve) => setTimeout(resolve, Math.max(400, LOOP_MS)));
  }
}

main().catch((error) => {
  console.error('[arb-bot] fatal:', error);
  process.exit(1);
});
