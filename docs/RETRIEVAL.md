# Official retrieval investigation

## Follow-up: supported access and denial diagnostics — 1 November 2026

PR #4 was rechecked against GitHub at `8c2230d`; it remained a draft on
`feat/hdb-askgov-fallback`, based on `1ce8e90`. A fresh clone matched that HEAD.
The earlier local reconstructed history was not used.

### What official documentation establishes

- The [AskGov help centre](https://ask.gov.sg/help) documents agency administration,
  [widget integration](https://ask.gov.sg/help/questions/cmeb54o2q00t98tmo9zv8au0w)
  and [iframe embedding](https://ask.gov.sg/help/questions/cm8crry7500cl12j6dg71xame).
  These display integrations do not document a supported server-side content export API.
- [OGP's old AskGov repository](https://github.com/opengovsg/askgovsg) was archived
  on 24 July 2024. Its README API base is `localhost:6174/api/v1`; this is local
  development documentation, not a current production API contract. No guessed
  API route or internal widget endpoint is requested.
- [AskGov terms](https://ask.gov.sg/terms), clause 3, restrict the granted use and
  redistribution. Public readability is not evidence of permission for this
  public directory's automated reuse. Clarify the intended use with the operator
  and CPF before enabling publication; no legal conclusion or permission is assumed.
- The [CPF Board article](https://www.cpf.gov.sg/service/article/how-are-cpf-interest-rates-determined)
  independently publishes the explicit HDB/OA quarter and rates. It is a candidate
  official source, not an enabled third fallback. The existing
  [quarterly press release](https://www.cpf.gov.sg/member/infohub/news/news-releases/government-extends-4-per-cent-interest-rate-floor-on-special-medisave-and-retirement-account-monies-until-31-december-2027)
  is another dated official publication. Both need current-period validation and
  direct runner availability before any implementation can renew an observation.
- [data.gov.sg](https://guide.data.gov.sg/developer-guide/api-overview) has documented
  public dataset APIs. This investigation did not identify a dataset containing
  the current explicit HDB concessionary quarter. A general API or historical
  bank-interest dataset does not establish a usable replacement.

### Reproducible, read-only diagnosis

`npm run verify:sources -- hdb` now writes `hdb-diagnostics.json` using the exact
collector requests. It records Node version, timestamps, elapsed times, HTTP
statuses, a small allowlist of response headers (including support correlation
IDs when supplied), and hashes/known denial markers from at most 8 KiB of an error
body. It never logs cookies, raw response bodies or environment credentials.
Successful response bodies and request options are unchanged. A failed diagnostic
body read must not erase the original status. Headers/markers can identify a
response layer, but do not prove a particular WAF rule, IP/geographic restriction,
or origin policy. The runner and development environment are not controlled
network equivalents; the recorded Node versions can also differ.

`npm run verify:sources -- hdb --probe-cpf` additionally makes exactly one ordinary
GET to the independent CPF article. The source-health HDB job uses this research
option and uploads the diagnostics separately. The candidate never enters
`collect()`, never creates an offer, and cannot make a failed HDB health check pass.
Even a candidate HTTP 200 is only a transport observation, not validated rate data.
No retry, client impersonation, redirect following, proxy/IP change, private API
or browser automation is added. Diagnostic files are ignored by Git and retained
as Actions artifacts for seven days. The production daily collector does not run
this probe.

### New live evidence at `81d606d`

[GitHub HDB job](https://github.com/jasonjiang8866/ratepro/actions/runs/41272305170/job/124747404252)
at 04:14 UTC / 12:14 Singapore time on 1 November recorded:

| Endpoint          | Development (Node 24.22.1)           | GitHub (Node 22.23.4, Azure eastus)                       | Supported conclusion                                                                                                   |
| ----------------- | ------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| HDB primary       | 403                                  | 403, `server: AmazonS3`, `x-cache: Error from cloudfront` | Same 4,760-byte denial body SHA-256 in both environments; cause still unproven                                         |
| CPF / AskGov      | 200; existing strict parser succeeds | 403, `server: cloudflare`, `cf-mitigated: challenge`      | The runner received a Cloudflare Challenge Page; the triggering rule is unknown                                        |
| CPF Board article | 200                                  | 200                                                       | Identical 66,490-byte HTML hash, but inspection finds an empty `webruntime-app` body, no tables and no quarter heading |

Cloudflare's [official response-header documentation](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/)
identifies `cf-mitigated: challenge` as a Challenge Page response. This establishes
more than a generic 403, but does not identify IP reputation, geographic policy,
Bot Management, a custom WAF rule, or any particular challenge type. Only the
operator's logs can distinguish those. The development responses report
`server: envoy`; they are not evidence of an equivalent direct network path. No
network configuration was changed. A different Node version is another uncontrolled
variable, not a demonstrated fix. Do not change clients to get past the challenge.

AskGov support correlation: `cf-ray: a5381309cd507af9-IAD`,
request time `2026-11-01T04:14:44.707Z`.
The CPF article's downloaded HTML SHA-256 in both environments was
`3ac0d7cc2bc6cb6d944c9c17577a23757e0805af3a69f765b2daeeb4a441f2d1`.
A search engine's rendered article can show the quarter while the GET returns
only a JavaScript application shell. The probe now records body text length,
table count and presence of the quarter heading, so this distinction is visible
in Actions without saving the page or manufacturing a publisher/observation.
The generic HTML parser removes scripts; no rate table is hidden in the raw HTML.

The HDB source-health job correctly remained **failed**, and its generated feed
retained all 13 offers exactly, including HDB's `2026-10-30T01:50:00.000Z`
observation. `public/data/rates.json` was not modified. Neither the CPF HTTP 200
nor the green frontend build is a recovered collection.

### Practical remaining routes

1. AskGov: request confirmation of supported server-side read/export access and
   intended reuse from the operator/CPF, supplying the Ray ID and timestamp above.
   The public help material documents display widgets rather than a content API;
   no hidden endpoint or challenge-solving flow has been tried.
2. CPF article: a future experiment could render the ordinary public page with
   JavaScript on the same runner, stopping on any access challenge; or preferably
   consume an officially documented export. This would need separate dependency,
   access-policy and whole-page validation work. A rendered-page success must
   still pass the full-quarter, publisher and HDB/OA checks. It is not implemented
   as a production fallback in this PR. [CPF terms](https://www.cpf.gov.sg/member/terms-of-use)
   distinguish non-commercial informational use from commercial reuse and restrict
   automated commercial copying; do not describe the page as a supported open API
   or assume commercial publication permission from an HTTP 200.
3. Until one route is validated, retain the reviewed snapshot and its expiry;
   a human can make a new dated review of the official quarterly publication.
   An observation should be renewed only by that actual review, never by this probe.

### Confirmed fixes and next decisions

A regression test reproduced a real cleanup bug: if `body.cancel()` rejected on
an HTTP 403, `fetchBytes()` classified it as a retryable network failure, losing
the known denial. Cleanup is now best-effort so the HTTP status (or size rejection)
remains authoritative. This bug is **not established as the cause of the earlier
403s**, and fixing it does not restore access. The CPF publisher match also now
requires a word boundary, rejecting a different name that merely starts with CPF.

If denials persist, retain the draft and original snapshot. Ask the AskGov operator
(via its help centre contact channel) and CPF to confirm an approved low-volume
read/export method and reuse terms. Provide the exact URLs, UTC attempt times,
Node version, method/options, status and supplied correlation IDs from the artifact;
ask them to check their server logs. Do not request a different network path to
circumvent a denial. No message has been sent by this project.

Only install another source after permission/access and strict parsing are
established; preserve actual evidence provenance, full quarter and successful
retrieval time. Otherwise use a separately dated human review of the official
publication, keeping `method: reviewed`, or retain the old observation and expiry
warning. Never use search snippets or page-update/snapshot timestamps as observations.

## HDB AskGov fallback — 1 November 2026

The HDB primary returned 403 in the scheduled run on 1 November. The independently
published [CPF answer on AskGov](https://ask.gov.sg/cpf/questions/cm2s5b54c005r12kzrep7aayw)
explicitly gives the HDB mortgage rate and CPF OA rate for 1 October–31 December 2026. It is maintained by CPF, not an answer authored by HDB or an AI-generated rate.

Browser inspection, standard Node fetch (HTTP 200, approximately 11.5 seconds) and
curl (HTTP 200, approximately 9.7 seconds) succeeded in the development environment.
The original HTML contains the table; JavaScript rendering and private APIs are
unnecessary. Its SHA-256 was
`3f5730d3f51050925722f5613a12272477ac7af76d3defe61d97dd428a1492d2`.
The reduced fixture keeps the relevant factual table, title and publisher context.

The collector tries HDB first. Only a failure invokes this one allowlisted official
fallback, with its own 30-second budget and at most one transient retry. An HDB 403
is not retried. The parser requires one explicit complete calendar quarter,
matching HDB/OA table periods, a published numerical HDB rate and the consistent
OA + 0.10% relationship. It does not calculate an absent HDB rate from another row.
Missing, ambiguous, future or expired content fails closed. Quarter boundaries use
Singapore time in both primary and fallback parsers.

The product ID remains `hdb-concessionary`; fallback provenance uses
`evidenceSourceId: cpf-askgov`. The rate card links to the evidence actually used.
Source status records `fallbackSourceId` plus the original `primaryFailure`, so a
successful fallback never claims the HDB primary recovered. Top-level `attempts`
counts fallback attempts when present; `primaryFailure.attempts` counts primary
attempts. These are separate endpoint budgets, not a combined retry count.

`observedAt` records the successful collection's observation time. The stated
quarter is stored in `effectiveFrom`/`effectiveUntil`. Neither the relative
“Updated … ago” label nor snapshot generation becomes an observation date. If
both sources fail, prior values, provenance and dates remain unchanged. Returning
to the primary clears fallback provenance without creating a fictitious rate change.
The browser continues to consume the same-origin snapshot; it does not call AskGov.

Validation: unit tests and a separate read-only `hdb` GitHub Actions source-health
job cover this chain. Live GitHub results are recorded in the pull request; local
HTTP success alone is not evidence of GitHub availability or production deployment.

## Earlier findings — 31 October 2026

The following records describe the investigation before the AskGov fallback.

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
actual downloaded Citi PDF also passes the complete binary → Poppler → parser path.

## Live GitHub outcomes

- [Initial check](https://github.com/jasonjiang8866/ratepro/actions/runs/41196486335):
  Citi PDF succeeded. UOB returned HTTP 500 with Node. Maybank curl failed.
- [Transport diagnosis](https://github.com/jasonjiang8866/ratepro/actions/runs/41196680968):
  UOB succeeded with standard curl and Citi succeeded again. Maybank's explicit
  curl exit code was 92, an HTTP/2 stream error per
  [curl's error reference](https://curl.se/libcurl/c/libcurl-errors.html).
- [HTTP/1.1 test](https://github.com/jasonjiang8866/ratepro/actions/runs/41196819156):
  DBS, SC, UOB and Citi succeeded. Maybank was tested with curl's documented
  `--http1.1` option while retaining HTTPS certificate verification. It timed out
  twice instead of returning the HTTP/2 error. **Maybank is not fixed**; its
  experimental check remains failed. No further network-path or fingerprint
  changes are attempted. The Node CMS 500 cause remains unproven.

The 13-observation snapshot takes successful bank observations from the third
run. Maybank retains all four reviewed observations and their original timestamps;
HDB retains its reviewed quarter. Its snapshot generation timestamp is only when
these records were assembled, never a substitute for bank observation dates.
Cloudflare branch preview and browser comparison show Citi tier requirements,
exclusive loan-band upper limits and floor rates without inventing a SORA fixing.

For Maybank/HDB, the remaining durable routes are a bank-authorised feed/export,
an explicitly permitted API, or a dated manual review of the official publication.
No such API has been verified here. A maintained snapshot with expiry warnings is
the current fallback; repeated forbidden requests or search snippets are not a fix.
