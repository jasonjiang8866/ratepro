# Historical observations and trend analytics (v1)

## Audit baseline

Audited `main` at `28fbb1a68db9255986b0c63c0520946ad9d9e31a` on 16 November 2026;
there were no open PRs. SG `rates.json` and JP `rates-jp.json` are current-state
feeds. SG browser history retains at most 500 **replaced** observations, combining
rate and terms changes; imports do not import that ledger. JP caches its current
feed without equivalent history. Both scheduled collectors commit snapshots to
Git, retain older observations on failure and previously did not publish
all-source failures. None of these mechanisms was a durable public time series.

The baseline Frontend checks run failed seven homepage tests because their expected
featured articles depended on the growing live editorial corpus. The two historical
deadline scenarios now use their explicit original fixtures; production editorial
selection is unchanged.

## Storage and invariants

```
public/data/history/v1/{SG,JP}/
  observation/YYYY-MM-DD.jsonl
  attempt/YYYY-MM-DD.jsonl
  catalog/YYYY-MM-DD.jsonl
  product-version/<sha256>.jsonl
public/data/analytics/v1/{SG,JP}/
  index.json
  <product-id>/<year>.json
  events/YYYY-MM-DD.json
```

The JSONL ledger is the append-only authority. Versioned Zod schemas, content-derived
SHA-256 IDs, market/path checks and product-version references validate it. A record
is added once, regardless of which later snapshot retains it. Original provenance
is first-seen and is not rewritten on reruns. Product versions store full published
terms once; observations retain the full pricing schedule and reference that version.
Use a single writer (the existing shared Actions concurrency group serializes SG/JP).
A failed validation blocks the publishing commit.

**Observations and change events are different datasets.** Thirty successfully
observed unchanged daily rates give thirty observation rows, one initial state and
zero repricing events. Two genuine observations on one day are retained; rerunning
the same snapshot/attempt creates no duplicates. This avoids collapsing intraday
changes. Rate and terms changes can both occur in one observation. Stage labels
and product labels are terms, not numeric price changes.

Events and analytics are deterministic, replaceable materialized views of the raw
ledger, not an independently edited authority. Rebuilding after an earlier backfill
can change transitions; obsolete derived partitions are removed. Canonical ledger
rows are never deleted or rewritten. New/renamed products retain a stable product ID
when identity is known; changing an ID creates a separate product, never a guessed
merge. Catalog removal emits `not-tracked`, and reappearance emits
`tracking-resumed`. These are RatePro inventory events, **not assertions of bank
withdrawal**. An explicit effective end is retained and displayed as expired;
lack of recent observations is displayed as overdue. SG now replaces a complete,
validated source group on success, matching JP's inventory behavior; partial or
failed groups retain their previous products.

## Time and provenance contract

| Field                              | Meaning                                                          | Must not substitute for                |
| ---------------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| `observedAt`                       | Original observation timestamp from the source snapshot          | Commit, import or effective date       |
| `effectiveFrom` / `effectiveUntil` | Explicitly recorded bank/official validity dates, otherwise null | Observation or publication date        |
| `publicationMonth`                 | JP source's stated publication month                             | An inferred effective period           |
| `provenance.feedGeneratedAt`       | Time the input feed was assembled                                | Time every retained offer was observed |
| `provenance.importedAt`            | When this immutable record entered the ledger                    | A new rate observation                 |
| `provenance.committedAt`           | Git commit metadata for a recovered/committed snapshot           | Bank repricing date                    |
| analytics `generatedAt`            | Time the derived index last changed                              | Evidence freshness                     |

Every observation retains source ID, product ID, evidence URL, collection method,
pricing and provenance. Backfill resolves literal source URLs from the schema in
**that historical commit**, without executing old code, and records the exact feed
byte checksum, path and commit SHA. The Git link is immutable evidence of what the
collector stored, not an archived copy of the bank's HTML. JP v1 feeds do not record
method: they explicitly remain `unspecified`, rather than inventing one. Live
collection diagnostics have a run URL and no misleading Git blob link to an
uncommitted diagnostics file. Ingestion of an already committed feed uses its
commit as evidence.

Collection attempts are independent records, retaining errors, messages, HTTP status,
retry counts and official fallback details where present. Old observations carried
through a failed snapshot are deduplicated at their original time, not renewed.
Failed collectors cannot create fresh observation points. Reviewed/browser records
may be newer than scheduled failures and retain their separate method. Historical
all-source failures that were never committed cannot be reconstructed; do not infer
attempts from a calendar or fabricate successes. Source success rate is successful
logical attempted timestamps / recorded attempted timestamps; conflicting outcomes
at a timestamp fail closed. Product observation counts are not attempt counts.

## Pricing and analytics

- SG headline charts use **initial-stage** rates. SORA records retain a null all-in
  annual rate, benchmark tenor and spread. Spread charts are labeled separately;
  no benchmark fixing, all-in estimate or zero is fabricated.
- JP annual rates retain applied vs standard basis in the product version, plus
  reference rates as a separate field. Comparisons require the same market, basis,
  rate kind, purpose and fixed period. Applied and standard rates never share a
  comparison overlay. This is not an offer ranking or an eligibility guarantee.
- SG comparison keys also retain initial-stage label, property, construction and
  purpose. Cross-bank overlays are available where these match (e.g. Maybank/SBI
  initial fixed rates). Terms and borrower qualification can still differ.
- The full rate schedule participates in change detection. Initial-stage changes
  yield signed percentage-point deltas; later-stage/reference/formula changes can
  emit `rate-change` without falsely claiming the headline rose or fell.
- Min/max/latest use the current product comparison basis. Historical points on
  an incompatible older basis become explicit chart gaps. Null is never zero.
- Lines break at nulls, elapsed explicit validity and gaps over 36 hours. Points
  remain discrete evidence, not interpolated values or assumed effective rates.
- Date windows are calendar-month based and clamp month ends. No future points
  enter the chart. The observed span is last minus first observation; it is not a
  proven continuous product lifetime.

## Commands and daily operation

```sh
npm ci
# Full clone required; only first-parent snapshots on the chosen published branch.
npm run history:backfill -- --ref origin/main
# Preserve already published or manually reviewed snapshots.
npm run history:ingest
# After a collection (including all-source failure):
npm run history:ingest -- --market SG --input source-check.json
npm run history:ingest -- --market JP --input japan-source-check.json
npm run history:validate
npm run history:build
npm test
npm run build
npm run test:ui
```

Backfill never follows arbitrary side-branch experiments. It reports rejected
snapshots in `history-reports/backfill.json` and exits nonzero, preserving evidence
for review; it does not silently invent a migration. `history:validate` is read-only.
`history:build` rebuilds derived JSON. Repeating a no-op ingestion/rebuild leaves
ledger and analytics bytes unchanged (including the index generation timestamp).

The proposed daily workflows first ingest the published snapshot, run the existing
collector, ingest its diagnostics regardless of collector outcome, then validate,
build and commit feeds plus history/analytics together. On all-source failure the
latest feed remains unchanged, failure evidence is committed, and the job reports
failure afterward. No new schedule, service, secret, database, hosting setting or
paid infrastructure is introduced. A fatal crash with no valid diagnostics fails
closed; a missing diagnostic is not a successful collection. The schedules only
change after this PR is reviewed and merged.

## Loading and long-term maintenance

The Trends route is lazy-loaded. It fetches one market index and only selected
products' yearly shards intersecting the requested window, with at most two
selected products. Market/product changes abort pending requests and release old
series; there is no accumulating browser cache of historical records. Published
terms load only when their explicit evidence link is opened. Existing latest feeds,
imports/exports, browser history, comparison and calculators retain their schemas.

Daily raw partitions, content-addressed terms and product/year series avoid a
monolithic growing JSON. The UI index holds per-product summaries and only the last
60 non-initial events; the complete event record remains date-partitioned. For a
single product, five years of daily data means at most five shards, not every bank's
five-year history. The offline builder currently reads the ledger into memory;
future scale work can stream partitions, incrementally rebuild touched products,
and provide downsampled multi-year display shards without changing raw observations.
Track static-host file quotas and repository size before expanding the source count
substantially. HTML/PDF byte archiving is not included in this first version.

Schema upgrades must add a new schema decoder and a reviewed deterministic migration
into a **new version directory**, with old IDs/provenance retained as references and
fixture tests for old versions. Never reinterpret v1 in place. Corrections to
canonical observations require an explicit future supersession/correction record
format; unsupported/ambiguous same-timestamp conflicting observations currently
stop ingestion/analytics for review.

## Initial replay evidence (16 November 2026)

38 first-parent feed revisions replayed; 0 rejected; 1,054 unique ledger records.

| Market | Products | Successful product observations | Recorded source attempts | First observation    |                  Derived events |
| ------ | -------: | ------------------------------: | -----------------------: | -------------------- | ------------------------------: |
| SG     |       21 |                             198 |                      142 | 2026-10-30 01:50 UTC | 22 (21 initial, 1 terms change) |
| JP     |       39 |                             585 |                       30 | 2026-11-03 06:01 UTC |             39 (initial states) |

No numerical rate changes are evidenced in this replay window. The dashboard must
not invent movement to make a chart more interesting. Rerunning backfill and current
snapshot ingestion added zero records. Both old public feed files remain byte-identical.

## Verification and first-version limits

Unit/integration coverage includes a real temporary Git repository replay, exact
feed checksum/provenance, byte-idempotent reruns, unchanged observations, failure
retention, rate vs terms events, renamed/deleted/resumed products, broken references,
market/basis isolation, SORA, calendar filtering, gaps and source-group replacement.
Browser checks exercise the built app, two-bank overlay, lazy network requests,
keyboard evidence selection, SG/JP navigation, four mobile/tablet widths, dark mode,
empty feeds, empty series and error/retry states. Existing UI checks cover the latest
SG/JP comparison and calculators.

Local unit/build checks run in the development container. Local browser execution is
blocked by a Chromium socket permission error; GitHub's Homepage UI job is the
browser acceptance surface. The PR records final CI results. Remaining extensions:
explicit correction/identity-alias manifests, a complete event browser, downsampled
long-horizon charts, streamed offline rebuilds and archived source document bytes.
