import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { readFileSync } from 'node:fs';

import {
  CoordinatorClient,
  type CoordinatorAuth,
  CoordinatorHttpError,
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

interface CreditsSpendIntentResponse {
  ownerPublicKey: string;
  balanceMina: number;
  operator: {
    queued: boolean;
    deduped: boolean;
    item: {
      id: string;
      idempotencyKey: string | null;
      status: string;
      txHash: string | null;
      lastOperatorId: string | null;
      requestId: string | null;
      observedCreditsRoot: string | null;
      observedNullifierRoot: string | null;
      payload: {
        creditsRoot: string;
        nullifierRoot: string;
      };
    };
    summary: Record<string, number>;
    settings: Record<string, unknown>;
  };
}

interface CreditsOperatorQueueSnapshotLike {
  queue: {
    items: Array<{
      id: string;
      requestId: string | null;
      status: string;
      lastOperatorId: string | null;
      txHash: string | null;
    }>;
  };
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

function normalizePositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function dedupeBaseUrls(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = normalizeBaseUrl(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function resolveOwnerPublicKey() {
  const envValue = process.env.OPENGRADIENT_OWNER_PUBLIC_KEY?.trim();
  if (envValue) return envValue;
  const deploymentRecordPath = path.join(process.cwd(), 'data', 'deployments', 'agent-request-v2.latest.json');
  const deploymentRecord = JSON.parse(readFileSync(deploymentRecordPath, 'utf8')) as { deployerPublicKey?: string };
  const fallback = deploymentRecord.deployerPublicKey?.trim() || '';
  if (!fallback) {
    throw new Error('Missing OPENGRADIENT_OWNER_PUBLIC_KEY and deployerPublicKey in agent-request-v2.latest.json.');
  }
  return fallback;
}

function buildSpendRequestKeys() {
  const suffix = crypto.randomUUID();
  return {
    requestId: `credits-failover-live-${suffix}`,
    idempotencyKey: `credits-failover-live-idempotency-${suffix}`
  };
}

async function findQueueItemByRequestId(client: CoordinatorClient, requestId: string) {
  const snapshot = (await client.getCreditsOperatorQueue()) as CreditsOperatorQueueSnapshotLike;
  return snapshot.queue.items.find((item) => item.requestId === requestId) || null;
}

async function main() {
  const baseUrl = normalizeBaseUrl(resolveCoordinatorBaseUrl());
  const lane = normalizeLane(process.env.OPENGRADIENT_FAILOVER_LANE);
  if (lane !== 'credits') {
    throw new Error('Live failover settlement smoke currently supports the credits lane only.');
  }
  const timeoutMs = Math.max(10_000, Number(process.env.OPENGRADIENT_FAILOVER_TIMEOUT_MS || 60_000));
  const pollMs = Math.max(500, Number(process.env.OPENGRADIENT_FAILOVER_POLL_MS || 1_500));
  const auth = resolveCoordinatorAuth();
  const ownerPublicKey = resolveOwnerPublicKey();
  const amountMina = normalizePositiveNumber(process.env.OPENGRADIENT_CREDITS_SPEND_MINA, 0.001);
  const client = new CoordinatorClient({
    baseUrl,
    auth,
    timeoutMs: Number(process.env.OPENGRADIENT_COORDINATOR_TIMEOUT_MS || 15_000)
  });

  const [membership, health, routeBefore] = await Promise.all([
    client.getOperatorMembership(),
    client.getOperatorHealth(),
    client.getLaneRoute('credits')
  ]);

  if (routeBefore.via !== 'remote' || !routeBefore.operatorId || !routeBefore.operatorEndpoint) {
    throw new Error('Credits lane is not currently remote-owned, so live failover settlement cannot be exercised.');
  }

  const healthById = new Map(health.operators.map((entry) => [entry.id, entry]));
  const rankedMembers = rankLaneMembers(membership, healthById, 'credits');
  const currentIndex = rankedMembers.findIndex((entry) => entry.operatorId === routeBefore.operatorId);
  if (currentIndex < 0) {
    throw new Error(`Current route owner ${routeBefore.operatorId} is missing from the signed membership policy.`);
  }

  const backup = rankedMembers
    .slice(currentIndex + 1)
    .find((entry) => entry.status === 'active' && entry.freshness === 'fresh' && typeof entry.endpoint === 'string' && entry.endpoint.length > 0);
  if (!backup) {
    throw new Error(
      `Credits lane has no active fresh backup after ${routeBefore.operatorId}. Admit and run a second operator before using the live failover settlement smoke.`
    );
  }

  const current = healthById.get(routeBefore.operatorId);
  if (!current) {
    throw new Error(`Missing health record for current route owner ${routeBefore.operatorId}.`);
  }

  const originalStatus = current.status;
  const statusTargets = dedupeBaseUrls([baseUrl, routeBefore.operatorEndpoint]);
  let { requestId, idempotencyKey } = buildSpendRequestKeys();
  let routeDuring: CoordinatorLaneRoute | null = null;
  let routeAfter: CoordinatorLaneRoute | null = null;
  let spendResult: CreditsSpendIntentResponse | null = null;
  let paused = false;

  try {
    for (const target of statusTargets) {
      await postOperatorStatus(target, auth, routeBefore.operatorId, 'paused');
    }
    paused = true;

    routeDuring = await waitForRoute(
      client,
      'credits',
      timeoutMs,
      pollMs,
      (route) => route.via === 'remote' && route.operatorId === backup.operatorId
    );

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        spendResult = await client.enqueueCreditsSpend<CreditsSpendIntentResponse>({
          ownerPublicKey,
          requestId,
          amountMina,
          spendTo: ownerPublicKey,
          platformPayee: ownerPublicKey,
          enqueue: true,
          processNow: true,
          waitForSettlement: true,
          idempotencyKey
        });
        break;
      } catch (error) {
        const collision =
          (error instanceof CoordinatorHttpError &&
            (error.bodyText.includes('Credits nullifier already used for this requestId') ||
              String((error.bodyJson as any)?.error || '').includes('Credits nullifier already used for this requestId'))) ||
          (error instanceof Error && error.message.includes('Credits nullifier already used for this requestId'));
        if (collision) {
          const existingItem = await findQueueItemByRequestId(client, requestId);
          if (existingItem) {
            const settledItem = await client.waitForCreditsOperatorItem(existingItem.id, {
              timeoutMs,
              pollIntervalMs: pollMs
            });
            spendResult = {
              ownerPublicKey,
              balanceMina: Number.NaN,
              operator: {
                queued: false,
                deduped: true,
                item: {
                  id: settledItem.id,
                  idempotencyKey: settledItem.idempotencyKey,
                  status: settledItem.status,
                  txHash: settledItem.txHash,
                  lastOperatorId: settledItem.lastOperatorId,
                  requestId: settledItem.requestId,
                  observedCreditsRoot: settledItem.observedCreditsRoot,
                  observedNullifierRoot: settledItem.observedNullifierRoot,
                  payload: {
                    creditsRoot: String((settledItem.payload as any)?.creditsRoot || ''),
                    nullifierRoot: String((settledItem.payload as any)?.nullifierRoot || '')
                  }
                },
                summary: {},
                settings: {}
              }
            };
            break;
          }
        }
        if (!collision || attempt >= 2) {
          throw error;
        }
        const nextKeys = buildSpendRequestKeys();
        requestId = nextKeys.requestId;
        idempotencyKey = nextKeys.idempotencyKey;
      }
    }

    if (!spendResult) {
      throw new Error('Live failover spend did not produce a settlement result.');
    }

    if (spendResult.operator.item.status !== 'settled') {
      throw new Error(`Expected settled operator item, received ${spendResult.operator.item.status}.`);
    }
    if (spendResult.operator.item.lastOperatorId !== backup.operatorId) {
      throw new Error(
        `Expected backup operator ${backup.operatorId} to settle the live spend, received ${spendResult.operator.item.lastOperatorId || 'null'}.`
      );
    }
    if (!spendResult.operator.item.txHash?.trim()) {
      throw new Error('Live failover spend settled without a transaction hash.');
    }
  } finally {
    if (paused) {
      for (const target of statusTargets) {
        await postOperatorStatus(target, auth, routeBefore.operatorId, originalStatus);
      }
      routeAfter = await waitForRoute(
        client,
        'credits',
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
        ownerPublicKey,
        amountMina,
        requestId,
        idempotencyKey,
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
        spendResult,
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

main().catch((error) => {
  console.error('[smoke:credits:failover-live] failed', error);
  process.exit(1);
});
