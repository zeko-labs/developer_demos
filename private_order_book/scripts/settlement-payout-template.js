const API_BASE = (process.env.DARKPOOL_API || 'http://127.0.0.1:8791').replace(/\/$/, '');

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

async function main() {
  const data = await request('/api/darkpool/settlement/batches?limit=500');
  const pending = (data.batches || [])
    .filter((b) => b.status === 'pending')
    .sort((a, b) => Number(a.batchId) - Number(b.batchId))[0];

  if (!pending) {
    console.log(JSON.stringify({ ok: true, message: 'no pending batch' }, null, 2));
    return;
  }

  const payouts = Array.isArray(pending.payouts) ? pending.payouts : [];
  const template = {
    batchId: pending.batchId,
    payoutCount: payouts.length,
    payoutsRequired: payouts,
    payoutTxs: payouts.map((p) => ({
      wallet: p.wallet,
      tokenId: p.tokenId,
      txHash: 'PASTE_ONCHAIN_TX_HASH'
    })),
    markCommittedCurl:
      `curl -X POST ${API_BASE}/api/darkpool/settlement/mark-committed ` +
      `-H "content-type: application/json" ` +
      `-d '${JSON.stringify({ batchId: pending.batchId, txHash: 'PASTE_ZKAPP_TX_HASH', payoutTxs: payouts.map((p) => ({ wallet: p.wallet, tokenId: p.tokenId, txHash: 'PASTE_ONCHAIN_TX_HASH' })) })}'`
  };
  console.log(JSON.stringify({ ok: true, template }, null, 2));
}

main().catch((error) => {
  console.error('[settlement-payout-template] failed:', error);
  process.exit(1);
});
