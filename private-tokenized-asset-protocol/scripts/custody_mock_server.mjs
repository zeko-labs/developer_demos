#!/usr/bin/env node
import http from 'node:http';

const PORT = Number(process.env.CUSTODY_MOCK_PORT || 4512);

const holdingsByAccount = {
  acct_sandbox_demo_001: {
    holdings: [
      {
        symbol: 'DEMO',
        units: 250,
        certificateId: 'cert_demo_001',
        certificateStatus: 'verified'
      }
    ]
  },
  acct_sandbox_restricted_001: {
    holdings: [
      {
        symbol: 'DEMO',
        units: 0,
        certificateId: 'cert_demo_002',
        certificateStatus: 'pending'
      }
    ]
  }
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && url.pathname.startsWith('/v1/accounts/') && url.pathname.endsWith('/holdings')) {
    const parts = url.pathname.split('/').filter(Boolean);
    const accountId = decodeURIComponent(parts[2] || '');
    const body = holdingsByAccount[accountId];
    if (!body) {
      res.writeHead(404, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    const symbol = url.searchParams.get('symbol');
    let holdings = body.holdings;
    if (symbol) {
      holdings = holdings.filter((item) => item.symbol.toLowerCase() === symbol.toLowerCase());
    }

    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify({ holdings }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify({ service: 'custody-mock', status: 'ok' }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json', connection: 'close' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[custody-mock] listening on http://127.0.0.1:${PORT}`);
});
