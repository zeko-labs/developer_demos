# Append-Only Registry And Nullifiers

The production registry is an append-only audit log for mission approval and
receipt roots. It exists so settlement can be checked independently from the
application that performed the work.

## Anchor Fields

```ts
type MissionAnchor = {
  registryVersion: "mba-registry-v1";
  sequence: number;
  missionIdHash: string;
  capabilityHash: string;
  statementHash: string;
  payloadDigest: string;
  receiptIdHash: string;
  nullifier: string;
  previousRoot: string;
  newRoot: string;
  anchoredAt: string;
  networkId: string;
  registryAddress: string | null;
  txHash: string | null;
  proofHash: string;
  anchorId: string;
};
```

The verifier treats `sequence`, `previousRoot`, `newRoot`, and `nullifier` as
registry-derived or verifier-checkable fields. They are not trusted merely
because a client included them in JSON.

## Nullifier Rule

Every settlement-capable receipt carries a nullifier derived from the mission
capability and settlement release condition. A registry or settlement verifier
must reject the second use of the same nullifier as `duplicate_payment`.

