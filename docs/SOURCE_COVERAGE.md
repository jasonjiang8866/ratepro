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
- All reads are bounded unauthenticated GETs to explicit official URLs. Existing
  timeouts, response-size caps and redirect rejection remain in place. No access
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
requires both newly integrated sources to succeed. Its network-dependent result
is separate from deterministic frontend tests.

Live GitHub Actions and preview validation results will be recorded with the PR.
