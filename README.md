# RatePro

An independent Singapore home-loan directory built with **React + TypeScript + Vite + Tailwind CSS + shadcn/ui**. The deployed application is static: no Django, API server, database, accounts, Worker functions, or secret keys. Cloudflare Pages serves `dist/`.

## Run

Node 22.12+ (Node 22 LTS recommended).

```sh
npm ci
npm run dev
npm test
npm run build
```

## What it does

- Source-backed rate schedules, minimum loan and commitment information, with official links and per-observation timestamps.
- Property, purpose, construction stage, lender and rate-type filters; sorting, saved packages and up to three-way comparison.
- A simple fully drawn loan repayment calculator (constant-rate estimate, not affordability advice).
- Automatic refresh on page load, six-hour request throttling, manual refresh and reconnect recovery.
- Browser-local persistence, incremental merging and a bounded history of changed rates **and terms**. Newer observations win; failed sources cannot overwrite good data.
- JSON export/import for sharing observations without accounts. Data is local to the browser/device/origin; it is not a shared online database. Clearing site data deletes the local copy. Imports merge current observations, not the sender's historical ledger.
- Dark mode, responsive layout, keyboard-accessible controls, and a Radix-backed comparison dialog.

## How backend-free collection actually works

A browser cannot read arbitrary bank pages unless those servers allow cross-origin reads (CORS). `no-cors` would return an unreadable opaque response; a public CORS proxy would introduce another service dependency. Neither is used.

There are two supported paths:

1. **On load:** show locally cached observations; if the six-hour window has elapsed, fetch same-origin `/data/rates.json`, then attempt a single bounded GET to each allowlisted official source. Merge by stable package ID and observation time. Render failures without changing the original observation timestamps.
2. **Publication:** `.github/workflows/refresh-rates.yml` runs once daily at 09:23 Singapore time (01:23 UTC) after it is merged into `main`, or manually via Actions. A Node build-time collector extracts known public tables and commits the validated static JSON snapshot. Cloudflare Pages Git integration can build/deploy the updated snapshot. The scheduled collector runs on GitHub Actions; browser refreshes are a separate best-effort path.

Thus loading the page can collect **CORS-permitted** sources directly and pick up the most recently published static feed; it cannot force real-time access to CORS-blocked pages. It does not search or crawl the entire web, bypass access restrictions, or use an LLM to guess financial values.

The scheduled collector requires GitHub Actions to be enabled and repository rules that permit its `GITHUB_TOKEN` to push `public/data/rates.json` to `main`. If branch protection blocks this, maintain the feed through reviewed PRs or run `npm run collect` locally; do not disable protection just to accommodate it. Actions-created commits do not trigger other GitHub Actions workflows, so the collector runs tests and the production build itself before pushing. Verify the first scheduled commit triggers your external Cloudflare Git integration; otherwise build/deploy that commit from Cloudflare's dashboard. A static deployment does not refresh itself without a later build/deploy.

### Current source coverage

| Source             | Supported observations              | Coverage                                                                                          |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| DBS HDB / Green    | CPF-OA and FHR6 stage schedules     | Two public products                                                                               |
| HDB                | Concessionary quarter               | Reviewed snapshot retained when the live page returns 403                                         |
| Maybank            | 2-year / 3-year fixed, 1M / 3M SORA | Four reviewed completed-property snapshots; automatic retrieval currently times out; BUC excluded |
| Standard Chartered | Published 3M SORA schedule          | Formula only; source effective date is displayed separately                                       |
| UOB                | Published completed-property SORA   | New direct-to-bank customers; fixed-rate enquiries remain quote-only                              |
| Citi               | Four completed-variable schedules   | Separate Citigold/Citibanking and loan bands; property/purpose eligibility needs confirmation     |
| OCBC / HSBC        | Official research links             | Quote required; no headline-only rate records                                                     |

See [source investigation and validation](docs/SOURCE_COVERAGE.md) for URLs,
fixture provenance, known limitations and live retrieval results.

SORA stages store `rate: null` plus a structured `benchmark` (name, tenor and
spread). No current benchmark fixing is collected, so the UI displays the formula,
places these observations after numerical initial rates in either rate sort, and
does not calculate their monthly payment. Fixed-period packages retain their
floating thereafter formula. `effectiveFrom` is the bank's stated terms date;
`observedAt` is when the page was successfully read. Neither is the feed download
time. A current observation does not imply a newly launched or available offer.

The original HDB snapshot remains explicitly `method: reviewed`. No synthetic
bank offers or benchmark-as-mortgage-rate shortcuts are used. Existing numeric-only
exports/caches remain valid; new exports include nullable SORA rates and require
this updated application to read them. History records spread and term changes.

Sources can change page structure, stop publishing a package, block automation, or return different content by location. Parsers fail closed when expected fields disappear. Old observations are retained with their original date; they are **not proof that a package remains on sale**. Data older than seven days or past its published effective end is marked stale. Feed download time is never treated as source observation time. Source dates are retrieval dates unless an effective period is explicitly provided. There is no claim of full market coverage.

Cards show observation age and flag records older than seven days or past their
published period (ending at Singapore midnight). This is a directory recheck
policy, not a bank guarantee. Sources separates the published collector attempt
and success from browser-direct attempts and successes. A browser CORS failure
does not change the displayed collector outcome. Snapshot generation, local
download, bank observation and terms-effective dates remain distinct. Reviewed
and imported observations retain their provenance; no successful extraction is
inferred from a reviewed snapshot. Existing caches migrate on their next refresh;
unknown channel-specific timestamps display “Not recorded”.

Source health CI has independent `stable` (DBS/SC), `experimental`
(Maybank) and `expanded` (UOB/Citi) jobs, with separate artifacts and genuine failure results. No
`continue-on-error` is used. `npm run verify:sources -- stable` or `-- experimental`
runs one group; the default checks all sources including HDB. The daily collector
still attempts all sources and retains failed-source observations. HDB remains
a reviewed fallback, and its retrieval result remains in the daily collector log.

The Citi collector needs `pdftotext` (`sudo apt-get install poppler-utils` on Ubuntu/Debian,
`brew install poppler` on macOS). GitHub collection jobs install it; Cloudflare
only builds the static app and does not need it. Citi PDF data uses the published
snapshot in browsers. UOB and Maybank use standard `curl`, available on GitHub Ubuntu. Maybank alone
uses HTTPS with HTTP/1.1 after a diagnosed HTTP/2 stream error, but GitHub
requests still time out and its experimental check remains failed.

### Extend sources

1. Add an exact official URL and source ID to `src/lib/schema.ts` and the CSP allowlist in `public/_headers`.
2. Add a source-specific parser in `src/lib/parsers.ts`, reading semantic table rows rather than unrelated headline percentages. All-in rates and benchmark spreads must remain separate.
3. Add small representative fixtures plus malformed-page and rate-change tests. Check usage terms and extraction feasibility for the source before enabling it.
4. Run `npm run verify:sources` for a read-only live check, then `npm run collect` to update a local snapshot. Review JSON against the original page before publishing. The separate official-source CI job records live observations without pushing or deploying.

The collector reads sequentially with a 12-second default timeout (30 seconds for Maybank) and a 2 MB cap. Transient network/timeouts and HTTP 408/500/502/503/504 permit at most one retry after two seconds. HTTP 401/403/404/429, redirects, oversized responses and parser failures do not retry. Failure categories and attempt counts are recorded. Partial failure retains prior observations; total failure exits nonzero. No third-party proxy, authentication, spoofed browser identity or TLS override is used. See [retrieval investigation](docs/RETRIEVAL.md).

## Deploy directly to Cloudflare Pages

Production is available at **https://isuperloan.com**, with the Git-connected
Pages endpoint **https://ratepro.pages.dev**. See [the deployment record](docs/DEPLOYMENT.md)
for verified checks, automatic-update verification status, and rollback steps.

### Git integration (recommended)

1. In Cloudflare **Workers & Pages → Create → Pages → Connect to Git**, connect `jasonjiang8866/ratepro` and grant Cloudflare access to it.
2. Choose `main` as the production branch.
3. Set build command **`npm run build`**, output directory **`dist`**, project root **repository root**, and build environment **`NODE_VERSION=22`**.
4. Deploy. No environment secrets, database bindings or backend configuration are needed. Set a custom domain in Pages if desired.

Cloudflare Pages supports this SPA with its default fallback. `public/_headers` is copied into the output to set a CSP and revalidation for the rate feed. No router/API fallback should be configured for `/data/rates.json`: it is a real static asset.

### Direct Upload

```sh
npm ci
npm run build
npx wrangler login
npx wrangler pages project create ratepro --production-branch main
npx wrangler pages deploy dist --project-name ratepro
```

For an existing project, `npm run deploy` builds and deploys it. Wrangler uses your local Cloudflare login; do not put API tokens in frontend variables. Direct Upload is a manual deployment path: the scheduled GitHub collection alone does not upload a new build to Cloudflare.

## Data and privacy

`ratepro.cache.v1` in localStorage stores schema-versioned observations, source status and at most 500 prior revisions. Saved package IDs/theme are stored separately. localStorage is intentionally sufficient for this small directory; unavailable/quota-limited/corrupt storage is surfaced to the user. Export before clearing site data or changing domains. The browser contacts only its own origin and the allowlisted source hosts; lenders see ordinary network requests but no calculator inputs. No analytics or remote fonts are used.

JSON imports are schema/size/date validated and never execute HTML. They are **untrusted shared observations**, not cryptographic proof of bank verification. Do not import files from unknown sources and assume their rates are genuine; follow the official link. No contact details, borrower documents or loan applications are collected.

The calculator estimates `P × r / (1 − (1 + r)^−n)` for a constant rate and monthly repayments (and `P/n` at zero interest). Future variable rates, progressive drawdowns, fees, CPF treatment, TDSR/MSR, LTV and eligibility are not modelled. Packages for different borrower/property circumstances may not be directly comparable.

## Repository origin

RatePro starts from the current React application snapshot at source commit
`cc1ae9e2547eb54b9091083d8471b99a8e5d4a2b` on 31 October 2026.
The legacy Angular/AWS Git history is not included in this repository.
The existing RatePro LICENSE and third-party component notices are retained.

The application name, browser storage keys, export filename and Cloudflare Pages
project name are now `ratepro`. Browser storage is origin-specific: export JSON
from the previous site and import it here to transfer current observations.
Saved packages, preferences and historical revisions are not transferred by that import.

Connect Cloudflare Pages to **jasonjiang8866/ratepro**, production branch **main**,
build command **npm run build**, output directory **dist**, and **NODE_VERSION=22**.
The GitHub workflows are included, but Cloudflare Git integration is configured
separately in the Cloudflare dashboard. A repository migration does not move an
existing Pages project, custom domain or deployment history.

`src/components/ui/` contains shadcn/ui registry components with local utility and
individual Radix imports. See `THIRD_PARTY_NOTICES.md`.
