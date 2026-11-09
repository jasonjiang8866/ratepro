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

Results will be recorded after the actual GitHub check. The published Maybank
observations remain reviewed/stale; successful web search or local extraction is
not evidence that the GitHub collector has recovered.
