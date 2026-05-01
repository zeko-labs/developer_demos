# Agent Mission-Bound Auth

Protocol sidecar for delegated and autonomous agents.

It binds enterprise identity to a specific mission, signs the approval, enforces checkpoints before side effects, links x402 payment context, and emits portable receipts that can be independently verified and optionally anchored on Zeko.

The included private-compute UI is only a local tutorial harness. The protocol is the product.

## What It Provides

- Real OIDC login through Auth0, Okta, or any configured OIDC provider.
- Agent passports that say who the agent is, who it represents, and who vouches for it.
- Mission-bound approvals with signed snapshots of task, tools, scopes, rails, budget, and expiry.
- Checkpoint enforcement before payment, compute, settlement, or external side effects.
- Portable `zk-mission-bundle-v1` exports with offline JWKS verification.
- x402 rail metadata for Zeko, Ethereum, Base, Arc preview, and Tempo preview.
- Zeko approval/receipt anchoring scripts for environments that want an on-chain audit root.

## Repository Layout

```text
packages/protocol      core protocol objects, OIDC, missions, x402 rails, digests
packages/sdk           client and offline verification helpers
apps/harness           local tutorial sidecar and private-compute example
apps/external-starter  minimal external app that verifies mission checkpoints
schemas                portable object schemas
scripts                smoke, conformance, OAuth, and optional Zeko scripts
zkapp                  optional Zeko zkApp source
```

## Run Locally

```bash
npm install
npm start
```

Open:

```text
http://127.0.0.1:8787
```

## Configure Identity Providers

Local env lives in `.env.local` and must not be committed.

Auth0:

```bash
AUTH0_ISSUER=https://your-tenant.us.auth0.com/
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
```

Auth0 SPA callback settings:

```text
Allowed Callback URLs: http://127.0.0.1:8787
Allowed Logout URLs: http://127.0.0.1:8787
Allowed Web Origins: http://127.0.0.1:8787
```

Okta:

```bash
OKTA_ISSUER=https://your-okta-domain.okta.com
OKTA_CLIENT_ID=...
OKTA_CLIENT_SECRET=...
OKTA_SCOPE=openid profile email
```

Use the Okta org issuer for general SSO. Use `/oauth2/default` only after configuring an Okta authorization-server access policy for this client.

Additional customer IdPs can be configured without code changes:

```bash
OIDC_PROVIDERS_JSON='[{"provider":"customer-a","issuer":"https://idp.example.com","clientId":"...","clientSecret":"...","scope":"openid profile email"}]'
```

## Core Endpoints

```text
GET  /.well-known/agent-authorization.json
GET  /.well-known/mission-authority-jwks.json
GET  /api/oauth/providers
GET  /api/oauth/login?provider=auth0|okta|customer-a
GET  /api/oauth/callback
POST /api/agents/passport
POST /api/missions/propose
POST /api/missions/approve
POST /api/mission/verify-checkpoint
POST /api/mission/export-bundle
```

## SDK Usage

```js
import { ZkMissionAuthClient, verifyMissionBundle } from "agent-mission-bound-auth/sdk";

const auth = new ZkMissionAuthClient({ baseUrl: "http://127.0.0.1:8787" });
const discovery = await auth.discover();
const jwks = await auth.jwks();

const { agentPassport } = await auth.createAgentPassport({ agentId: "agent-1" });
const { mission } = await auth.proposeMission({
  agentId: agentPassport.agentId,
  task: "Send the approved report",
  operation: "email-send",
  datasetId: "customer-report",
  allowedTools: ["email.send"],
  allowedScopes: ["dataset:customer-report"],
  allowedRails: ["base"]
});
const { approval } = await auth.approveMission({ missionId: mission.missionId });

await auth.verifyCheckpoint({
  checkpoint: "before_external_side_effect",
  approval,
  context: {
    agentId: mission.agentId,
    datasetId: mission.datasetId,
    operation: mission.operation,
    action: "email.send"
  }
});

const { bundle } = await auth.exportBundle({ agentPassport, mission, approval });
verifyMissionBundle(bundle, jwks);
```

## Checks

```bash
npm test
npm run smoke:protocol
npm run test:conformance
npm run test:conformance:remote
npm run test:oauth-sandbox
npm run oauth:sandbox-doctor
```

## Deploy As A Sidecar

Set a public URL and provider secrets in the host environment:

```bash
PUBLIC_BASE_URL=https://auth-sidecar.example.com
ZK_OAUTH_ISSUER_SECRET=...
MISSION_AUTHORITY_PRIVATE_JWK='{"kty":"EC","crv":"P-256",...}'
```

Container build:

```bash
docker build -t agent-mission-bound-auth .
docker run -p 8787:8787 --env-file .env.production agent-mission-bound-auth
```

For each customer IdP, add this callback URL:

```text
https://auth-sidecar.example.com/api/oauth/callback
```

No production Zeko operator is required for basic use. Zeko anchoring is optional and can be run later with the scripts in `scripts/`.

## Live Zeko Testnet App

- zkApp: `B62qpBXMbrKVJwcS9wQN7SpFb6jkrXn2xrntCoM6D461qL2sYZarPHi`
- beneficiary: `B62qjxFhBZ2W1jzMyAppBkD22gGN66gTRYpX9AyaC4Kwga1kbC8zLBN`
- approval root: `18254630832314440409014986041827431424117053312046611743246600167702035963192`
- receipt root: `2503101496281787741527009452532014343190670744041313963524602789905044535138`

## Docs

- [Protocol spec](./docs/spec.md)
- [Integration guide](./docs/integration-guide.md)
- [OAuth provider setup](./docs/oauth-sandbox.md)
- [Security notes](./docs/security.md)
