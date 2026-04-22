# ZKApp Test

Standalone Zeko testnet zkApp workspace for both the minimal deploy smoke test and the first Nava-shaped intent lifecycle primitive.

This folder is standalone inside the Agent Execution Escrow demo:

- [zkapp-test](./)

## What it does

There are now two flows in this folder:

1. `TestValueZkApp`: the minimal two-field deploy and update smoke test
2. `NavaIntentZkApp`: a per-intent lifecycle contract for the Agent Execution Escrow flow

`NavaIntentZkApp` stores:

1. `intentHash`
2. `statementHash`
3. `approvalCommitment`
4. `status`
5. `requiredVerifierApprovals`
6. `observedVerifierApprovals`
7. `approvalDomainCommitment`
8. `lastUpdatedAt`

It exposes one provable sync method so the same intent can move through:

1. `PENDING`
2. `APPROVED`
3. `EXECUTED`
4. `SETTLED`

The current contract version also enforces:

1. monotonic timestamps
2. monotonic verifier approval counts
3. quorum thresholds before `APPROVED`, `EXECUTED`, or `SETTLED`
4. proof-checked lifecycle progression instead of arbitrary state writes
5. in-circuit Zeko-native verifier signature checks for `APPROVED` when a native verifier registry is configured

## Scripts

- `npm run deploy`
- `npm run check:lifecycle`
- `npm run sign:approval`
- `npm run sync:intent`
- `npm run read:intent`
- `npm run set`
- `npm run read`

## Environment

Copy [.env.example](./.env.example) to `.env`.

The deployer key is intentionally not stored in repo files.

For native verifier quorum tests, pass verifier keys and signing fields through runtime env vars:

- `ZEKO_VERIFIER_PRIVATE_KEY`
- `ZEKO_SIGNING_FIELDS`

## Network

Defaults:

- `ZEKO_NETWORK_ID=testnet`
- `https://testnet.zeko.io/graphql`
- `https://archive.testnet.zeko.io/graphql`
- `https://zekoscan.io/testnet`

## Compatibility note

The current Zeko testnet accepted deploy and update transactions from this project with the Mina `testnet` signer domain while targeting Zeko GraphQL endpoints. If Zeko's custom network signer domain becomes the required path later, set `ZEKO_NETWORK_ID` explicitly and re-test the scripts.

## Migration note

The strengthened lifecycle contract uses a new contract version key path. Resyncing an existing request hash after a contract upgrade will deploy a fresh per-intent zkApp for the newer verification key and update the intent record to point at the latest contract address.

## Native Quorum Flow

1. Sync or deploy an intent with `requiredVerifierApprovals > 0`
2. Read the signing payload from the API route `GET /transactions/:requestHash/zeko-verifier-payload`
3. Have registered Zeko-native verifiers sign the returned fields with `npm run sign:approval`
4. Submit those signatures back to the main app with `POST /transactions/:requestHash/zeko-verifier-attestations`
5. The server relays the approved lifecycle snapshot into `NavaIntentZkApp`, which verifies the native quorum inside the zkApp before setting `status = APPROVED`
