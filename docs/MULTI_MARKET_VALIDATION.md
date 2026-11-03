# SG / JP editions — validation, 3 November 2026

Base: `972467049daef86d3535485d236f1b680d3339b9` (main at implementation start).
Branch: `feat/multi-market-japan`.

Implemented country selection with SG/JP branding, separate editorial feeds,
market-local validity dates, stable share links, Japanese official-source baseline
content, a source directory and an illustrative JPY calculator. Existing SG
observations and their browser cache retain their existing schema and identity.
Missing editorial market fields default to SG for compatibility with open PR #6.

## Executed checks

- `npm test`: 101 passed; one optional CPF live-browser test skipped.
- `npm run build`: six editorial records validated; TypeScript and Vite passed.
- `git diff --check`: passed.
- `public/data/rates.json`: no diff against base.
- Cloud-browser desktop inspection: SG/JP selector and branding, isolated journal
  content, article refresh, Back/Forward across a country switch, return to the
  original SG directory (13 offers), JPY scenario output and light/dark themes.
- Local screenshot: [Japan homepage](screenshots/japan-edition-20261103.jpg).

`npm run test:ui` was extended for both markets, currency, deep-link preservation,
blocked cross-market article access, Singapore-feed isolation, 320/390px layouts
and screenshots. This full automation has **not yet run**: GitHub CI requires a
successful feature-branch push. Do not describe mobile or CI as passed yet.

## Editorial scope

Initial Japan records are a rate-structure explainer, Flat35 eligibility guide and
November Flat35 illustration with discount assumptions and full-stage context.
They are reviewed research, not an automatic Japanese bank-rate feed, lender
approval or market-wide rate ranking. Generic JPY calculations do not model
variable-rate payment caps, staged discounts, fees or insurance.

Official pages were read using web retrieval on 3 November; URLs and individual
check timestamps are in each JSON record. An unclear publication date stays null.
The November illustration has a month-end coverage boundary in Asia/Tokyo; its
application deadline remains unknown. Current source access does not prove a
future collector will work.

## Task configuration

Existing automation `6ae8a7a19d648191ad17af3e19ef8bc4` was updated successfully to
“RatePro 房贷市场观察 · SG / JP”. The daily 10:00 Asia/Singapore schedule and Draft PR
review requirement remain. It researches each country separately and reads the
repository country configuration. While main lacks this multi-market schema,
Japan output must remain a reviewable conversation draft. No scheduled JP run has
been verified yet.

## Delivery workflow

The owner explicitly authorized feature-branch push, PR creation, and browser-based
merge to main after checks pass on 3 November 2026. The earlier automatic approval
block is resolved by that authorization. Current CI and deployment status are
recorded on the pull request; a local build alone does not verify deployment.
