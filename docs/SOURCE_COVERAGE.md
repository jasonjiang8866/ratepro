# Official source expansion — 31 October 2026

## Investigation

These findings describe the specific public pages reviewed, not all products a
bank may offer. No customer quote, account login or broker rate was used.

| Bank               | Official source                                                                              | Finding and decision                                                                                                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maybank            | https://www.maybank2u.com.sg/en/rates/rates-sora.page                                        | HTML tables publish fixed periods and 1M/3M SORA spreads, minimum amount and lock-in. Integrate the four completed-property packages. BUC packages remain out of scope.                                                                                                      |
| Standard Chartered | https://www.sc.com/sg/borrow/mortgages/sora/                                                 | HTML table publishes a 3M SORA spread schedule, minimum amount and lock-in. The page says the schedule is valid from 27 February 2021. Retain that date and ask users to confirm availability.                                                                               |
| OCBC               | https://www.ocbc.com/personal-banking/ls_personal/loans/new-purchase-of-hdb-private-property | Describes fixed and 3M SORA packages but the reviewed package section has no complete numerical schedule. Research link labelled quote required.                                                                                                                             |
| UOB                | https://www.uob.com.sg/personal/borrow/property-loans/private-home-loan.page                 | Refers fixed/combination package enquiries to a specialist. Research link labelled quote required; no numerical package inferred.                                                                                                                                            |
| Citi               | https://www.citibank.com.sg/global_docs/pdf/Pricing-Packages.pdf                             | A dated, two-page PDF separates Citigold and Citibanking tiers, loan-size bands and conditions. The version directly read during research was printed 30 September 2026; search snippets differed. Link only until PDF layout/version and eligibility extraction are tested. |

Maybank's residential-property scope is also supported by its official
[HDB home-loan FAQ](https://www.maybank2u.com.sg/iwov-resources/sg/pdf/faq/personal/loans/hdb-loan-faqs.pdf).
Exact approval, fees, subsidies and borrower eligibility must still be confirmed
with the lender. Public indicative schedules can differ from personalised quotes.

## Representation and failure behavior

- Fixed/all-in advertised rates remain numeric. SORA-only stages have a null
  all-in rate and an explicit benchmark name, 1M/3M tenor and percentage-point
  spread. No benchmark value or fixing date is invented, and no estimate is
  computed until an independently sourced fixing exists.
- A fixed-period product keeps its subsequent floating formula. Sorting only
  compares numerical initial rates; formulas follow them in both directions.
  Comparison and history render formulas without interpreting null as zero.
- Source effective dates, observation times and feed download times stay
  separate. The SC terms date appears on its card, not just in hidden details.
- A source must parse its complete supported group before any offers are
  updated. Missing rows, ambiguous duplicate tables, changed tenor/eligibility,
  malformed rates and HTTP failures preserve the source's entire prior data.
- OCBC/UOB quote links and the Citi document are not rate records, are not in
  rankings, and do not count as automatically monitored sources.
- All reads are bounded unauthenticated GETs to explicit official URLs. The default 12-second timeout, response-size cap and redirect rejection remain.
  Maybank alone has a bounded 30-second collector timeout; browser requests
  retain the 12-second limit. No access
  controls, CORS restrictions or blocked-source responses are bypassed.

## Fixtures and verification

`tests/fixtures/maybank.html` and `sc.html` contain minimal table and eligibility
excerpts from successful direct downloads of the above URLs on 31 October 2026.
Navigation, scripts, styling and unrelated content are omitted. Table values
are not reconstructed from search snippets. Raw pages were also inspected to
confirm the table structure before writing the parsers.

The deterministic suite covers fixed-to-floating transitions, benchmark tenors,
missing/duplicate/malformed rows, source effective dates, quote-versus-spread
validation, nullable-rate sorting/payment behavior, property filters, retained
history and partial-source failures. Existing numeric exports remain supported.

Initial local validation: 40 tests and TypeScript/Vite build passed. A real
collector run successfully read DBS and SC; HDB returned HTTP 403 and retained
its reviewed snapshot. Maybank returned HTTP 500 to the Node collector, including
one follow-up attempt, although the earlier direct download succeeded. This is
recorded as a retrieval limitation rather than silently substituted with a
search-index rate.

`npm run verify:sources` and the separate **Official source integration check**
workflow run the real collector without changing the published snapshot. The
workflow has read-only repository permission, saves an observation artifact and
reports stable (DBS/SC) and experimental (Maybank) groups independently. Each
group requires all of its sources to succeed; experimental failures are still
failures. Its network-dependent result is separate from deterministic frontend tests.

### Live results and unresolved source availability

- [First integration run](https://github.com/jasonjiang8866/ratepro/actions/runs/41185914243):
  SC and DBS succeeded; HDB returned 403; Maybank timed out at 12 seconds.
- [Follow-up integration run](https://github.com/jasonjiang8866/ratepro/actions/runs/41186050280):
  Maybank still timed out with the bounded 30-second collector limit. SC and DBS
  succeeded again. The live-source check is intentionally still failing; this
  source is not claimed to be operationally reliable.
- The checked-in SC/DBS observations come from that second run. HDB retains its
  original reviewed observation. Four Maybank offers are explicitly marked
  `method: reviewed`, based on the earlier successful direct HTML download at
  `2026-10-31T08:35:44.853Z`, not the failed job's timestamp. The latest Maybank
  source status remains an error, with no invented successful extraction time.
  SHA-256 of the original downloaded HTML:
  `1e00d0348d02c8c7829435b3676dbf13fe52e856f00af3f994469b092eae5ec3`.
- The resulting snapshot contains eight observations from four lenders. Formula
  and fixed-period values match the reviewed official table excerpts. Further
  source failures retain this snapshot with its real observation dates.
- [Frontend CI](https://github.com/jasonjiang8866/ratepro/actions/runs/41186050356)
  passed 40 tests and the production build. Cloudflare also deployed the initial
  feature preview; this is not a production deployment.
- Browser interaction on the feature preview confirmed the SC formula and source
  effective date, and a DBS/SC comparison showed a numerical DBS estimate while
  SC displayed “Not calculated: benchmark fixing required”.

PR #1 was merged on 31 October 2026 at 17:01 SGT (commit `8d54591`).
Cloudflare reported success for that commit, and the production domain's
`/data/rates.json` was checked against the merged snapshot: all eight observations
matched. Maybank automatic retrieval remains unresolved. Its independent
experimental check preserves the failure rather than treating a reviewed snapshot
as successful extraction.

Freshness follow-up: cards show age, manual-review provenance and explicit
recheck reasons. Sources displays published collector evidence independently
from browser-direct checks, including full Singapore timestamps. A fresh feed
download or failed attempt never advances an offer's observation date. Old cache
exports remain readable; missing channel evidence is not reconstructed or guessed.
