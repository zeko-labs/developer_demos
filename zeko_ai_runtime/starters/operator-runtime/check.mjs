import { CoordinatorClient, loadCoordinatorEnv, resolveCoordinatorAuth, resolveCoordinatorBaseUrl } from 'zeko-ai-builder-kit';

loadCoordinatorEnv();

function pickEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

async function main() {
  const client = new CoordinatorClient({
    baseUrl: resolveCoordinatorBaseUrl(),
    auth: resolveCoordinatorAuth(),
    timeoutMs: Number(pickEnv('ZEKO_AI_COORDINATOR_TIMEOUT_MS', 'OPENGRADIENT_COORDINATOR_TIMEOUT_MS') || 15000)
  });

  const [health, routing, audit] = await Promise.all([
    client.getOperatorHealth(),
    client.getRouting(),
    client.getOperatorIsolationAudit()
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        healthSummary: health.summary,
        routeStrategy: routing.policy.routeStrategy,
        routes: routing.routes,
        auditSummary: audit.summary,
        auditIssues: audit.issues
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[starters/operator-runtime] failed', error);
  process.exit(1);
});
