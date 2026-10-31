# Official retrieval investigation — 31 October 2026

## Expanded coverage

- UOB's [SORA page](https://www.uob.com.sg/personal/borrow/property-loans/about-sora.page)
  publishes a complete four-stage schedule, commitment and minimum loan. The
  explicit scope is completed residential property, purchase/refinancing and
  new direct-to-bank customers. This corrects the earlier broad quote-only
  classification: fixed-rate enquiries still require a quote. One combined
  HDB/private observation avoids counting the same schedule twice.
- Citi's [official PDF](https://www.citibank.com.sg/global_docs/pdf/Pricing-Packages.pdf)
  was downloaded and both pages visually checked against Poppler text extraction.
  Four completed-variable schedules are extracted atomically: two customer tiers
  and two loan bands. Both pages must have the same valid, nonfuture print date.
  Missing columns, changed tenor, ambiguous tiers/bands or missing rate-floor/AUM
  conditions reject the entire source. Fixed and BUC schedules remain excluded.
  The PDF does not establish HDB/private or purchase/refinance applicability for
  these records, so those fields explicitly require confirmation.
- HSBC's [home-loan page](https://www.hsbc.com.sg/loans/products/home/) has a
  conditional headline offer but no complete extracted stage schedule. It is
  linked for enquiry, with no fabricated rate observation.

The PDF print date is document provenance, not a bank observation or effective
date. SORA spreads remain formulas with null all-in rates. The Citi minimum
effective-rate floor, customer tier, loan upper bound and relationship balance
are shown explicitly. No benchmark fixing or monthly payment is invented.

## Failure findings and recovery limits

| Source                 | Observed evidence                                                                                                                                                                                  | Implemented or available response                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Maybank                | Node GET returned HTTP 500 with a generic CMS error page. The same official URL returned 200 and valid content through ordinary curl. A published country-query variant also returned 500 to Node. | Use standard curl for this exact collector URL and validate the same parser. GitHub validation is required; local client differences do not prove a specific TLS, HTTP or WAF cause. |
| HDB                    | Node GET returned HTTP 403.                                                                                                                                                                        | Do not retry or bypass. Retain reviewed quarter with original observation and expiry.                                                                                                |
| CPF alternative        | Official quarterly announcement explicitly confirms HDB interest, but this environment received HTTP 403 and a “Connection Unsuccessful” page.                                                     | Useful official manual-review source; not installed as an automated fallback.                                                                                                        |
| Browser CORS           | Browser-direct checks fail while server collection can succeed.                                                                                                                                    | Read the same-origin published snapshot; collector and browser status remain independent.                                                                                            |
| Transient retrieval    | Timeouts, network failures and selected 5xx/408 responses can be temporary.                                                                                                                        | One retry after two seconds; same URL, client and network path. Record attempts and final category.                                                                                  |
| Format/document change | A successful HTTP response can still contain an error page or a changed table.                                                                                                                     | Parse strictly and retain the complete prior source group; never retry a parse error.                                                                                                |

The [CPF quarterly announcement](https://www.cpf.gov.sg/member/infohub/news/news-releases/government-extends-4-per-cent-interest-rate-floor-on-special-medisave-and-retirement-account-monies-until-31-december-2027)
is a fixed dated document, not a rolling API. Even if retrieval becomes possible,
any future fallback must check that its stated quarter covers the observation
date, record its actual provenance and stop renewing it after expiry. Search
snippets are not used to generate published observations.

No proxy rotation, CAPTCHA handling, cookie harvesting, browser impersonation,
redirect following, authentication or disabled certificate validation is used.
403/429 responses are not automatically retried. A successful curl result is
evidence of this ordinary client's compatibility, not proof that the source will
remain available on every subsequent scheduled run.

## Fixture provenance and validation

Fixtures are reduced from actual downloaded content, not generated from headline
rates. `uob.html` retains the relevant table; `citi-layout.txt` retains extracted
table blocks, tier labels, print date and the two required numerical conditions.
SHA-256 values of the downloaded originals:

- UOB HTML: `7a2ec558c18cde35d329bd00fa45be81d9a5e4b232fb904bb29fad2c229d77a8`
- Citi PDF: `bac957c44611374259cd4f6032c50dd7af1a93763461343ce88769305b1f05d9`
- Maybank successful curl HTML: `1e00d0348d02c8c7829435b3676dbf13fe52e856f00af3f994469b092eae5ec3`

Local validation: 59 deterministic tests and TypeScript/Vite build pass. The
actual downloaded Citi PDF also passes the complete binary → Poppler → parser
path. Live GitHub results and snapshot publication are recorded in the PR.
