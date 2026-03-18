# poc

TypeScript proving and settlement pipeline. Uses o1js to generate ZK proofs of employment eligibility from TLSNotary attestations and settles them on-chain to the Zeko testnet.

## Key modules

- `circuits/eligibility.ts` -- ZkProgram with in-circuit ECDSA signature verification and eligibility predicates
- `contracts/VerificationRegistry.ts` -- SmartContract that records verified proof hashes on-chain
- `extract-fields.ts` -- extracts disclosed fields from a TLSNotary attestation
- `prove.ts` -- compiles the circuit and generates a ZK proof
- `verify.ts` -- verifies the proof locally
- `deploy.ts` -- deploys (or redeploys) the VerificationRegistry contract
- `settle.ts` -- settles a proof on-chain (auto-redeploys if the verification key is stale)
- `verify-chain.ts` -- verifies on-chain state via GraphQL
- `gen-wallet.ts` -- generates a fee payer wallet and `.env` file

## Tasks

```bash
moon run poc:prove          # generate ZK proof
moon run poc:verify         # verify proof locally
moon run poc:deploy         # deploy contract
moon run poc:settle         # settle proof on-chain
moon run poc:verify-chain   # verify on-chain state
moon run poc:extract        # extract attested fields
moon run poc:gen-wallet     # generate wallet + .env
moon run poc:test           # run tests
moon run poc:validate-ts    # typecheck + lint + format
```
