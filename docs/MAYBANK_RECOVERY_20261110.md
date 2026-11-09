# Maybank recovery investigation — 10 November 2026 (Singapore)

Continues Draft PR #19 from `df3852e43d21dd09bdde5437f5c094612bd12b2b`.
Main remains `b673ac33623c14212435417c6baf48228e0d9ad9`. The preceding final-head
UI run [42654744782](https://github.com/jasonjiang8866/ratepro/actions/runs/42654744782)
has now completed successfully.

## Public candidate selection

| Official publication | Scope | Decision |
| --- | --- | --- |
| [Country-specific package page](https://www.maybank2u.com.sg/en/rates/rates-sora.page?country=en-sg) | Publicly indexed HTML with the four existing completed-property fixed/SORA schedules | Test once using the collector's existing curl HTTP/1.1 policy, then the unchanged strict Maybank parser. Not yet a production URL change. |
| [HDB loan FAQ](https://www.maybank2u.com.sg/iwov-resources/sg/pdf/faq/personal/loans/hdb-loan-faqs.pdf) | April 2026, Maybank Singapore Limited; question 13 directs readers to mortgage specialists for packages | Not a numerical rate-table fallback. The PDF is linked from the official HDB product page. |
| [Private loan FAQ](https://www.maybank2u.com.sg/iwov-resources/sg/pdf/faq/personal/loans/private-loan-faqs.pdf) | April 2026; question 9 directs readers to mortgage specialists | Not a numerical rate-table fallback. |
| [Loans reference rates](https://www.maybank2u.com.sg/en/rates/rates-lending.page) | Board/reference rates, including SRFR/SRFR2/FDMR36 | Cannot replace fixed-rate or SORA package stages; these are different rate bases. |
| [HDB product page](https://www.maybank2u.com.sg/en/personal/loans/property-loans/home-loan-hdb.page) | Eligibility, promotions, calculator and specialist enquiries | No complete replacement schedule established. Renovation-loan promotional percentages are not mortgage rates. |

Search/page inspection identifies candidate publications only; it never renews
rate observations. The country parameter is present in a publicly indexed official
page, not a guessed API, proxy or hidden endpoint. The original runner failures
were timeouts, not a received denial. The probe makes one bounded unauthenticated
GET without retry, redirect following, credentials, custom UA, TLS changes or a
different network path. A 403/429 is a failure; no browser is tried after it.

The rate tables are present in HTML. There is no evidence that JavaScript rendering
is necessary, so a browser dependency is not added as a speculative timeout fix.

## Implemented validation

`scripts/maybank-diagnostics.ts --country-candidate` uses a temporary bounded
response file, records request timings and validates the complete existing
four-product group only after a completed HTTP 200. It outputs research candidates
to ignored `research-output/maybank-country/report.json`; it does not write or
switch the production feed/source. It compares snapshot bytes before and after.
HTTP errors with a rate-looking body, app shells, quote-only text, incomplete
tables, duplicates and oversized/empty bodies cannot count as recovery.

The read-only source workflow includes an independent candidate job. Both failed
network access and failed parsing return a nonzero status. Success would establish
only a candidate until an explicit collector integration is implemented and tested.

Actual GitHub results are recorded below. The published Maybank
observations remain reviewed/stale; successful web search or local extraction is
not evidence that the GitHub collector has recovered.


## Verified result and decision

At implementation `5a91e0e1a08b626d38da89705e258231d1268705`, the
[country-page job](https://github.com/jasonjiang8866/ratepro/actions/runs/42656651116/job/129296791825)
failed. Request time: `2026-11-09T16:37:41.630Z` (10 November 00:37 Singapore).
DNS completed in 0.032235s, connection in 0.039954s and TLS in 0.062037s;
no first response byte was received before the 30.003026s timeout. HTTP code was
0, downloaded bytes 0, curl exit 28. Parsing did not run. Snapshot byte equality
was verified. [Durable evidence](maybank-country-evidence-20261110.json).

The local candidate read at `2026-11-09T16:35:53.160Z` returned HTTP 200 and
passed all four existing package parsers. Its 42,300-byte body SHA-256 was
`1e00d0348d02c8c7829435b3676dbf13fe52e856f00af3f994469b092eae5ec3`.
This environment difference is observed, not a proven geographic/WAF root cause.
The local result never refreshed the production feed or collector health.

Decision: do not enable the query variant as a source or automatically retry it
on each PR. The candidate job is now explicit opt-in on the read-only source
workflow (`probe_maybank_country: true`); no production workflow changes are
needed. A Maybank source error now displays **Manual recheck required**, with
an explicit statement that original review dates are retained. The raw timeout
category and original source link remain visible.

To restore automation, require a real runner success of a permitted official
publication with all four existing schedules, their exact SORA tenors/spreads,
fixed-to-floating transitions, lock-ins, minimum loan/tenure and applicability.
A bank-authorized export could qualify after provenance and parsing are verified.
The currently found FAQ, board-rate page, renovation promotion, search result or
local-only success does not qualify. No operator message has been sent.

For a manual update, obtain the complete current official package page with its
actual UTC capture time and use the existing [official-file review workflow](REVIEW.md).
Keep `method: reviewed`; do not relabel a human review as a restored collector.
No fresh manual rate observation is included in this engineering PR.

Validation: 162 unit/integration tests passed with one opt-in browser research
test skipped; local TypeScript/content/Vite build passed. The first GitHub
[frontend check](https://github.com/jasonjiang8866/ratepro/actions/runs/42656651256)
also passed. HDB, stable (DBS/SC) and expanded (UOB/Citi) live checks remained
successful. Maybank's known transport failures remain red.
