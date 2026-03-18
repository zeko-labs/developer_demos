#!/usr/bin/env node
import http from 'node:http';

const PORT = Number(process.env.PERSONA_MOCK_PORT || 4511);

const inquiries = {
  inq_sandbox_demo_001: {
    data: {
      id: 'inq_sandbox_demo_001',
      type: 'inquiry',
      attributes: {
        status: 'approved',
        'reference-id': 'subj_persona_demo_001',
        'country-code': 'US'
      }
    }
  },
  inq_sandbox_pending_001: {
    data: {
      id: 'inq_sandbox_pending_001',
      type: 'inquiry',
      attributes: {
        status: 'pending',
        'reference-id': 'subj_persona_demo_pending',
        'country-code': 'US'
      }
    }
  }
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && url.pathname.startsWith('/api/v1/inquiries/')) {
    const inquiryId = decodeURIComponent(url.pathname.split('/').pop() || '');
    const body = inquiries[inquiryId];
    if (!body) {
      res.writeHead(404, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify(body));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify({ service: 'persona-mock', status: 'ok' }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json', connection: 'close' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[persona-mock] listening on http://127.0.0.1:${PORT}`);
});
