# Integrating ZK Mission Auth

This guide shows how a domain app plugs into the protocol. The local private-compute UI is only a tutorial harness; production apps should integrate at the protocol endpoints below.

## 1. Discover The Control Plane

```js
import { ZkMissionAuthClient, verifyMissionBundle } from "agent-mission-bound-auth/sdk";

const auth = new ZkMissionAuthClient({ baseUrl: "https://auth.example" });
const discovery = await auth.discover();
```

## 2. Ask For A Mission Approval

```js
const { agentPassport } = await auth.createAgentPassport({
  agentId: "agent-research-ops-001",
  organization: "Northstar Bio"
});

const { mission } = await auth.proposeMission({
  agentId: agentPassport.agentId,
  datasetId: "clinical-failures-q1",
  operation: "risk-summary",
  task: "Summarize the private clinical risk.",
  allowedTools: ["private_compute.run", "x402.pay", "x402.settle", "your_app.side_effect"],
  allowedScopes: ["compute:clinical", "dataset:clinical-failures-q1"],
  allowedRails: ["zeko", "base"]
});

const { approval } = await auth.approveMission({
  missionId: mission.missionId,
  approverId: "policy-engine@example.com"
});
```

## 3. Verify Before Side Effects

```js
const check = await auth.verifyCheckpoint({
  checkpoint: "before_external_side_effect",
  approval,
  context: {
    agentId: mission.agentId,
    datasetId: mission.datasetId,
    operation: mission.operation,
    action: "your_app.side_effect"
  }
});

if (!check.ok) throw new Error("not authorized");
```

## 4. Export A Portable Bundle

```js
const { bundle } = await auth.exportBundle({
  agentPassport,
  mission,
  approval,
  receipt: yourDomainReceipt
});
```

Store `bundle.bundleHash` with your domain audit record.

Verify the bundle offline with the mission authority JWKS:

```js
const jwks = await auth.jwks();
verifyMissionBundle(bundle, jwks);
```

## 5. Anchor When Needed

Use:

```bash
npm run smoke:live-approval-anchor
npm run smoke:live-anchor
```

for the reference Zeko anchoring path. Production apps can anchor approval and execution roots directly or ask this control plane to do it.

## 6. Run A Conformance Check

Local primitives:

```bash
npm run test:conformance
```

Against a running implementation:

```bash
CONFORMANCE_BASE_URL=https://auth.example npm run test:conformance:remote
```

The remote conformance check exercises discovery, JWKS, passport issuance, mission proposal, approval, checkpoint verification, bundle export, schema validation, and offline JWS verification.

## 7. Start From The External App Starter

The reference external app is in `apps/external-starter`.

It is deliberately not private compute. It verifies a mission checkpoint before a simulated email side effect, which is the pattern other apps should copy.
