# Runbook

## Local run

1. `cp .env.example .env`
2. Set `PROOF_MODE=crypto`
3. `pnpm install`
4. `pnpm dev`

## Golden flow smoke test

1. Create eligibility proof:

```bash
curl -s http://localhost:7001/api/v1/proof/eligibility \
  -H 'content-type: application/json' \
  -d '{"subjectCommitment":"subj_demo_001","policyId":1}'
```

2. Verify returned proof:

```bash
curl -s http://localhost:7001/api/v1/proof/verify \
  -H 'content-type: application/json' \
  -d '<proof-json>'
```

3. Record settlement:

```bash
curl -s http://localhost:7001/api/v1/settlement/record \
  -H 'content-type: application/json' \
  -d '{"operation":"eligibility","subjectCommitment":"subj_demo_001","proof":<proof-json>}'
```

4. Review recent settlements:

```bash
curl -s http://localhost:7001/api/v1/settlement/recent
```

## Health checks

- API: `GET http://localhost:7001/api/v1/health`
- Indexer: `GET http://localhost:7002/health`

## Notes

- With `PROOF_MODE=crypto`, proof artifacts are cryptographically signed and verifiable.
- With `PROOF_MODE=zk`, current scaffold supports ed25519 statement proofs and optional `zk-o1js-proof` payload verification via `ZK_O1JS_VERIFY_CMD`.
- Reference verifier adapter command:
  - `pnpm --filter @tap/o1js-verifier build`
  - `export ZK_O1JS_VERIFY_CMD="node /Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/packages/o1js-verifier/dist/cli.js"`
  - optional strict mode: `export ZK_O1JS_REFERENCE_MODE=strict-json`
- Actual `o1js` runtime mode:
  - `export ZK_O1JS_VERIFIER_MODE=o1js-runtime`
  - `export ZK_O1JS_MODULE=o1js`
  - `export ZK_O1JS_VERIFICATION_KEY_JSON_BASE64=...`
Real o1js eligibility runtime

```bash
cd /Users/evankereiakes/Documents/Codex/tokenized-asset-protocol
pnpm --filter @tap/circuits build
pnpm --filter @tap/o1js-verifier build

export PROOF_MODE=zk
export ZK_PROVER_BACKEND=o1js
export ZK_O1JS_PROVE_CMD="node /Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/packages/circuits/dist/prove-cli.js"
export ZK_O1JS_VERIFY_CMD="node /Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/packages/o1js-verifier/dist/cli.js"
export ZK_O1JS_VERIFIER_MODE=o1js-runtime
export ZK_O1JS_MODULE=o1js
```

With the API running under that env, use:

```bash
/Users/evankereiakes/Documents/Codex/tokenized-asset-protocol/scripts/run_zk_o1js_runtime_demo.sh
```
