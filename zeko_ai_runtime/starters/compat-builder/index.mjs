import { CompatClient } from 'zeko-ai-builder-kit/compat';
import { loadCoordinatorEnv, resolveCoordinatorAuth, resolveCoordinatorBaseUrl } from 'zeko-ai-builder-kit';

loadCoordinatorEnv();

function pickEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

async function main() {
  const action = (process.argv[2] || 'models').trim().toLowerCase();
  const client = new CompatClient({
    baseUrl: resolveCoordinatorBaseUrl(),
    auth: resolveCoordinatorAuth(),
    timeoutMs: Number(pickEnv('ZEKO_AI_COORDINATOR_TIMEOUT_MS', 'OPENGRADIENT_COORDINATOR_TIMEOUT_MS') || 15000)
  });

  if (action === 'models') {
    console.log(JSON.stringify(await client.listModels(), null, 2));
    return;
  }

  if (action === 'infer') {
    const response = await client.createInference({
      modelId: pickEnv('ZEKO_AI_MODEL_ID', 'OPENGRADIENT_MODEL_ID') || 'verifiable-echo',
      prompt: pickEnv('ZEKO_AI_PROMPT', 'OPENGRADIENT_PROMPT') || 'compat starter request',
      inputs: {
        starter: 'compat-builder',
        createdAt: new Date().toISOString()
      }
    });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (action === 'chat') {
    const response = await client.createChatCompletion({
      model: pickEnv('ZEKO_AI_MODEL_ID', 'OPENGRADIENT_MODEL_ID') || 'verifiable-echo',
      messages: [
        {
          role: 'user',
          content: pickEnv('ZEKO_AI_PROMPT', 'OPENGRADIENT_PROMPT') || 'compat chat request'
        }
      ]
    });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (action === 'status') {
    const inferenceId = pickEnv('ZEKO_AI_INFERENCE_ID', 'OPENGRADIENT_INFERENCE_ID');
    if (!inferenceId) {
      throw new Error('Set ZEKO_AI_INFERENCE_ID before running status.');
    }
    console.log(JSON.stringify(await client.getInferenceStatus(inferenceId), null, 2));
    return;
  }

  throw new Error(`Unknown action: ${action}`);
}

main().catch((error) => {
  console.error('[starters/compat-builder] failed', error);
  process.exit(1);
});
