import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const CERT_PATH = process.env.ZKTLS_BANK_CERT_PATH || path.join(ROOT_DIR, 'external', 'zk-verify-poc', 'mock-server', 'cert.pem');
const KEY_PATH = process.env.ZKTLS_BANK_KEY_PATH || path.join(ROOT_DIR, 'external', 'zk-verify-poc', 'mock-server', 'key.pem');
const PORT = Number(process.env.ZKTLS_BANK_PORT || 4544);

const ELIGIBLE_ACCOUNT = {
  account_id: 'BANK-001',
  account_holder: 'Jane Doe',
  account_status: 'active',
  kyc_passed: true,
  currency: 'USD',
  current_balance_cents: 250000,
  available_balance_cents: 245000
};

const INELIGIBLE_ACCOUNT = {
  account_id: 'BANK-002',
  account_holder: 'Alex Smith',
  account_status: 'restricted',
  kyc_passed: false,
  currency: 'USD',
  current_balance_cents: 5000,
  available_balance_cents: 0
};

const accounts = {
  [ELIGIBLE_ACCOUNT.account_id]: ELIGIBLE_ACCOUNT,
  [INELIGIBLE_ACCOUNT.account_id]: INELIGIBLE_ACCOUNT
};

const server = createServer(
  {
    cert: readFileSync(CERT_PATH),
    key: readFileSync(KEY_PATH),
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.2'
  },
  (req, res) => {
    const url = new URL(req.url || '/', `https://localhost:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/api/v1/accounts/balance') {
      const accountId = String(url.searchParams.get('account_id') || '');
      const account = accounts[accountId];
      if (account) {
        res.writeHead(200, {
          'content-type': 'application/json',
          connection: 'close'
        });
        res.end(JSON.stringify(account));
        return;
      }
    }

    res.writeHead(404, {
      'content-type': 'application/json',
      connection: 'close'
    });
    res.end(JSON.stringify({ error: 'not_found' }));
  }
);

server.listen(PORT, () => {
  console.log(`[zktls-mock-bank] listening on https://localhost:${PORT}`);
  console.log(`[zktls-mock-bank] eligible account: ${ELIGIBLE_ACCOUNT.account_id}`);
  console.log(`[zktls-mock-bank] ineligible account: ${INELIGIBLE_ACCOUNT.account_id}`);
});
