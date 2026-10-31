# Production deployment

## Live endpoints

- Production: https://isuperloan.com
- Additional domain: https://www.isuperloan.com
- Cloudflare Pages: https://ratepro.pages.dev
- Hosting: Cloudflare Pages with Git integration, project `ratepro`.
- Repository: https://github.com/jasonjiang8866/ratepro
- Production branch: `main`.
- First verified production commit: `cb41748a7519742d865f50c86f0ce0dff543c62a`.

## Build configuration

Use the **Pages** Git integration, not Workers Builds:

| Setting          | Value                         |
| ---------------- | ----------------------------- |
| Root directory   | Repository root (leave blank) |
| Build command    | `npm run build`               |
| Output directory | `dist`                        |
| Environment      | `NODE_VERSION=22`             |

Pages publishes the build output automatically; it does not need a separate
`wrangler deploy` command. The repository's `wrangler.jsonc` configures Pages,
not a Worker entry point. A Workers Builds attempt failed before the Pages
project was created; the unused Worker was not deleted during this deployment.

The apex domain was added through **Pages → ratepro → Custom domains**. The
operator reported no conflicting DNS record and an Active domain. Live HTTPS
and HTTP-to-HTTPS redirection were independently verified. Preserve unrelated
DNS and email records when changing domain settings.

Both custom domains are listed on the Pages project. WWW serves the application
directly rather than redirecting to the apex. Its authoritative DNS and public
resolver records, HTTPS certificate, matching homepage and rate feed, and
HTTP-to-HTTPS redirect were verified. The initial local DNS lookup failed during
propagation; the HTTPS check then used an address returned by public DNS with
normal certificate validation enabled. No machine DNS settings were changed.

A future permanent WWW-to-apex redirect is recommended for a single primary
address, but was not configured. Browser-local data is origin-specific: saved
packages and observations on WWW and the apex are separate.

## Verification on 31 October 2026

- All 27 automated tests and the local production build passed.
- Cloudflare's API confirmed Git integration and a production deployment from
  `main` at the commit above.
- Both endpoints served the homepage and linked JavaScript, CSS, and favicon
  successfully over HTTPS.
- The production rate feed returned JSON identical to the checked-in snapshot,
  with `public, max-age=0, must-revalidate` caching.
- CSP, content-type protection, referrer policy, and permissions policy headers
  were present.
- The production HTTP endpoint returned a 301 redirect to HTTPS.
- Headless Chrome verified three package cards, search and lender filtering,
  a zero-interest repayment calculation, invalid-input handling, and comparison
  dialog opening and Escape dismissal.
- A 390-pixel viewport had no horizontal overflow. No uncaught browser
  exceptions were observed during these checks. This is a smoke test, not a
  comprehensive cross-browser or visual accessibility audit.

## Automatic updates: end-to-end verification

The Git-connected Pages project deploys production updates from `main`.
The scheduled collector runs on GitHub Actions at 01:23 UTC (09:23 Singapore
time), and supports manual dispatch. The browser separately checks the published
feed and attempts direct public-source reads, subject to its six-hour refresh
window and source access restrictions. No scheduled collector runs on Cloudflare.

On 31 October 2026, a manual dispatch after the Pages Git integration was
configured verified the full collector-to-production chain:

- Workflow: https://github.com/jasonjiang8866/ratepro/actions/runs/41184795340
  (`workflow_dispatch`, successful, 23 seconds).
- The real job log confirmed `Contents: write`, 27 passing tests, successful
  DBS extraction, TypeScript/Vite build, and a successful push to `main`.
- Snapshot commit:
  [986c73dafc1e342a191e17d0e5a77eb1b16d0b55](https://github.com/jasonjiang8866/ratepro/commit/986c73dafc1e342a191e17d0e5a77eb1b16d0b55).
  Only `public/data/rates.json` changed.
- Cloudflare's GitHub check for that exact SHA progressed from Building to
  Deployed successfully. Deployment ID:
  `fee32ccd-1634-4e63-ab7c-faf764e9475d`;
  preview: https://fee32ccd.ratepro.pages.dev.
- The live production feed at https://isuperloan.com/data/rates.json changed
  from `2026-10-31T05:27:31.147Z` to `2026-10-31T08:29:30.350Z`
  (16:29:30 Singapore time). Its parsed JSON matched the snapshot at the
  collector commit. SHA-256 of `JSON.stringify(JSON.parse(content))`:
  `ab8923886fd0781bef8a92b0c5913edb633cd569c21bb06cf76bfb76db5c1aab`.
- DBS observations advanced only after successful extraction; their rates and
  terms did not change in this run. HDB returned HTTP 403. Its entire offer,
  including `observedAt: 2026-10-30T01:50:00.000Z` and `method: reviewed`,
  remained unchanged. Only its source attempt time advanced.
- Browser smoke checks confirmed three product cards, search filtering, and
  source details that distinguish feed download time from observation time.
  Direct browser reads were unavailable; existing observations remained visible.

This verifies a real manual run, snapshot push, subsequent Cloudflare deployment,
and publication on the production domain. It does not yet verify a scheduled
cron-triggered run. Repository branch protection was not inspected or changed.

For later checks, match the collector-created commit SHA to Cloudflare's
successful deployment and compare the production feed with that commit. If no
commit is created, there is no new revision for Pages to deploy.

If repository rules block the collector's push, publish through a reviewed PR;
do not weaken branch protection. If Cloudflare does not build the new commit,
inspect its Git integration and build settings and retry through the dashboard.
A static deployment does not refresh itself without a later build/deploy.

## Rollback

In **Workers & Pages → ratepro → Deployments**, select a previously successful
production deployment and use **Rollback to this deployment** when available.
Keep the custom domain associated with the project. After rollback, verify the
homepage, assets, and rate feed on the production domain.

Alternatively, revert the problematic change through the repository's review
process and let Pages deploy the resulting production commit. Avoid force-pushing
history. A rollback of hosted assets does not clear browser-local saved packages
or observations; newer cached observations can survive an older hosted snapshot.

## Known maintenance item

The dependency audit reported three test-tooling findings (two critical and one
moderate) involving Vitest, its mocker, and Tinypool. These are development
dependencies, not deployed application runtime dependencies, but still warrant a
separate tested upgrade. No forced major-version upgrade was applied as part of
deployment.
