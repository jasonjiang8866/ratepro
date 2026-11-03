# RatePro editorial publishing contract

The journal and the rate directory are separate. Editorial research **never**
changes `public/data/rates.json`, collector results or source observation times.
A successful report, build or preview does not demonstrate collector recovery.

## Automated research → reviewed content → website

The ChatGPT task researches public official sources. It reads the latest GitHub
`main`, open content PRs, this policy and `src/lib/editorial.ts` before writing.
It may add/edit JSON in `content/insights/` and `content/promotions/` only. No
hand-maintained index is necessary: Vite discovers these files during the build.
It must not modify application code, workflows, credentials, this contract or rate
observations. If this contract is not yet on main, return the report draft in the
task conversation and explain that repository integration is pending.

Create/update a **draft PR** from the latest GitHub main; never merge, push main
or deploy. Do not rebuild or force-push old local Git history. Check existing
files/open PRs before creating another report. A scheduled run alone is not a
reason to publish: weekdays need a material development; Monday may synthesise
the week. The first record must say it is a baseline, not a new launch.

The scheduled task created Draft PR #6 on 3 November 2026, verifying the SG research-to-PR path. Japan execution still needs its first actual scheduled run. If access fails, return complete JSON drafts
and an accurate failure description in the task conversation. Do not claim that
files were committed. Once a content PR is reviewed and merged, the existing
Cloudflare Git integration builds the site. The homepage displays the latest
market report and up to three most recent package records, including explicit
age/expiry warnings; all reports remain accessible in the reading room.

## JSON format (version 1)

Supported research markets are listed in `config/markets.json` (currently SG and JP). The executable schema is `src/lib/editorial.ts`. See the three initial files for
complete examples. New records must explicitly include `market: "SG"` or `market: "JP"`. Legacy version-1 records without a market decode as SG, including existing content PRs. Other fields are required, including explicit `null` values.
Unknown keys are rejected. Filename must be `<slug>.json` with lowercase kebab
case. Use `content/insights/` for `market` and `guide`, `content/promotions/` for
`package`. No Markdown, HTML, JSX, executable content or arbitrary embedded links.
React renders text; source URLs are HTTPS only, without credentials.

| Field                             | Meaning                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `market`                          | ISO country code from `config/markets.json`; SG or JP                                                                           |
| `schemaVersion`                   | Always `1`                                                                                                                      |
| `slug`                            | Unique stable reader URL, `/?market=JP#/read/<slug>` (use the record’s market; old SG links remain valid)                       |
| `category`                        | `market`, `guide`, or `package`                                                                                                 |
| `title`, `summary`                | Plain English; title ≤120 characters, summary ≤260                                                                              |
| `reportDate`                      | Market-local calendar day the report was written (SG: Asia/Singapore; JP: Asia/Tokyo), not a source observation or offer launch |
| `edition`                         | `baseline`, `update`, `weekly`, or `guide`                                                                                      |
| `eventKey`                        | Underlying event/package-and-period key, unique within each market; retain when revising the same record                        |
| `supersedes`                      | Earlier report slug for a substantive correction, otherwise null                                                                |
| `effectiveFrom`, `effectiveUntil` | Explicitly stated coverage period, YYYY-MM-DD or null; do not infer from a page update                                          |
| `takeaways`                       | 1–3 objects `{text, sourceIds}`                                                                                                 |
| `sections`                        | 1–12 objects `{heading, kind, text, sourceIds}`; `kind` is `fact` or `analysis`                                                 |
| `sources`                         | Objects `{id, publisher, title, url, checkedAt, documentDate}`                                                                  |
| `package`                         | Null except package reports, which require the object below                                                                     |

`checkedAt` is when the **actual official source content** was successfully read,
UTC ISO timestamp with Z. Search snippets, build dates and a bank's page-update
date do not count. `documentDate` is the source's stated document/publication or
update date; keep it null if absent and explain ambiguity. It is distinct from
an offer's effective period. Each takeaway, section and package object must cite
existing source IDs. Analysis is visibly labelled as interpretation, with the
underlying evidence linked; it must not present speculation as a published fact.

Package objects require `lender`, `eligibility`, `conditions`, `expiry` and
`sourceIds`. `expiry` is a stated application/offer deadline or null, not the date
a source was checked. A null deadline is displayed as unknown, never evergreen.
Include loan size, borrower/property scope, full stage schedule when reporting a
rate, commitment, charges/concessions and their conditions where published. If
not established, state the gap; do not assume eligibility or fill in a fixing.
A SORA spread is not an all-in mortgage rate. “Up to” rewards need qualifying
terms and exclusions before they may be presented as a verified promotion.

Use official MAS, CPF, HDB, government, bank publications and their linked terms.
Broker/comparison pages can be leads only. Do not bypass denials, rotate IPs,
spoof clients, invent quotes or infer a promotion from a search headline. Source
URLs/publisher claims are reviewed by a human: schema validation checks structure,
not truth or official ownership. Never silently change the allowlist/schema to
accommodate an unverified source. Keep paraphrases brief and respect source usage
and copyright limits; do not copy entire publications.

## Dates, corrections and deduplication

Build checks reject impossible/future report dates, checks in the future or after
the report day, documents dated after the check, inverted periods, dangling
citations, duplicate slugs/events/source URLs and invalid correction references.
An announced future effective period is allowed and labelled upcoming.

A report's oldest cited source check controls the seven-day recheck warning.
Published expiry/period ends are inclusive market-local dates. Once they pass, the
report says “Period ended”; it is retained as history, not advertised as currently
available. Recheck warnings are computed in the browser as time advances, even
without a new deployment. A visitor's inaccurate clock can affect warnings but
cannot prevent the page loading. Nothing says “active” merely because it is recent.

Correct typos in place. For substantive factual corrections, publish a new event
key/slug and set `supersedes` to the older record, explaining the correction in
the text. The earlier report must belong to the same market and have an earlier report date. For a same-day
correction, update the existing report with an explicit correction section;
do not silently erase the material correction. Avoid publishing identical facts
under a new title on every run. Human review compares open PRs and prior editions;
semantic duplicates cannot be completely prevented by unique keys.

## Validation and review

```sh
npm ci
npm run check:content
npm test
npm run build
# For frontend changes:
npx playwright install --with-deps chromium
npm run test:ui
```

The build validates content before bundling, including on Cloudflare. GitHub UI
checks exercise the built site with external bank requests blocked deliberately;
these are interface tests, not live retrieval checks. Screenshots cover desktop,
mobile, light/dark and an article. Confirm cited claims against their sources,
verify date meanings, read mobile layouts, and inspect the diff before merging.
`git diff -- public/data/rates.json` must remain empty for editorial-only work.

This is a static SPA using shareable hash URLs and browser Back/Forward. Article
metadata is visible to readers; individual pre-rendered SEO pages and a SORA
history feed are outside this first release. No synthetic trend chart is shown.

## Japan coverage and research requirements

Use Japanese official sources first: BOJ for monetary policy; JHF/Flat35 for housing
finance; MLIT and official statistics for housing; lenders for actual offers and
complete terms. Retain original Japanese titles where useful and write the website
body in English. Chinese completion messages are for the owner, not article text.

Separate variable (変動金利), initial fixed-period (固定期間選択型), and full-term
fixed (全期間固定) products. Record JPY amounts, funding/application month, LTV,
borrower residency/nationality requirements, owner occupancy vs investment use,
loan term, group credit life insurance (団信), fees/guarantee charges, discount
qualifications, reset schedule and early-repayment terms where verified. Do not
assume five-year/125% rules apply to every lender or cap interest. Do not import
SG eligibility, CPF/HDB, SORA, lock-in semantics or SGD into Japanese records.
BOJ decisions, market benchmarks and borrower mortgage rates are different facts.
Never substitute an advertised rate for an all-in cost or guaranteed approval.

Japan starts with reviewed research and a generic yen scenario calculator. The
Japanese explorer reads package content automatically; it is not connected to the
SG rate feed and has no automated bank collector. No unverified quote may be added
to a ranking. A baseline condition summary may explicitly leave unverified lender
fees/limits unknown. A confirmed promotion requires the full qualifying terms.
Monthly illustrations expire on the last day of that stated month in Japan, even
when no campaign application deadline is published.

New JP slugs/event keys should begin `jp-`; SG legacy names remain stable. Slugs are
still globally unique. Keep reports separate by country, including weekly reports.
Country configuration is read-only for the scheduled task. Until multi-market
schema support is on main, return Japanese research as a conversation draft; never
write Japan content into a legacy SG-only record or change application code.
