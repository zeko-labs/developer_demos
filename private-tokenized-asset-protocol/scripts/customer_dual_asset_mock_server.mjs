#!/usr/bin/env node
import http from 'node:http';

const PORT = Number(process.env.CUSTOMER_DUAL_ASSET_MOCK_PORT || 4516);

const balance = {
  account_id: 'acct_demo_001',
  customer_id: 'cust_demo_001',
  currency: 'USD',
  current_balance_cents: 2500000,
  available_balance_cents: 2400000,
  account_status: 'open',
  eligible: true,
  score: 92
};

const kyc = {
  customer_id: 'cust_demo_001',
  kyc_passed: true,
  jurisdiction: 'US',
  risk_tier: 'standard',
  risk_score: 88
};

const holdings = {
  account_id: 'acct_eq_001',
  security_id: 'sec_fund_a',
  position_quantity: '1250.00',
  position_status: 'settled',
  as_of: '2026-03-17T15:00:00Z',
  position_eligible: true,
  position_score: 90
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify({ service: 'customer-dual-asset-mock', status: 'ok' }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/accounts/acct_demo_001/balance') {
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify(balance));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/customers/cust_demo_001/kyc-status') {
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify(kyc));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/accounts/acct_eq_001/positions/sec_fund_a') {
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify(holdings));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json', connection: 'close' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[customer-dual-asset-mock] listening on http://127.0.0.1:${PORT}`);
});
