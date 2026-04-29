import 'dotenv/config';

import {
  CoordinatorClient,
  CoordinatorHttpError,
  loadCoordinatorEnv,
  resolveCoordinatorAuth,
  resolveCoordinatorBaseUrl
} from '../src/sdk/index.js';

interface ModelRecord {
  id: string;
}

interface ModelsResponse {
  models: ModelRecord[];
}

interface InferenceRecord {
  id: string;
  modelId: string;
}

interface InferencesResponse {
  inferences: InferenceRecord[];
}

interface CreateInferenceResponse extends InferenceRecord {
  id: string;
}

interface CreateLiveInferenceResponse {
  inferenceId: string;
  submitted: boolean;
  contractVersion: 'v1' | 'v2';
  liveSettlement?: {
    requestTxHash?: string | null;
    outputTxHash?: string | null;
  };
  inference: InferenceRecord;
}

function boolFromEnv(value: string | undefined, fallback = false) {
  if (!value?.trim()) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function defaultBuilderEnvFile() {
  return 'data/opengradient/http-auth/builders/builder-conformance-local.local.env';
}

async function expectHttpStatus(label: string, action: () => Promise<unknown>, status: number) {
  try {
    await action();
  } catch (error) {
    if (error instanceof CoordinatorHttpError && error.status === status) {
      return status;
    }
    throw error;
  }
  throw new Error(`${label} unexpectedly succeeded; expected HTTP ${status}.`);
}

async function main() {
  loadCoordinatorEnv({
    envFile:
      process.env.ZEKO_AI_BUILDER_CONFORMANCE_ENV_FILE?.trim() ||
      process.env.OPENGRADIENT_BUILDER_CONFORMANCE_ENV_FILE?.trim() ||
      defaultBuilderEnvFile()
  });

  const liveSettlement = boolFromEnv(
    process.env.ZEKO_AI_BUILDER_CONFORMANCE_LIVE_SETTLEMENT || process.env.OPENGRADIENT_BUILDER_CONFORMANCE_LIVE_SETTLEMENT,
    false
  );
  const waitForSettlement = boolFromEnv(
    process.env.ZEKO_AI_BUILDER_CONFORMANCE_WAIT_FOR_SETTLEMENT ||
      process.env.OPENGRADIENT_BUILDER_CONFORMANCE_WAIT_FOR_SETTLEMENT,
    false
  );
  const baseUrl = resolveCoordinatorBaseUrl();
  const client = new CoordinatorClient({
    baseUrl,
    auth: resolveCoordinatorAuth(),
    timeoutMs: Number(
      process.env.ZEKO_AI_COORDINATOR_TIMEOUT_MS || process.env.OPENGRADIENT_COORDINATOR_TIMEOUT_MS || (liveSettlement ? 180_000 : 20_000)
    )
  });

  const authMe = await client.getAuthMe();
  if (!authMe.authenticated || authMe.principal?.role !== 'builder') {
    throw new Error(`Expected builder auth principal, received ${JSON.stringify(authMe.principal)}.`);
  }

  const [routing, models, creditsQueue] = await Promise.all([
    client.getRouting(),
    client.requestJson<ModelsResponse>('/api/models', { method: 'GET' }),
    client.getCreditsOperatorQueue()
  ]);

  const modelId =
    process.env.ZEKO_AI_MODEL_ID?.trim() || process.env.OPENGRADIENT_MODEL_ID?.trim() || models.models[0]?.id || 'verifiable-echo';
  const suffix = `${authMe.principal.id}-${Date.now()}`;
  const inferenceBody = {
    modelId,
    prompt: process.env.ZEKO_AI_PROMPT?.trim() || process.env.OPENGRADIENT_PROMPT?.trim() || `builder conformance receipt ${suffix}`,
    inputs: {
      source: 'smoke-builder-conformance',
      builderId: authMe.principal.id,
      createdAt: new Date().toISOString()
    },
    settlementMode: 'SETTLE_INDIVIDUAL',
    waitForSettlement
  };

  const created = liveSettlement
    ? await client.createLiveInference<CreateLiveInferenceResponse>(inferenceBody, {
        version: 'v2',
        idempotencyKey: `builder-conformance-live-${suffix}`
      })
    : await client.requestJson<CreateInferenceResponse>('/api/infer', {
        method: 'POST',
        body: inferenceBody,
        idempotencyKey: `builder-conformance-${suffix}`
      });

  const inferenceId = liveSettlement ? (created as CreateLiveInferenceResponse).inferenceId : (created as CreateInferenceResponse).id;
  if (!inferenceId) {
    throw new Error(`Coordinator did not return an inference id: ${JSON.stringify(created)}`);
  }

  const inferences = await client.requestJson<InferencesResponse>('/api/inferences', { method: 'GET' });
  const visible = inferences.inferences.some((entry) => entry.id === inferenceId);
  if (!visible) {
    throw new Error(`Created inference ${inferenceId} was not visible to the builder that created it.`);
  }

  const agentReadDeniedStatus = await expectHttpStatus(
    'GET /api/agents without agents:read scope',
    () => client.requestJson('/api/agents', { method: 'GET' }),
    403
  );
  const operatorWriteDeniedStatus = await expectHttpStatus(
    'POST /api/operators/:id/status as builder',
    () =>
      client.requestJson(`/api/operators/${encodeURIComponent(routing.localOperatorId)}/status`, {
        method: 'POST',
        body: { status: 'paused' }
      }),
    403
  );
  const creditsWriteDeniedStatus = await expectHttpStatus(
    'POST /api/credits/spend-intent without credits:write scope',
    () =>
      client.enqueueCreditsSpend({
        ownerPublicKey:
          process.env.ZEKO_AI_OWNER_PUBLIC_KEY ||
          process.env.OPENGRADIENT_OWNER_PUBLIC_KEY ||
          'B62qbuilderConformancePlaceholder111111111111111111111111111111111',
        requestId: `builder-conformance-denied-${suffix}`,
        amountMina: 0.001,
        enqueue: true
      }),
    403
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        builder: authMe.principal,
        liveSettlement,
        waitForSettlement,
        modelId,
        inferenceId,
        routeSummary: {
          localOperatorId: routing.localOperatorId,
          registryVia: routing.routes.registry.via,
          creditsVia: routing.routes.credits.via
        },
        creditsQueueSummary: creditsQueue.summary,
        denied: {
          agentReadStatus: agentReadDeniedStatus,
          operatorWriteStatus: operatorWriteDeniedStatus,
          creditsWriteStatus: creditsWriteDeniedStatus
        }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[smoke:builder:conformance] failed', error);
  process.exit(1);
});
