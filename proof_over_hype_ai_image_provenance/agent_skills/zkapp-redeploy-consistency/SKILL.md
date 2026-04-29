---
name: zkapp-redeploy-consistency
description: Safe redeploy workflow for zkApp key/permission/layout changes, with env/keychain synchronization checks.
---

# zkApp Redeploy Consistency

Use this skill when contract state layout or permissions change, or when keys are rotated.

## Trigger signals

- `Update_not_permitted_app_state`
- Wrong `ZKAPP_PUBLIC_KEY` in runtime despite recent keygen
- Contract deploy succeeds but app submits fail unexpectedly

## Procedure

1. Generate fresh zkApp keypair.
2. Fund new zkApp public key on target network.
3. Deploy using current contract build.
4. Record deployed `ZKAPP_PUBLIC_KEY`.
5. Synchronize key sources:
   - `.env`
   - shell exports
   - keychain entries
6. Restart runtime and verify derived public key equals deployed key.
7. Query on-chain permissions and app state to confirm compatibility.

## Validation

- Deploy script and runtime report the same zkApp public key.
- On-chain permissions match contract expectations for state edits.
- Submission path succeeds after restart.

## Notes

- Partial cleanup of env/keychain is a common failure source.
- Key provenance logging at startup is strongly recommended.
