import {
  ensureStore,
  generateClientKeypair,
  createInference,
  decryptClientEnvelope
} from '../dist/src/server.js';

await ensureStore();

const keys = generateClientKeypair();
const inference = await createInference({
  modelId: 'verifiable-echo',
  prompt: 'map the trust model',
  inputs: { mode: 'critique' },
  settlementMode: 'SETTLE_INDIVIDUAL',
  clientEncryptionPublicKeyPem: keys.publicKeyPem,
  publishToDa: true
});

const decrypted = decryptClientEnvelope(keys.privateKeyPem, inference.encryptedOutput);

console.log(
  JSON.stringify(
    {
      inferenceId: inference.id,
      redactedOutput: inference.output,
      encrypted: Boolean(inference.encryptedOutput),
      quorum: inference.attestations?.quorum,
      signatures: inference.attestations?.signatures.length,
      daPrepared: inference.daPublication?.prepared,
      daPayloadMode: inference.daPublication?.relayPayload?.mode,
      decrypted
    },
    null,
    2
  )
);
