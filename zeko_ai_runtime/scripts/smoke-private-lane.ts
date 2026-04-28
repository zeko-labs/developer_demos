import 'dotenv/config';

import {
  CoordinatorClient,
  decryptJsonEnvelope,
  loadCoordinatorEnv,
  resolveCoordinatorAuth,
  resolveCoordinatorBaseUrl,
  getEnvelopeContext,
  generateX25519Keypair
} from '../src/sdk/index.js';

loadCoordinatorEnv();

async function main() {
  const baseUrl = resolveCoordinatorBaseUrl();
  const client = new CoordinatorClient({
    baseUrl,
    auth: resolveCoordinatorAuth(),
    timeoutMs: Number(process.env.ZEKO_AI_COORDINATOR_TIMEOUT_MS || process.env.OPENGRADIENT_COORDINATOR_TIMEOUT_MS || 15_000)
  });

  const outputKeypair = generateX25519Keypair();
  const response = await client.createPrivateInference<any>({
    modelId: process.env.ZEKO_AI_MODEL_ID || process.env.OPENGRADIENT_MODEL_ID || 'verifiable-echo',
    prompt: process.env.ZEKO_AI_PROMPT || process.env.OPENGRADIENT_PROMPT || 'private inference smoke',
    inputs: {
      source: 'scripts/smoke-private-lane',
      createdAt: new Date().toISOString()
    },
    clientEncryptionPublicKeyPem: outputKeypair.publicKeyPem,
    publishToDa: true
  });

  if (!response.privateInput?.enabled) {
    throw new Error('Private input metadata was not persisted.');
  }
  if (typeof response.prompt !== 'string' || !response.prompt.includes('redacted')) {
    throw new Error(`Expected redacted prompt placeholder, received ${JSON.stringify(response.prompt)}`);
  }
  if (!response.encryptedOutput) {
    throw new Error('Expected encrypted output envelope on private inference response.');
  }

  const decryptedOutput = decryptJsonEnvelope(
    outputKeypair.privateKeyPem,
    response.encryptedOutput,
    getEnvelopeContext('client-output')
  ) as Record<string, unknown>;

  if (typeof decryptedOutput?.text !== 'string' || !String(decryptedOutput.text).includes('Mock response')) {
    throw new Error(`Unexpected decrypted output: ${JSON.stringify(decryptedOutput)}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        inferenceId: response.id,
        privateInput: response.privateInput,
        privacy: response.privacy,
        encryptedOutputFingerprint: response.encryptedOutput.recipientPublicKeyFingerprint,
        decryptedOutput
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[smoke:private] failed', error);
  process.exit(1);
});
