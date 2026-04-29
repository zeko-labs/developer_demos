import 'dotenv/config';

import {
  CoordinatorClient,
  type CoordinatorAuth,
  type CoordinatorLaneRoute,
  type CoordinatorOperatorHealthRecord,
  type CoordinatorOperatorMembershipLanePolicy,
  type CoordinatorOperatorMembershipSnapshot,
  loadCoordinatorEnv,
  resolveCoordinatorAuth,
  resolveCoordinatorBaseUrl,
  type SponsorLane
} from '../src/sdk/index.js';

type OperatorStatus = 'active' | 'paused' | 'draining';

interface RankedLaneMember {
  operatorId: string;
  label: string;
  endpoint: string | null;
  lanePolicy: CoordinatorOperatorMembershipLanePolicy;
  status: OperatorStatus;
  freshness: CoordinatorOperatorHealthRecord['freshness']['status'];
}

const laneOrder = ['request', 'output', 'registry', 'credits'] as SponsorLane[];
loadCoordinatorEnv({
  envFile: process.env.OPENGRADIENT_FAILOVER_ENV_FILE || 'data/opengradient/http-auth/sdk.local.env',
  includeBuilderFallback: false
});

function buildAuthHeaders(auth: CoordinatorAuth) {
  if (auth.kind === 'api-key') {
    return { 'x-api-key': auth.apiKey } as Record<string, string>;
  }
  if (auth.kind === 'bearer') {
    return { authorization: `Bearer ${auth.token}` } as Record<string, string>;
  }
  return {} as Record<string, string>;
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, '');
}

function normalizeLane(value: string | undefined): SponsorLane {
  const lane = value?.trim().toLowerCase();
  if (lane && laneOrder.includes(lane as SponsorLane)) {
    return lane as SponsorLane;
  }
  return 'credits';
}

function roleWeight(role: CoordinatorOperatorMembershipLanePolicy['role']) {
  if (role === 'primary') return 3;
  if (role === 'backup') return 2;
  return 1;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function rankLaneMembers(
  membership: CoordinatorOperatorMembershipSnapshot,
  healthById: Map<string, CoordinatorOperatorHealthRecord>,
  lane: SponsorLane
) {
  return membership.operators
    .map((entry): RankedLaneMember | null => {
      if (!entry.verified) return null;
      const lanePolicy = entry.record.sponsorLanes.find((candidate) => candidate.lane === lane && candidate.enabled) || null;
      if (!lanePolicy) return null;
      const health = healthById.get(entry.operatorId);
      return {
        operatorId: entry.operatorId,
        label: entry.label,
        endpoint: health?.endpoint || entry.endpoint,
        lanePolicy,
        status: health?.status || 'paused',
        freshness: health?.freshness.status || 'unknown'
      };
    })
    .filter((entry): entry is RankedLaneMember => Boolean(entry))
    .sort((a, b) => {
      if (a.lanePolicy.priority !== b.lanePolicy.priority) {
        return b.lanePolicy.priority - a.lanePolicy.priority;
      }
      const aRole = roleWeight(a.lanePolicy.role);
      const bRole = roleWeight(b.lanePolicy.role);
      if (aRole !== bRole) return bRole - aRole;
      return a.operatorId.localeCompare(b.operatorId);
    });
}

async function postOperatorStatus(baseUrl: string, auth: CoordinatorAuth, operatorId: string, status: OperatorStatus) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/operators/${encodeURIComponent(operatorId)}/status`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...buildAuthHeaders(auth)
    },
    body: JSON.stringify({ status })
  });
  const raw = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`status update failed for ${operatorId} via ${baseUrl} (${response.status}): ${raw || 'unknown error'}`);
  }
}

async function waitForRoute(
  client: CoordinatorClient,
  lane: SponsorLane,
  timeoutMs: number,
  pollMs: number,
  predicate: (route: CoordinatorLaneRoute) => boolean
) {
  const startedAt = Date.now();
  let lastRoute = await client.getLaneRoute(lane);
  if (predicate(lastRoute)) return lastRoute;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(pollMs);
    lastRoute = await client.getLaneRoute(lane);
    if (predicate(lastRoute)) {
      return lastRoute;
    }
  }
  throw new Error(
    `Timed out waiting for ${lane} route change. Last route: ${JSON.stringify(
      {
        via: lastRoute.via,
        operatorId: lastRoute.operatorId,
        operatorStatus: lastRoute.operatorStatus,
        selection: lastRoute.selection
      },
      null,
      2
    )}`
  );
}

async function main() {
  const baseUrl = normalizeBaseUrl(resolveCoordinatorBaseUrl());
  const lane = normalizeLane(process.env.OPENGRADIENT_FAILOVER_LANE);
  const timeoutMs = Math.max(10_000, Number(process.env.OPENGRADIENT_FAILOVER_TIMEOUT_MS || 60_000));
  const pollMs = Math.max(500, Number(process.env.OPENGRADIENT_FAILOVER_POLL_MS || 1_500));
  const auth = resolveCoordinatorAuth();
  const client = new CoordinatorClient({
    baseUrl,
    auth,
    timeoutMs: Number(process.env.OPENGRADIENT_COORDINATOR_TIMEOUT_MS || 15_000)
  });

  const [membership, health, routeBefore] = await Promise.all([
    client.getOperatorMembership(),
    client.getOperatorHealth(),
    client.getLaneRoute(lane)
  ]);

  if (routeBefore.via !== 'remote' || !routeBefore.operatorId || !routeBefore.operatorEndpoint) {
    throw new Error(
      `Lane ${lane} is not currently remote-owned, so failover cannot be exercised safely through the operator control plane.`
    );
  }

  const healthById = new Map(health.operators.map((entry) => [entry.id, entry]));
  const rankedMembers = rankLaneMembers(membership, healthById, lane);
  const currentIndex = rankedMembers.findIndex((entry) => entry.operatorId === routeBefore.operatorId);
  if (currentIndex < 0) {
    throw new Error(`Current route owner ${routeBefore.operatorId} is missing from the signed membership policy.`);
  }

  const backup = rankedMembers
    .slice(currentIndex + 1)
    .find((entry) => entry.status === 'active' && entry.freshness === 'fresh' && typeof entry.endpoint === 'string' && entry.endpoint.length > 0);
  if (!backup) {
    throw new Error(
      `Lane ${lane} has no active fresh backup after ${routeBefore.operatorId}. Admit and run a second operator before using failover smoke.`
    );
  }

  const current = healthById.get(routeBefore.operatorId);
  if (!current) {
    throw new Error(`Missing health record for current route owner ${routeBefore.operatorId}.`);
  }

  const originalStatus = current.status;
  const primaryEndpoint = normalizeBaseUrl(routeBefore.operatorEndpoint);
  const statusTargets = dedupeOperatorIds([baseUrl, primaryEndpoint]);
  let routeDuring: CoordinatorLaneRoute | null = null;
  let routeAfter: CoordinatorLaneRoute | null = null;
  let paused = false;

  try {
    for (const target of statusTargets) {
      await postOperatorStatus(target, auth, routeBefore.operatorId, 'paused');
    }
    paused = true;

    routeDuring = await waitForRoute(
      client,
      lane,
      timeoutMs,
      pollMs,
      (route) => route.via === 'remote' && route.operatorId === backup.operatorId
    );
  } finally {
    if (paused) {
      for (const target of statusTargets) {
        await postOperatorStatus(target, auth, routeBefore.operatorId, originalStatus);
      }
      routeAfter = await waitForRoute(
        client,
        lane,
        timeoutMs,
        pollMs,
        (route) => route.operatorId === routeBefore.operatorId && route.via === routeBefore.via
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        lane,
        coordinator: baseUrl,
        originalOwner: {
          operatorId: routeBefore.operatorId,
          endpoint: routeBefore.operatorEndpoint,
          status: originalStatus
        },
        backupOwner: {
          operatorId: backup.operatorId,
          endpoint: backup.endpoint,
          role: backup.lanePolicy.role,
          priority: backup.lanePolicy.priority
        },
        routeBefore,
        routeDuring,
        routeAfter,
        admittedLaneOrder: rankedMembers.map((entry) => ({
          operatorId: entry.operatorId,
          role: entry.lanePolicy.role,
          priority: entry.lanePolicy.priority,
          status: entry.status,
          freshness: entry.freshness,
          endpoint: entry.endpoint
        }))
      },
      null,
      2
    )
  );
}

function dedupeOperatorIds(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = normalizeBaseUrl(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

main().catch((error) => {
  console.error('[smoke:operator:failover] failed', error);
  process.exit(1);
});
