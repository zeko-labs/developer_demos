# Operator Runtime Starter

This starter is for operators standing up a lane-owning runtime, not for builders sending requests.

## Check Command

```bash
node starters/operator-runtime/check.mjs
```

## Recommended Runtime Shape

Use a separate host or container with lane-specific keys and membership-first routing:

```bash
export ZEKO_AI_ROUTE_STRATEGY=membership-first
export ZEKO_AI_DISABLED_SPONSOR_LANES=request,output
# publish your operator endpoint in the generated runtime env for this host
```

For the local primary coordinator after remote activation, generate and use the hardened overlay:

```bash
npm run operators:issue:local-isolation
./<runtime-data-dir>/operators/<local-operator-id>.local-isolation.launch.sh
```

Then run the main runtime from the repo root:

```bash
npm run start
```

## What To Verify

- the lane you intend to own routes to this operator in `/api/operators/routing`
- `/api/operators/isolation/audit` does not report error-level issues
- shared sponsor fallback is gone for production-owned lanes
- duplicate lane keys are intentional hot-standby only, not accidental shared custody
