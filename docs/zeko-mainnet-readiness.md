# Zeko Mainnet Readiness

These demos are testnet-first reference implementations. Mainnet usage should be an explicit opt-in profile, not a replacement for the current defaults. That keeps existing hosted demos and testnet services running while giving teams a clear path to production deployment.

## Compatibility Rule

- Keep testnet as the default unless a demo already requires explicit endpoints.
- Do not reuse testnet zkApp addresses, deploy hashes, sponsor keys, verifier keys, faucet flows, or generated state on mainnet.
- Prefer new mainnet env files and deployment records, for example `.env.mainnet` and `data/deployments/mainnet/*.json`.
- Keep faucet tooling testnet-only.
- Run a final code review, security review, and audit before deploying anything from this repo to production.

## Mainnet Profile

Use this shape across demos:

```bash
ZEKO_NETWORK_ID=mainnet
ZEKO_GRAPHQL=<official Zeko mainnet GraphQL endpoint>
ZEKO_ARCHIVE_GRAPHQL=<official Zeko mainnet archive endpoint, if available>
ZEKO_EXPLORER=<official Zeko mainnet explorer URL, if available>
TX_FEE=<mainnet fee in nanomina>
```

Some demos use `ZEKO_ARCHIVE` instead of `ZEKO_ARCHIVE_GRAPHQL`, or `ZEKO_GRAPHQL_URL` instead of `ZEKO_GRAPHQL`. Keep the local variable names for each demo, but use the same profile concept.

## Mainnet Checklist

Before running a demo against mainnet:

1. Create fresh deployer, sponsor, relayer, oracle, verifier, and zkApp keys for mainnet.
2. Fund only the accounts that need mainnet funds, using production custody practices.
3. Deploy a fresh mainnet zkApp and record its public key separately from testnet artifacts.
4. Point the demo at mainnet GraphQL/archive/explorer endpoints.
5. Confirm wallet network selection before asking users to sign.
6. Replace `tMINA` or test-token denominations in UI/docs with the correct mainnet asset names where the flow uses real value.
7. Disable faucet UX and faucet CLI paths.
8. Run smoke tests with small values, then review logs, state roots, transaction hashes, and recovery paths.
9. Complete team review and audit before production use.

## Demo Notes

- `agent_coordination_protocol-financial_intelligence`: set a mainnet `ZEKO_NETWORK_ID`, GraphQL endpoint, zkApp, oracle, sponsor, treasury, and token addresses. Do not reuse testnet marketplace or relayer keys.
- `agent_execution_escrow`: use `ZEKO_SUBMIT_MODE=zkapp` only after deploying the intent zkApp on mainnet and configuring mainnet verifier keys and sync paths.
- `perfect-weather_prediction_market`: deploy fresh market zkApps, oracle policy, tx-prover config, archive sync, and fee-payer keys for mainnet. Review privacy language before real-value markets.
- `private-tokenized-asset-protocol`: use mainnet Zeko settings only with production issuer, auditor, custody, proof, and bridge controls.
- `private_order_book`: disable faucet paths, configure real asset/token addresses, deploy fresh settlement zkApps, and review custody/withdrawal/payout policies.
- `proof_of_prayer`: deploy a new prayer batch zkApp, configure mainnet submitter/deployer keys, and remove testnet funding assumptions.
- `proof_over_hype_ai_image_provenance`: deploy a new provenance zkApp and separate mainnet keychain/env values from local/testnet package artifacts.
- `zeko_ai_runtime`: configure mainnet sponsor lanes, operator memberships, zkApp v2 deployment records, and builder auth separately from testnet operator bundles.

Agent Mission-Bound Auth is now maintained as a standalone protocol repository:
[zeko-labs/agent-mission-bound-auth](https://github.com/zeko-labs/agent-mission-bound-auth).
Use that repository's README and production docs for its Zeko anchoring,
settlement, and mainnet profile guidance.
