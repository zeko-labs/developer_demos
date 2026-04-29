# Private Inference Builder

## Purpose

Use the private lane when the prompt or structured inputs should not be stored in plaintext in the normal coordinator record.

## When To Use It

- The input contains sensitive user data.
- You want a redacted stored inference record.
- You want optional client-encrypted outputs in addition to sealed inputs.

## Primary Interfaces

- SDK:
  - `CoordinatorClient.getPrivateLaneConfig()`
  - `CoordinatorClient.sealPrivateInferenceRequest()`
  - `CoordinatorClient.createPrivateInference()`
  - `CoordinatorClient.createPrivateLiveInference()`
- HTTP:
  - `GET /api/private-lane/config`
  - `POST /api/infer/private`
  - `POST /api/infer/private/live`

## Workflow

1. Fetch the operator public key from the private lane config endpoint.
2. Encrypt the prompt and structured inputs into a private input envelope.
3. Submit the envelope instead of a plaintext prompt.
4. Optionally provide a client encryption public key for output encryption.
5. Track completion through the normal status-token flow.

## Success Criteria

- Plaintext prompt content is not persisted in the normal inference record.
- The runtime can still emit the same receipt and settlement artifacts as the public path.
- Builders can decrypt outputs client-side when output encryption is enabled.

## Boundaries

This improves storage and transport privacy. It does not yet prove fully private model execution. The operator or execution environment still sees plaintext unless execution moves to a stronger trust model such as TEEs, MPC, FHE, or zkML.
