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

| Cache               | Entries | UTF-8 serialized payload budget |
| ------------------- | ------: | ------------------------------: |
| Full article bodies |       5 |                         512 KiB |
| List pages          |       6 |                         384 KiB |
| Home projections    |       2 |                         192 KiB |
| Month calendars     |       2 |                          16 KiB |

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

### Verified results — 16 November 2026

Measured on implementation commit `03469faaf9ea0f62a3717528c86f16d1fb00be97` against the pinned audited baseline. Values below are ordinary production builds (the cache-diagnostic mode is used only for the subsequent browser stress scenario).

| Corpus             | Before initial JS | After initial JS | Before gzip estimate | After gzip estimate |
| ------------------ | ----------------: | ---------------: | -------------------: | ------------------: |
| 18 real reports    |         559,314 B |        509,914 B |            171,613 B |           157,783 B |
| 1,000 test reports |      13,494,618 B |        509,914 B |          1,515,937 B |           157,783 B |

The reader UI is a separate 4,260-byte JS chunk; its article bodies are independent JSON. The main application still includes the existing rate directory/calculators; this change does not attempt a general application bundle overhaul.

| Visit                          | Actual editorial requests                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First SG home, 18 reports      | Manifest twice (parallel home/page initialization), SG November calendar, SG all/page 1 and SG home projection: **10,732 B decoded JSON**, zero bodies |
| Switch to JP                   | JP November calendar, JP all/page 1, JP home projection; zero SG editorial requests and zero bodies                                                    |
| Open one JP report             | `articles/jp-boj-asada-november-policy-lags.json` plus the reader UI chunk                                                                             |
| First SG home, 1,000 reports   | Same bounded structure: **16,108 B decoded JSON**, 20 cards, zero bodies                                                                               |
| Open one stress-session report | `articles/sg-weekly-2026-11-16.json` plus the reader UI chunk                                                                                          |

Before the change, all bodies were already in initial JS, so opening a report or switching market required zero additional editorial requests. That zero was preloading, not a smaller payload. The above byte totals are decoded response-body sizes; they exclude unrelated existing rate-feed requests. Browser routing disables HTTP caching for reproducible cold-network tests. The two small concurrent manifest requests are retained to keep each caller's abort lifecycle independent; they do not grow with corpus size.

Verification:

- `npm ci`, content validation, TypeScript and production build passed.
- Unit/integration suite: **211 passed, 12 skipped** (existing optional browser research tests).
- [Existing production desktop/mobile UI suite](https://github.com/jasonjiang8866/ratepro/actions/runs/43807820892) passed, including calculators, market isolation, old links, back/forward, dark mode and 320px overflow checks. Desktop/light and mobile/dark screenshots were visually inspected.
- [Production stress suite](https://github.com/jasonjiang8866/ratepro/actions/runs/43807820765) passed: nine pages, all-history category selection, 20-card DOM ceiling, eight articles, five-body LRU retention, evicted-body refetch, late-request isolation, retry after 503, missing/expired/legacy articles, mobile dark layout and cache byte bounds.
- [Raw measured evidence](benchmarks/editorial-loading-2026-11-16.json) is committed separately from the synthetic content. Screenshots are available in those CI artifacts.
- The separately triggered [official source integration workflow](https://github.com/jasonjiang8866/ratepro/actions/runs/43807820876) remains red because the unchanged Maybank transport/experimental live-source probes time out. Stable, expanded and HDB checks pass; no collector or feed repair is included in this editorial PR.

Heap and Chrome process RAM are **not measured**. The local environment cannot run Chromium reliably, and the CI suite does not establish a controlled heap-profile baseline. Its evidence is production-build bytes, actual fetches, bounded retained cache entries/payloads and DOM counts. These do not establish a specific heap reduction or immediate OS memory release.
