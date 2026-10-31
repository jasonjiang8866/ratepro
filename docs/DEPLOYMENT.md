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

## Automatic updates: configuration versus verification

The Git-connected Pages project is configured to deploy production updates from
`main`. The rate collector workflow runs daily at 09:23 Singapore time and can
also be started manually. It tests and builds before committing a refreshed
snapshot. No collector runs on Cloudflare or on a visitor's behalf.

A successful manual workflow run was visible during deployment:
https://github.com/jasonjiang8866/ratepro/actions/runs/41172651672

**Still unverified:** a new collector-created snapshot commit triggering a
subsequent Pages production deployment. The initial Git deployment and a prior
successful workflow run do not by themselves prove this entire chain. Repository
workflow permissions and branch protection were not independently inspected or
changed during deployment.

To finish this verification:

1. Run **Actions → Refresh public rate snapshot → Run workflow**, or observe the
   next scheduled run.
2. Confirm its tests, collection, build, and snapshot commit succeed. If no
   commit is created, there is no new revision for Pages to deploy.
3. Match the new commit SHA to a successful Pages **Production** deployment.
4. Verify `https://isuperloan.com/data/rates.json` contains that commit's snapshot.

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
