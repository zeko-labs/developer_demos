# zkVerify UI (Nuxt SPA)

Strict client-side Nuxt app for browsing zkVerify proof runs.

## Data contract

At Nuxt startup/build, the local module `modules/proof-output-sync.ts` copies data into `public/proof-data/`:
- `output/<timestamp>/...` -> `public/proof-data/runs/<timestamp>/...`
- `output/deployed-address.json` -> `public/proof-data/deployed-address.json` (if present)
- generated `public/proof-data/manifest.json`

Only timestamped run directories are copied. `output/latest/` is intentionally ignored.

## Run

```bash
moon run ui:dev
```

## Build static assets

```bash
moon run ui:build
```

## Cloudflare worker static deploy

`wrangler.jsonc` is configured for SPA fallback (`assets.not_found_handling = "single-page-application"`).

```bash
moon run ui:deploy
```
