# SG coverage and retrieval work — 14 November 2026

## Baseline and scope

Main was re-read at `f2e4351fbedaf0401d8396d69e5f2da99cad9f4c`; there were no open
PRs. The 01:25 UTC daily snapshot contained 13 products from seven source URLs.
Six sources succeeded. HDB's primary and AskGov URLs returned 403, but the dated
CPF quarterly announcement recovered the explicit current-quarter rate. Maybank
failed twice with a timeout and retained its 31 October observations.

The scheduled workflow's success therefore did not mean all-source success.
Previous browser experiments already demonstrated an HTTP/2 protocol error and an
HTTP/1.1 timeout for Maybank on the Ubuntu x64 Actions runner. Repeating the same
browser setup is not a new recovery method.

## Implemented expansion: 13 → 21 products, seven → eight sources

| Source | Before | After | Added coverage |
| --- | ---: | ---: | --- |
| Citi | 4 | 9 | Two-year fixed schedules for both tiers and both loan bands; one Citigold BUC floating schedule |
| SBI Singapore | 0 | 3 | Two-year and three-year floating lock-in; two-year fixed |
| Other sources | 9 | 9 | Existing supported groups retained |

Official publications:

- Citi: https://www.citibank.com.sg/global_docs/pdf/Pricing-Packages.pdf
- SBI: https://sg.statebank/en/home-loans
- Maybank: https://www.maybank2u.com.sg/en/rates/rates-sora.page

The actual PDF bytes were downloaded on November 14 and extracted with Poppler.
The print date remains September 30; it is not rewritten as today's effective
date. Fixed years and subsequent SORA spreads, tier, floor, loan bands and AUM
conditions remain separate. The fixed table does not expressly state construction
eligibility: the UI now supports **Confirm with lender**, excludes these records
from specific construction filters and withholds automatic repayment estimates.
The BUC row explicitly states no lock-in; progressive drawdowns are not modelled.

SBI's original HTML provides three complete tables and explicit eligibility.
The downloaded fixed table says **2.25%**, while search-index text returned 2.00%.
Only directly retrieved HTML feeds the parser and fixture; search results never
supply financial values. General minimum loan is S$250,000; the fixed table has
its own S$400,000 minimum. Only the three-year floating package allows BUC.

`tests/fixtures/sbi.html` retains the original product, eligibility and rates tabs,
including commented historical columns, while omitting navigation and scripts.
Tests ensure commented columns cannot become rates, missing/duplicate rows or
changed tenor/eligibility fail closed, and price changes are actually parsed.
The existing Citi fixture is a reduced layout extract; the live PDF is tested
separately. A failed group cannot update any of its offers. Regressed document
dates and incomplete supported groups are rejected.

## Failure handling and observability

- Daily collection writes ignored `source-check.json` diagnostics before deciding
  whether to publish, and uploads them even on failure.
- The Actions summary separates healthy-source count, supported/available products,
  retained stale products and fallback endpoint. Partial failure emits a warning;
  it does not pretend every source refreshed or discard useful successful reads.
- Total failure no longer overwrites the local snapshot before exiting nonzero.
  A regression test verifies exact byte preservation and the partial-success
  atomic-write path.
- HDB continues using its working official fallback. The known CPF announcement
  ends on December 31, 2026; a future quarterly publication still needs verification.

## Maybank: separate local access from runner recovery

An ordinary local `curl --http1.1` download succeeded on November 14 at approximately
11:59 UTC. The unchanged strict parser extracted all four existing products.
This establishes that the reviewed HTML layout remains usable; it does **not**
establish sustained GitHub runner access or prove why a different environment
fails. No proxy service, browser identity spoofing, cookies or TLS override was added.

This PR adds bounded, read-only comparisons on standard Ubuntu ARM and Windows
Actions runners, using the same allowlisted URL, timeout and existing collector.
The existing x64 job remains the control. Failures remain nonzero, and these jobs
cannot publish or deploy. A daily runner change requires observed successful
extraction; results are recorded below when available.

If these runner comparisons also fail, keep Maybank's last-known observations
and use the existing `review:file prepare` workflow with a freshly obtained
original official HTML file. A candidate is not an automatic-recovery claim or a
human approval. Repeated browser retries on the same failing route have no new
justification. An independently maintained official publication or an explicitly
configured runner with ordinary access would be the next durable route.

## Other lenders investigated

OCBC's current home-loan page still describes fixed/SORA options without a complete
numerical schedule. CIMB describes eligibility and minimum loan but not a full
rate schedule; HSBC has conditional headline pricing. These remain quote-required
research links, outside product counts. BOC similarly describes packages without
a complete current schedule. Hong Leong Finance exposes a table but has differing
headline/table rates and a dated publication; it warrants a separate parser and
terms review. No broker rates or guessed all-in SORA values were imported.

## Verification

Local full suite: 174 passed, 12 browser-only cases skipped. TypeScript and the
production build passed. The existing bundle-size warning remains.
The real `verify:sources -- expanded` run extracted SBI (3) and Citi (9); UOB timed
out locally and retained its prior observation, so that integration run correctly
exited nonzero. The staged snapshot includes all 21 products and records this
UOB failure, with unattempted source statuses retained. GitHub runner results are
reported separately; local network results are not relabelled as runner success.

Raw download SHA-256 values (temporary original files, not copied into fixtures):

- Citi PDF: `bac957c44611374259cd4f6032c50dd7af1a93763461343ce88769305b1f05d9`
- SBI HTML: `b43b64cfcf18dcb25213e65b9d47d11a47f11218ceee4ca351a69e627348173c`
- Maybank HTML: `686e7b5281eeabf582064697dfedfec69001e7c308c15f9811463c5f0f4ff70b`
