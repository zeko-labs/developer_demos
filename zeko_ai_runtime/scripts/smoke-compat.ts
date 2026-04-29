import 'dotenv/config';

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  CoordinatorClient,
  loadCoordinatorEnv,
  resolveCoordinatorAuth,
  resolveCoordinatorBaseUrl
} from '../src/sdk/index.js';

function boolFromEnv(value: string | undefined, fallback = false) {
  if (!value?.trim()) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function defaultBuilderEnvFile() {
  return 'data/opengradient/http-auth/builders/builder-conformance-local.local.env';
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
  pollIntervalMs = 50
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms while waiting for condition.`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

async function main() {
  loadCoordinatorEnv({
    envFile: process.env.ZEKO_AI_COMPAT_ENV_FILE?.trim() || process.env.OPENGRADIENT_COMPAT_ENV_FILE?.trim() || defaultBuilderEnvFile()
  });

  const live = boolFromEnv(process.env.ZEKO_AI_COMPAT_LIVE || process.env.OPENGRADIENT_COMPAT_LIVE, false);
  const waitForSettlement = boolFromEnv(
    process.env.ZEKO_AI_COMPAT_WAIT_FOR_SETTLEMENT || process.env.OPENGRADIENT_COMPAT_WAIT_FOR_SETTLEMENT,
    false
  );
  const baseUrl = resolveCoordinatorBaseUrl();
  const client = new CoordinatorClient({
    baseUrl,
    auth: resolveCoordinatorAuth(),
    timeoutMs: Number(
      process.env.ZEKO_AI_COORDINATOR_TIMEOUT_MS || process.env.OPENGRADIENT_COORDINATOR_TIMEOUT_MS || (live ? 180_000 : 20_000)
    )
  });

  const authMe = await client.getAuthMe();
  if (!authMe.authenticated || authMe.principal?.role !== 'builder') {
    throw new Error(`Expected builder auth principal, received ${JSON.stringify(authMe.principal)}.`);
  }

  const compatModels = await client.getCompatModels();
  const modelId = process.env.ZEKO_AI_MODEL_ID?.trim() || process.env.OPENGRADIENT_MODEL_ID?.trim() || compatModels.data[0]?.id || 'verifiable-echo';
  const suffix = `${authMe.principal.id}-${Date.now()}`;

  const callbacks: Array<{ headers: http.IncomingHttpHeaders; body: unknown }> = [];
  const callbackServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      callbacks.push({
        headers: req.headers,
        body: raw.length ? JSON.parse(raw) : null
      });
      res.writeHead(204).end();
    });
  });

  await new Promise<void>((resolve) => callbackServer.listen(0, '127.0.0.1', () => resolve()));
  const callbackPort = (callbackServer.address() as AddressInfo).port;
  const callbackUrl = `http://127.0.0.1:${callbackPort}/compat-status`;

  try {
    const created = await client.createCompatInference(
      {
        model: modelId,
        prompt: `compat shim inference ${suffix}`,
        input: {
          source: 'smoke-compat',
          suite: 'compat',
          builderId: authMe.principal.id
        },
        live,
        wait_for_settlement: waitForSettlement,
        callback_url: callbackUrl,
        callback_mode: 'status-change'
      },
      {
        idempotencyKey: `compat-inference-${suffix}`
      }
    );

    await waitForCondition(() => callbacks.length > 0, 5_000);

    const status = await client.getInferenceStatus(created.status_token);
    const compatRead = await client.getCompatInference(created.id);
    const compatStatus = await client.getCompatInferenceStatus(created.id);
    const compatReceipt = await client.getCompatInferenceReceipt(created.id);

    const chat = await client.createCompatChatCompletion(
      {
        model: modelId,
        messages: [
          {
            role: 'user',
            content: `compat shim chat ${suffix}`
          }
        ]
      },
      {
        idempotencyKey: `compat-chat-${suffix}`
      }
    );

    const mcpInitialize = await client.mcpInitialize({
      name: 'smoke-compat',
      version: '0.1.0'
    });
    const mcpTools = await client.mcpListTools();
    const mcpModels = await client.mcpCallTool<{ models: Array<{ id: string }> }>('list_models');
    const mcpStatus = await client.mcpCallTool('get_status', {
      statusToken: created.status_token
    });

    if (!created.id || !created.status_token || !created.settlement?.contractVersion) {
      throw new Error(`Compatibility create response was missing required fields: ${JSON.stringify(created)}`);
    }
    if (!compatRead.id || compatRead.id !== created.id) {
      throw new Error(`Compatibility read mismatch: ${JSON.stringify({ created, compatRead })}`);
    }
    if (!compatReceipt.inference_id || compatReceipt.inference_id !== created.id) {
      throw new Error(`Compatibility receipt mismatch: ${JSON.stringify(compatReceipt)}`);
    }
    if (!chat.choices?.[0]?.message?.content) {
      throw new Error(`Compatibility chat completion was missing assistant content: ${JSON.stringify(chat)}`);
    }
    if (!mcpInitialize.result || !mcpTools.result || !mcpModels.result || !mcpStatus.result) {
      throw new Error(
        `MCP wrapper responses were incomplete: ${JSON.stringify({ mcpInitialize, mcpTools, mcpModels, mcpStatus })}`
      );
    }
    const callbackStatusToken =
      callbacks[0]?.headers['x-zeko-ai-status-token'] || callbacks[0]?.headers['x-opengradient-status-token'] || '';
    if (callbackStatusToken !== created.status_token) {
      throw new Error(`Callback did not include the expected status token header.`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          builder: authMe.principal,
          live,
          waitForSettlement,
          modelId,
          createdInferenceId: created.id,
          chatInferenceId: chat.id,
          compatStatus: compatStatus.status,
          statusSnapshot: status.status,
          callbackCount: callbacks.length,
          mcpTools: (mcpTools.result as any)?.tools?.map((tool: any) => tool.name) || [],
          mcpStatus: (mcpStatus.result as any)?.structuredContent?.status || null
        },
        null,
        2
      )
    );
  } finally {
    await new Promise<void>((resolve, reject) => callbackServer.close((error) => (error ? reject(error) : resolve())));
  }
}

main().catch((error) => {
  console.error('[smoke:compat] failed', error);
  process.exit(1);
});
