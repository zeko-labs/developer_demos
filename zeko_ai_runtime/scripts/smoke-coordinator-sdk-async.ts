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

  const [creditsRoute, queue, checkpointBatches, depositMonitors] = await Promise.all([
    client.waitForLaneRoute('credits', {
      timeoutMs: 5_000,
      pollIntervalMs: 500
    }),
    client.getCreditsOperatorQueue(),
    client.getCreditsCheckpointBatches(),
    client.getCreditsDepositMonitors()
  ]);

  const terminalItem =
    queue.queue.items.find((item) => item.status === 'settled') ||
    queue.queue.items.find((item) => item.status === 'superseded') ||
    null;

  const waitedItem = terminalItem
    ? await client.waitForCreditsOperatorItem(terminalItem.id, {
        timeoutMs: 1_000,
        pollIntervalMs: 250,
        rejectOnSuperseded: false
      })
    : null;

  const ownerPublicKey = process.env.OPENGRADIENT_OWNER_PUBLIC_KEY?.trim();
  const balance = ownerPublicKey ? await client.getCreditsBalance(ownerPublicKey) : null;

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        creditsRoute: {
          via: creditsRoute.via,
          operatorId: creditsRoute.operatorId,
          operatorStatus: creditsRoute.operatorStatus,
          freshness: creditsRoute.freshness.status
        },
        queueSummary: queue.summary,
        checkpointBatchSummary: checkpointBatches.summary,
        depositMonitorSummary: depositMonitors.summary,
        waitedItem: waitedItem
          ? {
              id: waitedItem.id,
              status: waitedItem.status,
              txHash: waitedItem.txHash,
              lastOperatorId: waitedItem.lastOperatorId
            }
          : null,
        balance
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[smoke:sdk:async] failed', error);
  process.exit(1);
});
