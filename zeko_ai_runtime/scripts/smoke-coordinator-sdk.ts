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

  const [health, membership, policy, routing, operatorHealth, registry, credits] = await Promise.all([
    client.getHealth(),
    client.getOperatorMembership(),
    client.getRoutingPolicy(),
    client.getRouting(),
    client.getOperatorHealth(),
    client.getLaneRoute('registry'),
    client.getLaneRoute('credits')
  ]);

  if (registry.via === 'unavailable') {
    throw new Error(`Registry lane unavailable: ${registry.selection.reason}`);
  }
  if (credits.via === 'unavailable') {
    throw new Error(`Credits lane unavailable: ${credits.selection.reason}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        auth:
          client.auth.kind === 'api-key'
            ? 'api-key'
            : client.auth.kind === 'bearer'
              ? 'bearer'
              : 'none',
        health,
        membershipSummary: membership.summary,
        policy,
        routingGeneratedAt: routing.generatedAt,
        routingPolicy: routing.policy,
        localOperatorId: routing.localOperatorId,
        operatorHealthSummary: operatorHealth.summary,
        registryRoute: registry,
        creditsRoute: credits
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[smoke:sdk] failed', error);
  process.exit(1);
});
