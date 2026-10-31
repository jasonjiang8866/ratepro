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
2. **Publication:** `.github/workflows/refresh-rates.yml` runs once daily at 09:23 Singapore time (01:23 UTC) after it is merged into `main`, or manually via Actions. A Node build-time collector extracts known public tables and commits the validated static JSON snapshot. Cloudflare Pages Git integration can build/deploy the updated snapshot. No collector code runs on Cloudflare or in response to a visitor's request.

Thus loading the page can collect **CORS-permitted** sources directly and pick up the most recently published static feed; it cannot force real-time access to CORS-blocked pages. It does not search or crawl the entire web, bypass access restrictions, or use an LLM to guess financial values.

The scheduled collector requires GitHub Actions to be enabled and repository rules that permit its `GITHUB_TOKEN` to push `public/data/rates.json` to `main`. If branch protection blocks this, maintain the feed through reviewed PRs or run `npm run collect` locally; do not disable protection just to accommodate it. Actions-created commits do not trigger other GitHub Actions workflows, so the collector runs tests and the production build itself before pushing. Verify the first scheduled commit triggers your external Cloudflare Git integration; otherwise build/deploy that commit from Cloudflare's dashboard. A static deployment does not refresh itself without a later build/deploy.

### Current source coverage

| Source                                                                                           | Extracted packages                                     | State at migration                                                                       |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [DBS HDB loans](https://www.dbs.com.sg/personal/loans/home-loans/hdb-loan)                       | 3-Year CPF-OA HDB Loan, full advertised stage schedule | Direct collector retrieval and extraction succeeded                                      |
| [DBS Green Home Loan](https://www.dbs.com.sg/personal/loans/home-loans/dbs-green-home-loan)      | FHR6 package, initial and thereafter all-in rates      | Direct collector retrieval and extraction succeeded                                      |
| [HDB interest rate](https://www.hdb.gov.sg/managing-my-home/finances/loan-matters/interest-rate) | Current concessionary quarter                          | Direct request returned HTTP 403; explicitly labelled reviewed Q4 2026 snapshot retained |

The initial HDB observation was reviewed against official search-indexed content on 30 October 2026, **not** successfully collected from the live page. It is marked `method: reviewed`. Search-indexed DBS text differed from direct HTML; only direct extracted DBS tables are included. No synthetic bank offers, guessed private-property fixed rates, or SORA-as-mortgage-rate shortcuts are used. OCBC, UOB and MAS are research links only.

Sources can change page structure, stop publishing a package, block automation, or return different content by location. Parsers fail closed when expected fields disappear. Old observations are retained with their original date; they are **not proof that a package remains on sale**. Data older than seven days or past its published effective end is marked stale. Feed download time is never treated as source observation time. Source dates are retrieval dates unless an effective period is explicitly provided. There is no claim of full market coverage.

### Extend sources

1. Add an exact official URL and source ID to `src/lib/schema.ts` and the CSP allowlist in `public/_headers`.
2. Add a source-specific parser in `src/lib/parsers.ts`, reading semantic table rows rather than unrelated headline percentages. All-in rates and benchmark spreads must remain separate.
3. Add small representative fixtures plus malformed-page and rate-change tests. Check usage terms and extraction feasibility for the source before enabling it.
4. Run `npm run collect`, review the JSON and original page, then commit the snapshot.

The collector issues one request per source sequentially, with a 12-second timeout and a 2 MB response cap. Partial failures retain previous observations; total failure exits nonzero so CI does not publish it. DOM parsing does not execute fetched scripts or render external HTML. Requests omit credentials and reject redirects. No third-party proxy or API key is present.

## Deploy directly to Cloudflare Pages

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

`ratepro.cache.v1` in localStorage stores schema-versioned observations, source status and at most 500 prior revisions. Saved package IDs/theme are stored separately. localStorage is intentionally sufficient for this small directory; unavailable/quota-limited/corrupt storage is surfaced to the user. Export before clearing site data or changing domains. The browser contacts only its own origin and the three allowlisted source hosts; lenders see ordinary network requests but no calculator inputs. No analytics or remote fonts are used.

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
