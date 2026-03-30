(function (globalScope) {
  'use strict';

  function joinUrl(baseUrl, path) {
    var base = String(baseUrl || '').replace(/\/$/, '');
    if (!path.startsWith('/')) return base + '/' + path;
    return base + path;
  }

  function ShadowBookClient(config) {
    var cfg = config || {};
    this.baseUrl = String(cfg.baseUrl || '').replace(/\/$/, '');
    this.frontendId = typeof cfg.frontendId === 'string' ? cfg.frontendId.trim().toLowerCase() : null;
    this.defaultHeaders = cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {};
  }

  ShadowBookClient.prototype.request = async function request(path, options) {
    var opts = options || {};
    var method = opts.method || 'GET';
    var headers = Object.assign({ 'content-type': 'application/json' }, this.defaultHeaders, opts.headers || {});
    var body = opts.body;

    var response = await fetch(joinUrl(this.baseUrl, path), {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    });

    var json = await response.json();
    if (!response.ok) {
      throw new Error(json.error || 'request failed');
    }
    return json;
  };

  ShadowBookClient.prototype.getMarkets = function getMarkets() {
    return this.request('/api/darkpool/markets');
  };

  ShadowBookClient.prototype.getBook = function getBook(market, levels) {
    var l = Number.isFinite(Number(levels)) ? Number(levels) : 20;
    var query = [];
    if (market && typeof market === 'object') {
      if (market.marketId) query.push('marketId=' + encodeURIComponent(String(market.marketId)));
      else if (market.baseTokenId && market.quoteTokenId) {
        query.push('baseTokenId=' + encodeURIComponent(String(market.baseTokenId)));
        query.push('quoteTokenId=' + encodeURIComponent(String(market.quoteTokenId)));
      } else if (market.pair) {
        query.push('pair=' + encodeURIComponent(String(market.pair)));
      }
    } else {
      query.push('pair=' + encodeURIComponent(String(market || 'tETH/tZEKO')));
    }
    query.push('levels=' + encodeURIComponent(String(l)));
    return this.request('/api/darkpool/book?' + query.join('&'));
  };

  ShadowBookClient.prototype.getTrades = function getTrades() {
    return this.request('/api/darkpool/trades');
  };

  ShadowBookClient.prototype.getCandles = function getCandles(params) {
    var p = params || {};
    var query = [];
    if (p.marketId) query.push('marketId=' + encodeURIComponent(String(p.marketId)));
    else if (p.pair) query.push('pair=' + encodeURIComponent(String(p.pair)));
    if (p.intervalSec !== undefined) query.push('intervalSec=' + encodeURIComponent(String(p.intervalSec)));
    if (p.limit !== undefined) query.push('limit=' + encodeURIComponent(String(p.limit)));
    return this.request('/api/darkpool/candles?' + query.join('&'));
  };

  ShadowBookClient.prototype.getStatus = function getStatus() {
    return this.request('/api/darkpool/status');
  };

  ShadowBookClient.prototype.getAudit = function getAudit(limit) {
    var l = Number.isFinite(Number(limit)) ? Number(limit) : 200;
    return this.request('/api/darkpool/fairness/audit?limit=' + encodeURIComponent(String(l)));
  };

  ShadowBookClient.prototype.getActivity = function getActivity(wallet, limit) {
    var w = encodeURIComponent(wallet || '');
    var l = Number.isFinite(Number(limit)) ? Number(limit) : 150;
    return this.request('/api/darkpool/activity?wallet=' + w + '&limit=' + encodeURIComponent(String(l)));
  };

  ShadowBookClient.prototype.getBalance = function getBalance(wallet) {
    return this.request('/api/darkpool/accounts/balance?wallet=' + encodeURIComponent(wallet || ''));
  };

  ShadowBookClient.prototype.getPretradeChecklist = function getPretradeChecklist(params) {
    var p = params || {};
    var query = [];
    if (p.wallet) query.push('wallet=' + encodeURIComponent(String(p.wallet)));
    if (p.marketId) query.push('marketId=' + encodeURIComponent(String(p.marketId)));
    if (p.side) query.push('side=' + encodeURIComponent(String(p.side)));
    if (p.orderType) query.push('orderType=' + encodeURIComponent(String(p.orderType)));
    if (p.quantity !== undefined) query.push('quantity=' + encodeURIComponent(String(p.quantity)));
    if (p.limitPrice !== undefined && p.limitPrice !== null) query.push('limitPrice=' + encodeURIComponent(String(p.limitPrice)));
    return this.request('/api/darkpool/accounts/pretrade?' + query.join('&'));
  };

  ShadowBookClient.prototype.fundBalance = function fundBalance(payload) {
    throw new Error('fundBalance is disabled in real-funds-only mode; use syncOnchainBalance()');
  };

  ShadowBookClient.prototype.syncOnchainBalance = function syncOnchainBalance(payload) {
    return this.request('/api/darkpool/accounts/sync-onchain', { method: 'POST', body: payload });
  };

  ShadowBookClient.prototype.placeOrder = function placeOrder(payload) {
    var order = Object.assign({}, payload || {});
    if (this.frontendId && !order.frontendId) order.frontendId = this.frontendId;
    return this.request('/api/darkpool/orders/place', { method: 'POST', body: order });
  };

  ShadowBookClient.prototype.cancelOrder = function cancelOrder(orderId, cancelToken) {
    return this.request('/api/darkpool/orders/' + encodeURIComponent(orderId) + '/cancel', {
      method: 'POST',
      body: { cancelToken: cancelToken }
    });
  };

  ShadowBookClient.prototype.replaceOrder = function replaceOrder(orderId, payload) {
    return this.request('/api/darkpool/orders/' + encodeURIComponent(orderId) + '/replace', {
      method: 'POST',
      body: payload || {}
    });
  };

  ShadowBookClient.prototype.getOrder = function getOrder(orderId, token) {
    return this.request('/api/darkpool/orders/' + encodeURIComponent(orderId) + '?token=' + encodeURIComponent(token));
  };

  ShadowBookClient.prototype.deposit = function deposit(payload) {
    return this.request('/api/darkpool/vault/deposit', { method: 'POST', body: payload });
  };

  ShadowBookClient.prototype.findLatestDepositTx = function findLatestDepositTx(payload) {
    return this.request('/api/darkpool/vault/deposit/find-latest', { method: 'POST', body: payload });
  };

  ShadowBookClient.prototype.buildDepositTransaction = function buildDepositTransaction(payload) {
    return this.request('/api/darkpool/vault/deposit/build-transaction', { method: 'POST', body: payload });
  };

  ShadowBookClient.prototype.submitSignedDepositTransaction = function submitSignedDepositTransaction(payload) {
    return this.request('/api/darkpool/vault/deposit/submit-signed', { method: 'POST', body: payload });
  };

  ShadowBookClient.prototype.depositAuto = function depositAuto(payload) {
    return this.request('/api/darkpool/vault/deposit-auto', { method: 'POST', body: payload });
  };

  ShadowBookClient.prototype.withdraw = function withdraw(payload) {
    return this.request('/api/darkpool/vault/withdraw', { method: 'POST', body: payload });
  };

  ShadowBookClient.prototype.claimFaucet = function claimFaucet(payload) {
    return this.request('/api/darkpool/faucet/claim', { method: 'POST', body: payload });
  };

  ShadowBookClient.prototype.redeemNote = function redeemNote(payload) {
    return this.request('/api/darkpool/notes/redeem', { method: 'POST', body: payload });
  };

  ShadowBookClient.prototype.getVaultPool = function getVaultPool() {
    return this.request('/api/darkpool/vault/pool');
  };

  ShadowBookClient.prototype.getNoteStatus = function getNoteStatus(note) {
    return this.request('/api/darkpool/notes/status?note=' + encodeURIComponent(note || ''));
  };

  ShadowBookClient.prototype.getNotesPortfolio = function getNotesPortfolio(wallet) {
    return this.request('/api/darkpool/notes/portfolio?wallet=' + encodeURIComponent(wallet || ''));
  };

  ShadowBookClient.prototype.getFrontendFees = function getFrontendFees(frontendId) {
    var id = frontendId || this.frontendId || '';
    var query = id ? '?frontendId=' + encodeURIComponent(id) : '';
    return this.request('/api/darkpool/frontends/fees' + query);
  };

  ShadowBookClient.prototype.getSettlementBatches = function getSettlementBatches(limit) {
    var l = Number.isFinite(Number(limit)) ? Number(limit) : 100;
    return this.request('/api/darkpool/settlement/batches?limit=' + encodeURIComponent(String(l)));
  };

  ShadowBookClient.prototype.getOperatorZkappState = function getOperatorZkappState(adminKey) {
    return this.request('/api/darkpool/operator/zkapp-state', {
      method: 'POST',
      body: adminKey ? { adminKey: String(adminKey) } : {}
    });
  };

  ShadowBookClient.prototype.getPrivateStateWitness = function getPrivateStateWitness(adminKey) {
    return this.request('/api/darkpool/operator/private-state-witness', {
      method: 'POST',
      body: adminKey ? { adminKey: String(adminKey) } : {}
    });
  };

  ShadowBookClient.prototype.getPrivateStateMerkle = function getPrivateStateMerkle(adminKey) {
    return this.request('/api/darkpool/operator/private-state-merkle', {
      method: 'POST',
      body: adminKey ? { adminKey: String(adminKey) } : {}
    });
  };

  ShadowBookClient.prototype.provePrivateState = function provePrivateState(adminKey) {
    return this.request('/api/darkpool/operator/private-state-proof', {
      method: 'POST',
      body: adminKey ? { adminKey: String(adminKey) } : {}
    });
  };

  ShadowBookClient.prototype.markBatchCommitted = function markBatchCommitted(payload) {
    return this.request('/api/darkpool/settlement/mark-committed', { method: 'POST', body: payload });
  };

  ShadowBookClient.prototype.getSettlementPayoutRequirements = function getSettlementPayoutRequirements(batchId) {
    return this.request('/api/darkpool/settlement/payout-requirements?batchId=' + encodeURIComponent(String(batchId || '')));
  };

  ShadowBookClient.prototype.commitNextLocal = function commitNextLocal() {
    return this.request('/api/darkpool/settlement/commit-next-local', { method: 'POST' });
  };

  ShadowBookClient.prototype.postMakerQuote = function postMakerQuote(payload, makerKey) {
    return this.request('/api/darkpool/maker/quote', {
      method: 'POST',
      body: payload,
      headers: makerKey ? { 'x-maker-key': makerKey } : {}
    });
  };

  ShadowBookClient.prototype.cancelMakerOrders = function cancelMakerOrders(payload, makerKey) {
    return this.request('/api/darkpool/maker/cancel-all', {
      method: 'POST',
      body: payload,
      headers: makerKey ? { 'x-maker-key': makerKey } : {}
    });
  };

  function createClient(config) {
    return new ShadowBookClient(config || {});
  }

  var sdk = {
    ShadowBookClient: ShadowBookClient,
    createClient: createClient
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = sdk;
  }
  globalScope.ShadowBookSDK = sdk;
})(typeof window !== 'undefined' ? window : globalThis);
