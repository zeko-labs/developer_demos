import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const API_BASE = (process.env.DARKPOOL_API || 'http://127.0.0.1:8791').replace(/\/$/, '');
const PAIR = (process.env.BOT_PAIR || 'sETH/sZEKO').toUpperCase();
const MARKET_ID = process.env.BOT_MARKET_ID || '';
const BASE_TOKEN_ID = process.env.BOT_BASE_TOKEN_ID || 'wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf';
const QUOTE_TOKEN_ID = process.env.BOT_QUOTE_TOKEN_ID || 'xpAptwG79jEStACsCv9C6yXUBmKbvurUo8GsTPYapn9QWB5zE5';
const BASE_ASSET = process.env.BOT_BASE_ASSET || 'sETH';
const QUOTE_ASSET = process.env.BOT_QUOTE_ASSET || 'sZEKO';
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
const MAX_TICKS = Number.parseInt(process.env.BOT_MAX_TICKS || '0', 10);
const MAX_TAKER_ORDERS = Number.parseInt(process.env.BOT_MAX_TAKER_ORDERS || '0', 10);
const MAX_TAKER_NOTIONAL = Number.parseFloat(process.env.BOT_MAX_TAKER_NOTIONAL || '0');
const MAKER_ONLY = String(process.env.BOT_MAKER_ONLY || 'false').toLowerCase() === 'true';
const STOP_ON_LOW_BALANCE = String(process.env.BOT_STOP_ON_LOW_BALANCE || 'false').toLowerCase() === 'true';
const MAKER_VISIBILITY = String(process.env.BOT_MAKER_VISIBILITY || 'public').toLowerCase() === 'private' ? 'private' : 'public';
const TAKER_VISIBILITY = String(process.env.BOT_TAKER_VISIBILITY || process.env.BOT_VISIBILITY || 'private').toLowerCase() === 'private' ? 'private' : 'public';
const TAKER_PRIVATE_KEY = String(process.env.BOT_TAKER_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY || '').trim();
const INVENTORY_MODE = String(process.env.BOT_INVENTORY_MODE || 'coordinated').toLowerCase();
const TARGET_BASE_SHARE = Number.parseFloat(process.env.BOT_TARGET_BASE_SHARE || '0.5');
const NOTE_RESERVE_BASE = Number.parseFloat(process.env.BOT_NOTE_RESERVE_BASE || '0.002');
const NOTE_RESERVE_QUOTE = Number.parseFloat(process.env.BOT_NOTE_RESERVE_QUOTE || '0.08');
const MIN_QUOTE_SIZE = Number.parseFloat(process.env.BOT_MIN_QUOTE_SIZE || '0.0005');
const MAX_PENDING_SETTLEMENT_BATCHES = Number.parseInt(process.env.BOT_MAX_PENDING_SETTLEMENT_BATCHES || '0', 10);

const AUTO_FUND = String(process.env.BOT_AUTO_FUND || 'false').toLowerCase() === 'true';
const BOT_REAL_FUNDS = String(process.env.BOT_REAL_FUNDS || 'true').toLowerCase() === 'true';
const AUTO_FUND_MAKER_QUOTE = Number.parseFloat(process.env.BOT_AUTO_FUND_MAKER_QUOTE || '250000');
const AUTO_FUND_MAKER_BASE = Number.parseFloat(process.env.BOT_AUTO_FUND_MAKER_BASE || '8000');
const AUTO_FUND_TAKER_QUOTE = Number.parseFloat(process.env.BOT_AUTO_FUND_TAKER_QUOTE || '120000');
const AUTO_FUND_TAKER_BASE = Number.parseFloat(process.env.BOT_AUTO_FUND_TAKER_BASE || '4000');

const MIN_MAKER_QUOTE = Number.parseFloat(process.env.BOT_MIN_MAKER_QUOTE || '0.2');
const MIN_MAKER_BASE = Number.parseFloat(process.env.BOT_MIN_MAKER_BASE || '0.01');
const MIN_TAKER_QUOTE = Number.parseFloat(process.env.BOT_MIN_TAKER_QUOTE || '0.1');
const MIN_TAKER_BASE = Number.parseFloat(process.env.BOT_MIN_TAKER_BASE || '0.005');

const FRONTEND_MAKER = process.env.BOT_FRONTEND_MAKER || 'bot.maker';
const FRONTEND_TAKER = process.env.BOT_FRONTEND_TAKER || 'bot.taker';

let syntheticMid = null;
let tick = 0;
let placed = 0;
let fillsSeen = 0;
let takerNotional = 0;
let signerClientPromise = null;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function ensureConfiguredWallet(label, wallet) {
  const value = String(wallet || '').trim();
  if (!value || value.includes('_') || !value.startsWith('B62q')) {
    throw new Error(`${label} must be a real Zeko/Mina public key, got ${value || '(empty)'}`);
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

async function getSignerClient() {
  if (!signerClientPromise) {
    const o1jsEntry = require.resolve('o1js');
    const signerPath = path.join(path.dirname(o1jsEntry), 'mina-signer', 'mina-signer.js');
    signerClientPromise = import(pathToFileURL(signerPath).href).then((mod) => {
      const Client = mod.default;
      return new Client({ network: 'testnet' });
    });
  }
  return signerClientPromise;
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

async function getNotesPortfolio(wallet) {
  return request(`/api/darkpool/notes/portfolio?wallet=${encodeURIComponent(wallet)}`);
}

async function getSettlementBatches(limit = 20) {
  return request(`/api/darkpool/settlement/batches?limit=${encodeURIComponent(String(limit))}`);
}

async function getPretrade({ wallet, marketId, side, orderType, quantity, limitPrice }) {
  const query = new URLSearchParams({
    wallet,
    marketId,
    side,
    orderType,
    quantity: String(quantity)
  });
  if (limitPrice !== null && limitPrice !== undefined) query.set('limitPrice', String(limitPrice));
  return request(`/api/darkpool/accounts/pretrade?${query.toString()}`);
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

function noteBalance(portfolio, asset) {
  return getAssetBalance(portfolio?.outstandingByAsset || {}, asset);
}

function reserveForAsset(asset) {
  return String(asset || '').toUpperCase() === String(BASE_ASSET).toUpperCase()
    ? NOTE_RESERVE_BASE
    : NOTE_RESERVE_QUOTE;
}

function spendableNoteBalance(portfolio, asset) {
  return Math.max(0, noteBalance(portfolio, asset) - reserveForAsset(asset));
}

function baseShare(portfolio, mid) {
  const base = noteBalance(portfolio, BASE_ASSET);
  const quote = noteBalance(portfolio, QUOTE_ASSET);
  const quoteAsBase = mid > 0 ? quote / mid : 0;
  const total = base + quoteAsBase;
  if (!(total > 1e-9)) return 0.5;
  return base / total;
}

function chooseCoordinatedSide({ makerPortfolio, takerPortfolio, mid }) {
  if (INVENTORY_MODE !== 'coordinated') return Math.random() < 0.5 ? 'BUY' : 'SELL';

  const target = Math.min(0.9, Math.max(0.1, TARGET_BASE_SHARE));
  const makerShare = baseShare(makerPortfolio, mid);
  const takerShare = baseShare(takerPortfolio, mid);

  const buyCapacity =
    spendableNoteBalance(takerPortfolio, QUOTE_ASSET) > MIN_TAKER_QUOTE &&
    spendableNoteBalance(makerPortfolio, BASE_ASSET) > MIN_MAKER_BASE;
  const sellCapacity =
    spendableNoteBalance(takerPortfolio, BASE_ASSET) > MIN_TAKER_BASE &&
    spendableNoteBalance(makerPortfolio, QUOTE_ASSET) > MIN_MAKER_QUOTE;

  const buyScore = Math.max(0, target - takerShare) + Math.max(0, makerShare - target);
  const sellScore = Math.max(0, takerShare - target) + Math.max(0, target - makerShare);

  if (buyCapacity && !sellCapacity) return 'BUY';
  if (sellCapacity && !buyCapacity) return 'SELL';
  if (!buyCapacity && !sellCapacity) return null;
  if (Math.abs(buyScore - sellScore) < 0.05) return tick % 2 === 0 ? 'BUY' : 'SELL';
  return buyScore > sellScore ? 'BUY' : 'SELL';
}

function pickMid(market) {
  const anchor =
    market.indicativeMid ?? market.referencePrice ?? market.bestBid ?? market.bestAsk ?? 64000;
  if (!Number.isFinite(syntheticMid) || syntheticMid <= 0) syntheticMid = Number(anchor);
  const jitter = syntheticMid * (rand(-EXTERNAL_VOL_BPS, EXTERNAL_VOL_BPS) / 10000);
  syntheticMid = Math.max(1, syntheticMid + jitter);
  return syntheticMid;
}

async function placeMakerQuote(mid, market, makerPortfolio = null) {
  const halfSpread = mid * (QUOTE_SPREAD_BPS / 20000);
  const bid = Math.max(1, mid - halfSpread);
  const ask = Math.max(bid + 0.5, mid + halfSpread);
  const maxBidSize = makerPortfolio
    ? spendableNoteBalance(makerPortfolio, QUOTE_ASSET) / bid
    : QUOTE_SIZE;
  const maxAskSize = makerPortfolio
    ? spendableNoteBalance(makerPortfolio, BASE_ASSET)
    : QUOTE_SIZE;
  const quoteSize = Math.min(QUOTE_SIZE, maxBidSize, maxAskSize);

  if (!(quoteSize >= MIN_QUOTE_SIZE)) {
    console.log(
      `[arb-bot] maker quote skipped: spendable ${QUOTE_ASSET}=${spendableNoteBalance(makerPortfolio, QUOTE_ASSET).toFixed(6)} ` +
      `${BASE_ASSET}=${spendableNoteBalance(makerPortfolio, BASE_ASSET).toFixed(6)} minSize=${MIN_QUOTE_SIZE}`
    );
    return null;
  }

  return request('/api/darkpool/maker/quote', {
    method: 'POST',
    headers: { 'x-maker-key': MAKER_API_KEY },
    body: {
      wallet: MAKER_WALLET,
      marketId: market.marketId,
      bidPrice: Number(bid.toFixed(2)),
      askPrice: Number(ask.toFixed(2)),
      bidSize: Number(quoteSize.toFixed(6)),
      askSize: Number(quoteSize.toFixed(6)),
      timeInForce: 'GTC',
      visibility: MAKER_VISIBILITY,
      replace: true,
      makerTag: 'arb-bot-maker',
      frontendId: FRONTEND_MAKER
    }
  });
}

async function createOrderAuthorization({ market, side, price, qty, fundingNoteHashes }) {
  if (!TAKER_PRIVATE_KEY) return null;
  const nonce = `ord_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  const expiresAtUnixMs = Date.now() + 5 * 60 * 1000;
  const payload = stableStringify({
    wallet: TAKER_WALLET,
    marketId: market.marketId,
    baseTokenId: market.baseTokenId,
    quoteTokenId: market.quoteTokenId,
    side,
    orderType: 'LIMIT',
    timeInForce: 'IOC',
    limitPrice: Number(price.toFixed(2)),
    quantity: Number(qty.toFixed(6)),
    fundingNoteHashes,
    visibility: TAKER_VISIBILITY,
    frontendId: FRONTEND_TAKER || null,
    nonce,
    expiresAtUnixMs
  });
  const signer = await getSignerClient();
  const signed = signer.signMessage(payload, TAKER_PRIVATE_KEY);
  if (signed.publicKey !== TAKER_WALLET) {
    throw new Error(`BOT_TAKER_WALLET (${TAKER_WALLET}) does not match BOT_TAKER_PRIVATE_KEY public key (${signed.publicKey})`);
  }
  return {
    publicKey: signed.publicKey,
    payload,
    nonce,
    expiresAtUnixMs,
    signature: signed.signature,
    method: 'mina-signer:testnet'
  };
}

async function placeTakerOrder(market, side, price, qty, fundingNoteHashes = []) {
  const orderAuthorization = await createOrderAuthorization({ market, side, price, qty, fundingNoteHashes });
  return request('/api/darkpool/orders/place', {
    method: 'POST',
    body: {
      wallet: TAKER_WALLET,
      marketId: market.marketId,
      side,
      orderType: 'LIMIT',
      timeInForce: 'IOC',
      limitPrice: Number(price.toFixed(2)),
      quantity: Number(qty.toFixed(6)),
      fundingNoteHashes,
      visibility: TAKER_VISIBILITY,
      orderAuthorization,
      privateMemo: 'arb-bot-ioc',
      frontendId: FRONTEND_TAKER
    }
  });
}

async function maybeTopup() {
  ensureConfiguredWallet('BOT_MAKER_WALLET', MAKER_WALLET);
  ensureConfiguredWallet('BOT_TAKER_WALLET', TAKER_WALLET);

  if (BOT_REAL_FUNDS) {
    await syncOnchain(MAKER_WALLET);
    await syncOnchain(TAKER_WALLET);
  }

  const maker = await getBalances(MAKER_WALLET);
  const taker = await getBalances(TAKER_WALLET);
  const makerPortfolio = await getNotesPortfolio(MAKER_WALLET);
  const takerPortfolio = await getNotesPortfolio(TAKER_WALLET);

  const makerQuote = noteBalance(makerPortfolio, QUOTE_ASSET);
  const makerBase = noteBalance(makerPortfolio, BASE_ASSET);
  const takerQuote = noteBalance(takerPortfolio, QUOTE_ASSET);
  const takerBase = noteBalance(takerPortfolio, BASE_ASSET);

  if (AUTO_FUND) {
    if (BOT_REAL_FUNDS) return;
    console.log('[arb-bot] BOT_AUTO_FUND requested but manual funding endpoint is removed in real-funds-only mode.');
    return;
  }

  const lowBalance = makerQuote < MIN_MAKER_QUOTE || makerBase < MIN_MAKER_BASE || takerQuote < MIN_TAKER_QUOTE || takerBase < MIN_TAKER_BASE;
  if (lowBalance) {
    const message =
      `[arb-bot] low balances: maker(${QUOTE_ASSET}=${makerQuote.toFixed(2)}, ${BASE_ASSET}=${makerBase.toFixed(5)}), ` +
      `taker(${QUOTE_ASSET}=${takerQuote.toFixed(2)}, ${BASE_ASSET}=${takerBase.toFixed(5)}). ` +
      (BOT_REAL_FUNDS
        ? `Add private notes to bot wallets. On-chain maker(${QUOTE_ASSET}=${getAssetBalance(maker, QUOTE_ASSET).toFixed(2)}, ${BASE_ASSET}=${getAssetBalance(maker, BASE_ASSET).toFixed(5)}), ` +
          `taker(${QUOTE_ASSET}=${getAssetBalance(taker, QUOTE_ASSET).toFixed(2)}, ${BASE_ASSET}=${getAssetBalance(taker, BASE_ASSET).toFixed(5)}).`
        : 'Add funds or set BOT_AUTO_FUND=true.');
    if (STOP_ON_LOW_BALANCE) throw new Error(message);
    console.log(message);
  }
}

async function runOneCycle() {
  tick += 1;
  const market = await getMarket();
  const mid = pickMid(market);
  const makerPortfolio = await getNotesPortfolio(MAKER_WALLET);
  const takerPortfolio = await getNotesPortfolio(TAKER_WALLET);

  if (MAX_PENDING_SETTLEMENT_BATCHES > 0) {
    const settlement = await getSettlementBatches(Math.max(MAX_PENDING_SETTLEMENT_BATCHES + 5, 20));
    const pending = (settlement.batches || []).filter((batch) => batch?.status === 'pending').length;
    if (pending > MAX_PENDING_SETTLEMENT_BATCHES) {
      console.log(`[arb-bot] settlement back-pressure: pending=${pending} cap=${MAX_PENDING_SETTLEMENT_BATCHES}, skipping tick`);
      return;
    }
  }

  await placeMakerQuote(mid, market, makerPortfolio);

  if (MAKER_ONLY) {
    console.log(`[arb-bot] tick=${tick} mid=${mid.toFixed(2)} maker-only quote-updated`);
  } else if (Math.random() < TAKER_PROB) {
    const book = await getBook(market.marketId, 3);
    const bestBid = Number(book.depth?.bids?.[0]?.price || 0);
    const bestAsk = Number(book.depth?.asks?.[0]?.price || 0);
    const misprice = mid * (MISPRICE_BPS / 10000);
    const qty = rand(TAKER_SIZE_MIN, TAKER_SIZE_MAX);

    let side = chooseCoordinatedSide({ makerPortfolio, takerPortfolio, mid });
    let limit = null;

    if (!side) {
      console.log(
        `[arb-bot] inventory blocked: maker(${QUOTE_ASSET}=${noteBalance(makerPortfolio, QUOTE_ASSET).toFixed(4)}, ` +
        `${BASE_ASSET}=${noteBalance(makerPortfolio, BASE_ASSET).toFixed(6)}) taker(${QUOTE_ASSET}=${noteBalance(takerPortfolio, QUOTE_ASSET).toFixed(4)}, ` +
        `${BASE_ASSET}=${noteBalance(takerPortfolio, BASE_ASSET).toFixed(6)})`
      );
      return;
    }

    if (side === 'BUY' && bestAsk > 0 && bestAsk < mid - misprice) {
      limit = bestAsk * 1.001;
    } else if (side === 'SELL' && bestBid > 0 && bestBid > mid + misprice) {
      limit = bestBid * 0.999;
    } else {
      limit = side === 'BUY' ? mid * 1.002 : mid * 0.998;
    }

    const maxQtyFromTaker = side === 'BUY'
      ? spendableNoteBalance(takerPortfolio, QUOTE_ASSET) / limit
      : spendableNoteBalance(takerPortfolio, BASE_ASSET);
    const maxQtyFromMaker = side === 'BUY'
      ? spendableNoteBalance(makerPortfolio, BASE_ASSET)
      : spendableNoteBalance(makerPortfolio, QUOTE_ASSET) / limit;
    const inventoryQty = Math.min(qty, maxQtyFromTaker, maxQtyFromMaker, QUOTE_SIZE);
    if (!(inventoryQty >= MIN_QUOTE_SIZE)) {
      console.log(
        `[arb-bot] taker skipped: side=${side} inventoryQty=${inventoryQty.toFixed(6)} minSize=${MIN_QUOTE_SIZE} ` +
        `makerShare=${baseShare(makerPortfolio, mid).toFixed(3)} takerShare=${baseShare(takerPortfolio, mid).toFixed(3)}`
      );
      return;
    }

    const finalQty = Number(inventoryQty.toFixed(6));
    const orderNotional = Number((limit * finalQty).toFixed(9));
    if (MAX_TAKER_ORDERS > 0 && placed >= MAX_TAKER_ORDERS) {
      console.log(`[arb-bot] taker cap reached: totalOrders=${placed}, skipping taker`);
      return;
    }
    if (MAX_TAKER_NOTIONAL > 0 && takerNotional + orderNotional > MAX_TAKER_NOTIONAL + 1e-9) {
      console.log(
        `[arb-bot] notional cap reached: next=${orderNotional.toFixed(6)} ` +
        `used=${takerNotional.toFixed(6)} cap=${MAX_TAKER_NOTIONAL.toFixed(6)}, skipping taker`
      );
      return;
    }

    const pretrade = await getPretrade({
      wallet: TAKER_WALLET,
      marketId: market.marketId,
      side,
      orderType: 'LIMIT',
      quantity: finalQty,
      limitPrice: Number(limit.toFixed(2))
    });
    if (!pretrade.funded || !pretrade.walletLinked || !pretrade.syncFresh) {
      console.log(
        `[arb-bot] pretrade blocked: walletLinked=${pretrade.walletLinked} syncFresh=${pretrade.syncFresh} ` +
        `funded=${pretrade.funded} required=${pretrade.required?.amount ?? '-'} ${pretrade.required?.asset ?? ''}`
      );
      return;
    }
    if (BOT_REAL_FUNDS && !TAKER_PRIVATE_KEY) {
      console.log('[arb-bot] pretrade blocked: BOT_TAKER_PRIVATE_KEY or AGENT_PRIVATE_KEY is required for signed real-funds orders');
      return;
    }

    const result = await placeTakerOrder(market, side, limit, finalQty);
    placed += 1;
    takerNotional = Number((takerNotional + orderNotional).toFixed(9));
    const matched = Number(result.matchCount || 0);
    fillsSeen += matched;

    console.log(
      `[arb-bot] tick=${tick} mid=${mid.toFixed(2)} ${side} qty=${finalQty.toFixed(5)} px=${Number(limit).toFixed(2)} ` +
      `matches=${matched} totalOrders=${placed} totalMatches=${fillsSeen} takerNotional=${takerNotional.toFixed(6)} ` +
      `makerShare=${baseShare(makerPortfolio, mid).toFixed(3)} takerShare=${baseShare(takerPortfolio, mid).toFixed(3)}`
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
    MAX_TICKS,
    MAX_TAKER_ORDERS,
    MAX_TAKER_NOTIONAL,
    MAKER_ONLY,
    makerVisibility: MAKER_VISIBILITY,
    takerVisibility: TAKER_VISIBILITY,
    INVENTORY_MODE,
    TARGET_BASE_SHARE,
    NOTE_RESERVE_BASE,
    NOTE_RESERVE_QUOTE,
    MIN_QUOTE_SIZE,
    MAX_PENDING_SETTLEMENT_BATCHES,
    AUTO_FUND,
    BOT_REAL_FUNDS,
    STOP_ON_LOW_BALANCE,
    signerConfigured: Boolean(TAKER_PRIVATE_KEY)
  });

  await maybeTopup();

  while (true) {
    try {
      await runOneCycle();
      if (tick % 10 === 0) await maybeTopup();
    } catch (error) {
      console.error('[arb-bot] cycle error:', error.message || error);
      if (STOP_ON_LOW_BALANCE || MAX_TICKS > 0) throw error;
    }

    if (MAX_TICKS > 0 && tick >= MAX_TICKS) {
      console.log(`[arb-bot] max ticks reached: ${tick}`);
      break;
    }
    if (MAX_TAKER_ORDERS > 0 && placed >= MAX_TAKER_ORDERS) {
      console.log(`[arb-bot] max taker orders reached: ${placed}`);
      break;
    }
    if (MAX_TAKER_NOTIONAL > 0 && takerNotional >= MAX_TAKER_NOTIONAL - 1e-9) {
      console.log(`[arb-bot] max taker notional reached: ${takerNotional.toFixed(6)}`);
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, Math.max(400, LOOP_MS)));
  }
}

main().catch((error) => {
  console.error('[arb-bot] fatal:', error);
  process.exit(1);
});
