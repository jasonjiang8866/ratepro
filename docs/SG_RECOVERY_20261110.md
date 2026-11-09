# SG collection recovery — 10 November 2026 (Singapore)

## Baseline and scope

Authoritative main: `b673ac33623c14212435417c6baf48228e0d9ad9` (PR #18).
No open PRs at inspection. No AGENTS.md exists in this repository tree.
SG has seven collector sources and one configured AskGov fallback. OCBC, HSBC
and UOB fixed-rate enquiries are reference links, not complete collected quotes.
JP has a separate feed/collector; its reviewed journal content is not collection
evidence. This change does not modify either published feed, country selection,
calculators, editorial records, secrets or daily schedules.

Latest scheduled SG run:
[42545472183](https://github.com/jasonjiang8866/ratepro/actions/runs/42545472183),
with feed time `2026-11-09T01:25:34.208Z` (09:25 Singapore).
The green job represents partial success, not all-source health.

| Source / official URL | Latest recorded collector success | Baseline Actions evidence | Live development check | Failure layer / priority / action |
| --- | --- | --- | --- | --- |
| [DBS HDB](https://www.dbs.com.sg/personal/loans/home-loans/hdb-loan) | 2026-11-09 01:25:34Z | Parsed in one attempt | Parsed | No failure; retain CPF-OA schedule semantics |
| [DBS Green](https://www.dbs.com.sg/personal/loans/home-loans/dbs-green-home-loan) | Same | Parsed in one attempt | Parsed | No failure; lock-in remains unknown |
| [SC SORA](https://www.sc.com/sg/borrow/mortgages/sora/) | Same | Parsed in one attempt | Parsed | No failure; preserve 2021-02-27 terms date, not a new promotion |
| [UOB SORA](https://www.uob.com.sg/personal/borrow/property-loans/about-sora.page) | Same | curl + parser succeeded | Parsed | No failure; fixed-rate enquiry is separate |
| [Citi PDF](https://www.citibank.com.sg/global_docs/pdf/Pricing-Packages.pdf) | Same | PDF + Poppler + four schedules succeeded | Parsed | No failure; property/purpose eligibility unconfirmed |
| [Maybank](https://www.maybank2u.com.sg/en/rates/rates-sora.page) | Not recorded | Two timeouts | Four complete schedules parsed | P1 transport; compare current runner timing, do not weaken parser |
| [HDB primary](https://www.hdb.gov.sg/managing-my-home/finances/loan-matters/interest-rate) | Not recorded | HTTP 403, one attempt | HTTP 403 | P1 access refusal; no retry/client switching |
| [CPF / AskGov](https://ask.gov.sg/cpf/questions/cm2s5b54c005r12kzrep7aayw) | Not recorded in published feed | HTTP 403, one attempt | Full quarter parsed | P1 runner access refusal; independent official announcement candidate |

The live development check used the unchanged collector at
`2026-11-09T16:15:40.564Z` (10 November 00:15 Singapore) and wrote only ignored
`source-check.json`. All seven product source groups succeeded, with HDB using
AskGov after the primary 403. This proves current pages can parse in that
environment; it does not prove GitHub access. No network-path changes were made.
The published HDB observation remains reviewed at `2026-10-30T01:50:00.000Z`;
the four Maybank observations remain reviewed at `2026-10-31T08:35:44.853Z`.
All five are over seven days old. A failed check must not advance those dates.

## First repair batch

- Add the independent [CPF quarterly announcement](https://www.cpf.gov.sg/member/infohub/news/news-releases/government-extends-4-per-cent-interest-rate-floor-on-special-medisave-and-retirement-account-monies-until-31-december-2027)
  after HDB and AskGov fail. This is a public HTML publication, not a guessed API
  or another client used against either denied endpoint. It was read directly
  with Node fetch (HTTP 200) in this development session.
- Validate its exact title, government/CPF branding, publication date, explicit
  HDB rate in both summary and prose, explicit OA rate, matching periods and
  OA + published 0.10% relationship. Reuse the strict calendar-quarter validator.
  No missing HDB rate is computed from OA; empty JS shells and changed content fail.
- The announcement was published on 22 September 2026. The **HDB period ends
  31 December 2026**, regardless of the 2027 SMRA policy in the title. The collector
  stops requesting this dated fallback at `2026-12-31T16:00:00Z`. A later quarter
  requires a separately verified official publication and config/parser review.
- Preserve HDB primary and AskGov failure evidence independently. Optional
  `fallbackFailures` and the `cpf-release` provenance extend v1 while accepting
  existing v1 feeds/caches. New exports require the updated reader. UI links to
  the actual evidence and displays the source publication date separately.
- Re-run Maybank's existing bounded timing diagnostic in read-only source CI.
  It records DNS/TCP/TLS/first-byte milestones without guessing the timeout cause.
- Fix the existing JP homepage regression test's uncontrolled dependence on the
  growing content corpus. Its test now isolates the SG deadline with the original
  JP fixture. This is necessary because the daily SG job runs all tests before
  collection. Product behavior and editorial content are unchanged.

## Fixture provenance

`tests/fixtures/cpf-release.html` is reduced from the full official HTML read in
this session. It preserves the original relevant text blocks, heading and publisher
context. Original SHA-256:
`f535c09959e67d37cd3a906ca63a99663276b341b672e4828381961d879239e6`.
The complete downloaded document also passed the new parser. This is not a
search-snippet fixture. OA/SMRA statistics elsewhere in the document are not
substituted for HDB mortgage terms.

## Validation boundaries

Deterministic checks cover missing/conflicting fields, duplicate documents,
wrong publisher/date, expired/future quarter, fallback switching, non-retried
403s, retained observations and retained last-success timestamps. Build validates
TypeScript and all existing editorial content. The browser-only research test
remains opt-in and is not claimed by the unit suite.

GitHub source-health results and final counts are recorded below. No production refresh workflow is dispatched and no deployment
is performed. PR source checks have read-only repository permissions. Partial
success and unresolved source failures must remain distinct in the final report.

## Verified GitHub results

Implementation SHA: `11c150b6cfe2b445f1469dbbffe67692149daf88`.
[Draft PR #19](https://github.com/jasonjiang8866/ratepro/pull/19).
Machine-readable, bounded evidence is retained in
[sg-recovery-evidence-20261110.json](sg-recovery-evidence-20261110.json).

| Validation | Observed outcome |
| --- | --- |
| [Frontend checks](https://github.com/jasonjiang8866/ratepro/actions/runs/42654083651) | 150 tests passed; 1 opt-in browser research test skipped; content/TypeScript/Vite build passed with default CI test timeout |
| [Homepage UI](https://github.com/jasonjiang8866/ratepro/actions/runs/42654083762) | Existing SG/JP Playwright regression passed |
| [HDB real collector](https://github.com/jasonjiang8866/ratepro/actions/runs/42654083728/job/129287787865) | Passed; HDB 403, AskGov 403 with `cf-mitigated: challenge`, CPF announcement 200 and strict parsing succeeded |
| Stable group | DBS HDB, DBS Green and SC all parsed successfully in one attempt |
| Expanded group | UOB and Citi parsed successfully in one attempt |
| [Maybank collector](https://github.com/jasonjiang8866/ratepro/actions/runs/42654083728/job/129287788002) | Failed after two bounded timeouts; prior data retained |
| [Maybank timing](https://github.com/jasonjiang8866/ratepro/actions/runs/42654083728/job/129287787627) | DNS 0.082509s; connection 0.090155s; TLS 0.103023s; no first byte; timeout 30.002789s, HTTP code 0, downloaded bytes 0 |
| Published data / production deployment | Neither changed nor triggered by this work |

HDB's validation artifact now contains `method: collector`, `evidenceSourceId:
cpf-release`, HDB 2.60%, quarter 2026-10-01–2026-12-31 and publication date
2026-09-22. Its observation time is `2026-11-09T16:22:37.561Z` (10 November
00:22 Singapore), replacing the reviewed 30 October observation **inside the
validation artifact only**. Other offers are unchanged in the HDB group.
The separate CPF service article still returned an empty JS shell; its HTTP 200
is not counted as successful mortgage collection. No browser dependency was
added to the daily collector.

The whole source workflow correctly remains red because Maybank is unresolved.
Its timing establishes a stall after TLS, not a WAF rule, geography restriction,
DNS failure or a parser defect. No reliable independent Maybank automated
fallback was verified. Keep its four old observations marked reviewed/stale;
restoration needs a successful same-policy Actions read or a verified official
export/publication covering those exact products, stages and conditions.

Local validation also passed 150 tests with 1 skipped using
`npm test -- --maxWorkers=2 --testTimeout=15000`. The existing review-file CLI
integration test exceeded its default 5s timeout under local contention; it
passed without timeout changes on GitHub. Both local builds passed. The existing
Vite >500kB chunk warning remains outside this batch.

Remaining risks: this is one real runner success for a dated announcement, not
long-term availability evidence. Inspect the next authorized scheduled collection
after merge; replace the dated fallback before the next quarter only after
verifying a new official document. This PR deliberately carries no refreshed
production feed and makes no production recovery or deployment claim.
