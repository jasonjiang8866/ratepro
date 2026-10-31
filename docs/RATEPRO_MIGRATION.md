# RatePro repository migration — 31 October 2026

## Scope

- Imported the current React snapshot at source commit
  `cc1ae9e2547eb54b9091083d8471b99a8e5d4a2b` into `jasonjiang8866/ratepro`.
- Retained the destination repository's existing MIT LICENSE and third-party notices.
- No source Git history, legacy Angular code or AWS API configuration was imported.
- Renamed application branding, package metadata, JSON export filename, browser
  storage keys and Wrangler Pages project to RatePro / `ratepro`.
- Changed frontend CI and collector checkout/guard/push targets to `main`.
- Preserved the imported static snapshot, source parsers and failure retention behavior.

## Validation

- 27 Vitest tests passed locally.
- TypeScript strict check and Vite production build passed locally.
- The deployment output includes `data/rates.json` and `_headers`.
- The source application's historical validation is in `VALIDATION.md`; its screenshot
  predates the rename and is not a new deployment verification.

## Deployment handoff

Cloudflare configuration is external to this repository. Connect Pages to
`jasonjiang8866/ratepro`, production branch `main`, build command `npm run build`,
output directory `dist`, repository root, and environment variable `NODE_VERSION=22`.
No Cloudflare deployment or custom domain transfer was performed by this migration.

The collector retains the daily `23 1 * * *` schedule (09:23 Singapore time) and
`workflow_dispatch`. It requires permission for `GITHUB_TOKEN` to push to `main`.
Verify an actual collector run and the corresponding Cloudflare deployment in
this repository; source-repository results do not prove the new integration.

The previous repository is retained. Its settings and scheduled workflows were
not changed. Once the new deployment is accepted, the old collector can be retired
to avoid duplicate scheduled collection.
