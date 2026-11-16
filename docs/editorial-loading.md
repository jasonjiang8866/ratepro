# Static editorial loading (schema v1)

## Audit and scope

Audited main `28fbb1a68db9255986b0c63c0520946ad9d9e31a` contains 18 reports. `content.ts` eagerly imported every JSON article; Home and JapanTools filtered that in-memory corpus, and App scanned it for legacy link market resolution. The reading room had no pagination. Thus SG visitors also downloaded JP bodies and detailed source/term records.

This change concerns editorial content only. Rate feeds, collectors, browser rate history and calculators are unchanged. Draft rate-history PR #27 is independent; shared App/package/README edits will need the usual merge reconciliation.

## Publication

Continue adding/revising validated JSON in `content/insights/` and `content/promotions/`. Keep published slugs and historical files; use `supersedes` for revisions. No hand-maintained index is needed. `npm run build` validates the corpus, generates static assets, type-checks and builds Vite. `npm run dev` generates assets on start; rerun `npm run build:editorial` after editing source content during development.

The ignored output `public/data/editorial/v1/` contains:

- `manifest.json`: constant-size market/category counts, corpus revision and home calendar bounds.
- `<revision>/<SG|JP>/pages/<all|market|guide|package>/<page>.json`: 20 summaries, with precomputed reading time, freshness and revision-link metadata. No sections, full source records or detailed package terms.
- `<revision>/<market>/calendar/YYYY-MM.json`: at most 31 day-to-home pointers; only the current market/month is fetched.
- `<revision>/<market>/home/<hash>.json`: one briefing, its maximum three takeaways and minimal supporting links, plus at most three package cards with a truncated eligibility preview.
- `articles/<slug>.json`: one full validated article and its reverse-revision link.
- `resolve/<slug>.json`: tiny market locator for legacy hash links without a country query. No global slug list is loaded.

The revision is SHA-256 of the validated sorted corpus plus the generator format. Output does not depend on a generation timestamp. Validation rejects duplicate slugs/events, absent sections, invalid evidence/revision references, filename/slug mismatches, wrong folders and payloads exceeding budgets. SG/JP calendar selection uses the market's local day; the existing minute clock updates freshness/expiry labels without changing source timestamps. Calendars cover known eligibility boundaries, with bounded before/after projections outside them.

Any incompatible projection change must increment `format` and the versioned directory/schema/client together. The source Article schema remains v1; no content migration is required here.

## Fetch and retention

Home fetches only a manifest, the selected market's current calendar/home projection and current category/page. Classification happens at build time over the entire corpus, including old records. Changing filters never requires downloading all summaries. Pagination replaces the 20-card DOM instead of appending it. JP tools reuse the same paginated metadata; complete editorial evidence lives in the reader.

Opening an article fetches its stable JSON path. Only reader UI code uses dynamic import; article data uses fetch so it is not retained by the module registry. AbortController and unmount guards prevent late responses from replacing a newer route. Loading, unavailable/retry, empty and missing-report states are distinct. Slugs, explicit market queries, legacy hash links, source links, expired articles, revision links and browser forward/back remain supported.

| Cache | Entries | UTF-8 serialized payload budget |
| --- | ---: | ---: |
| Full article bodies | 5 | 512 KiB |
| List pages | 6 | 384 KiB |
| Home projections | 2 | 192 KiB |
| Month calendars | 2 | 16 KiB |

All four caches use LRU plus a five-minute TTL checked on access/insertion. There is one manifest (maximum 8 KiB, 60-second refresh). Responses are stream-limited before parsing (body 512 KiB, page 128 KiB, home 96 KiB, calendar/manifest 8 KiB, locator 2 KiB). Cache sizes account for serialized UTF-8 bytes, **not actual heap size**. Active React state and a bounded number of in-flight responses add overhead. Eviction releases application references; browser HTTP caches, GC timing and OS RAM are outside this guarantee. No editorial data is stored in localStorage.

## Deployment consistency

Existing `/data/*` headers already require HTTP revalidation; requests use `cache: no-cache`. Lists/home/calendar are corpus-revision scoped. Bodies and locators have stable slug paths and are regenerated for **every retained historical article** in each deployment, so an older list's slug does not disappear when the deployment changes. Each fetched body/projection carries its corpus revision. On a mismatch, missing versioned asset or HTML SPA fallback, the client refreshes the manifest and retries once. A new manifest revision clears all LRU caches. Repeated failures expose retry instead of mixing silent partial data.

A currently open article can retain its loaded revision for that reading session. No promise of instant content replacement or indefinite offline access is made. Old app shells from before this refactor already contain their embedded data and continue to work. Do not delete published source articles; corrections must preserve their slugs. No hosting configuration, backend or paid service is added.

## Verification and reproducible measurements

- `npm ci`, `npm test`, `npm run build`.
- `npm run test:ui`: existing production UI checks, including SG/JP calculators/comparison, navigation, sources, 320px layouts and dark mode.
- `npm run test:editorial:ui`: isolated before/after production builds at 18 and 1,000 reports, Chromium request logs, body race/retry, all-history filters, page/body eviction and screenshots.
- `npm run test:editorial:ui -- --build-only`: same deterministic build measurements without Chromium.

The benchmark archives the audited baseline SHA and copies current code into temporary directories. It adds deterministic long-body fixtures there only, then deletes those directories. It never writes synthetic reports into release content or modifies the main checkout. The normal release excludes the read-only cache diagnostic used by the `editorial-test` production build. CI uploads `test-results/editorial/measurements.json` and screenshots. Gzip figures are reproducible compression estimates, not a claim about actual CDN transport encoding. No heap/process-RAM reduction is inferred from byte or cache counts.
