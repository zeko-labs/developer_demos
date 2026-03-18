# Release Notes

## v1-pilot-rc1 (2026-03-09)

This release candidate pins a working self-hosted enterprise demo flow for:
- policy-linked settlement checks,
- maker-checker controls,
- issuer SLA + reconcile operations,
- partner adapter certification,
- Plaid balance collection,
- zk proof mode (`PROOF_MODE=zk`) transcript coverage.

### Reference Artifacts (validated)

- `output/demo-transcripts/policy-linkage-demo-2026-03-09T21-10-49Z.md`
  - sha256: `517f3cc3591a90fe1e3a8a66a6bd1d634f57fde9b50a519fd315c523e954a943`
- `output/demo-transcripts/maker-checker-demo-2026-03-09T21-10-49Z.public.md`
  - sha256: `6fa561e20720345370e80d57f116ba10a8f799d1d8b45bdb3ec7d7889beae620`
- `output/demo-transcripts/issuer-sla-reconcile-demo-2026-03-09T21-10-49Z.public.md`
  - sha256: `5b6a7db76d33b6c91ef5abaa18f9e8235e5650e59091da5eaafff774d8497e18`
- `output/demo-transcripts/partner-adapter-certification-demo-2026-03-09T21-10-49Z.public.md`
  - sha256: `e3d6713ad8fcd9ab71a8264b81c20eaee1e3c2284a9ebdfcce9867915fd2a17f`
- `output/demo-transcripts/plaid-balance-demo-2026-03-09T21-10-50Z.public.md`
  - sha256: `38500192150f7448cbe86e907aeac5cb146f51efb5375f40c447199a97ef7730`
- `output/demo-transcripts/zk-mode-demo-2026-03-09T19-21-29Z.md`
  - sha256: `df033773e6d4d8e9ade913d4226494766957aa0e4935ab72e64b665e6b2f92fc`

Release audit bundle:
- `output/release-bundles/release-audit-2026-03-09T21-10-53Z.tar.gz`
  - sha256: `fd6b8c163a026d3c39ce875a47589e7cdcb1299e0e9d6bc059f078938d579627`
- `output/release-bundles/release-audit-2026-03-09T21-10-53Z/MANIFEST.json`
  - sha256: `5c5adcfdc59551739036004c42db70b6c0593326bb71e6a8c67278d7a4ee5891`

Latest certification index state:
- `output/certification/index.json`
- latest id: `cert_2026-03-09T21-10-50-915Z`
- latest status: `pass`
  - latest report sha256: `09c9d1518e3a47f54e37a7f12ec1d6f3dc23d8c3aeb8f2c282c7e6082f8ee546`

### Operator Command (self-hosted)

Run the full demo + bundle pipeline with one command:

```bash
PLAID_CLIENT_ID='...' \
PLAID_SECRET='...' \
PLAID_ACCESS_TOKEN='...' \
./scripts/run_v1_demo_rc1.sh
```

This command:
1. builds and starts API gateway in isolated local mode (`PORT=7011`, `PROOF_MODE=zk`),
2. runs `run_enterprise_demo_pack.sh`,
3. builds release audit bundle,
4. verifies the bundle with `release_bundle_verify.sh`,
5. prints final artifact paths.
