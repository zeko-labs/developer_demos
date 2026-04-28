import 'dotenv/config';

import { CoordinatorClient, loadCoordinatorEnv, resolveCoordinatorAuth, resolveCoordinatorBaseUrl } from '../src/sdk/index.js';

loadCoordinatorEnv();

async function main() {
  const baseUrl = resolveCoordinatorBaseUrl();
  const client = new CoordinatorClient({
    baseUrl,
    auth: resolveCoordinatorAuth(),
    timeoutMs: Number(process.env.OPENGRADIENT_COORDINATOR_TIMEOUT_MS || 15_000)
  });

  const audit = await client.getOperatorIsolationAudit();
  console.log(JSON.stringify(audit, null, 2));

  if (audit.summary.errorCount > 0) {
    throw new Error(`Operator isolation audit found ${audit.summary.errorCount} error issue(s).`);
  }
}

main().catch((error) => {
  console.error('[operators:audit] failed', error);
  process.exit(1);
});
