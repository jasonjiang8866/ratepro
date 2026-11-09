# SG Playwright collection experiment — 10 November 2026 (Singapore)

This read-only experiment continues Draft PR #19 from
`882102c2d4320f104a07cbfe78e37f901eaa96cd`. Main was rechecked at
`b673ac33623c14212435417c6baf48228e0d9ad9`; no competing open PR was present.

## Question and scope

Does a normal Playwright/Chromium navigation on GitHub Actions read the existing
[Maybank package page](https://www.maybank2u.com.sg/en/rates/rates-sora.page),
where ordinary curl repeatedly completed TLS but received no response bytes?
The HTML already contains the tables when accessible; this is a transport/client
experiment, not a presumption that Maybank requires JavaScript rendering.

The existing [CPF Board article](https://www.cpf.gov.sg/service/article/how-are-cpf-interest-rates-determined)
experiment is the rendering control. It previously passed in
[job 129298552445](https://github.com/jasonjiang8866/ratepro/actions/runs/42657143430/job/129298552445)
at `2026-11-09T16:41:06.512Z`, extracting the explicit HDB quarterly rate,
2026-10-01 through 2026-12-31, via rendered open shadow DOM.
That remains browser research, separate from the daily HTTP CPF-release fallback.
HDB and AskGov already returned explicit 403/challenge evidence; this experiment
does not try a browser to circumvent those denials.

## Implementation and boundaries

- `npm run research:maybank-browser`: one default headless Chromium navigation
  with a fresh nonpersistent context, 30-second navigation and 10-second DOM
  readiness budgets, a 60-second overall browser limit, no request retries.
- No custom user agent, stealth flags, proxy, credential/session import, CAPTCHA
  interaction, TLS changes, internal endpoint guessing or request replay.
  Page-owned public assets load normally. Denials (401/403/429), challenge headers,
  recognizable challenge resources/text and unexpected navigation stop extraction.
- Reuse the existing strict four-package parser. Fixed/floating stages, 1M/3M
  SORA spreads, lock-ins, minimums and applicability must all validate. Browser
  candidates have `method: browser`; absent publication/effective dates stay absent.
  A complete indicative table does not confirm unpublished discounts or approval.
- The shared rendered DOM reader excludes hidden tables, rows, cells and hidden
  descendant text, preventing hidden stale rates from satisfying the parser.
- Reports distinguish navigation failure, received HTTP status, rendering/field
  validation and validated candidates. UTC ISO times and bounded normalized DOM
  evidence hashes are recorded. No raw headers, cookies, IPs or request bodies.
- Only ignored `research-output/` files are written; both SG and JP feed hashes
  must remain equal. No schema/UI/collector-source change or new freshness claim.

`Read-only retrieval research` adds an independent Maybank browser job, using
the already pinned Playwright dependency, read-only permissions and seven-day
artifacts. It runs on relevant PR changes or manual dispatch and has no deploy
or commit step. Chromium installation dominates setup cost; a source probe is
bounded to one minute. A successful one-off read is not proof of long-term
reliability and does not enable a daily browser collector.

## Validation

`npm run test:browser` includes mocked-network Chromium cases for delayed JS
tables, hidden stale/missing fields, HTTP denial, a 200 challenge, redirect,
quote-only/app-shell responses and network failure. These tests do not contact
banks. Real-source reads are separate workflow steps.

Local browser installation failed because the supplied Chromium download was
not a valid ZIP. Consequently no local browser test/live success is claimed;
the ordinary test suite and build can run locally, and the read-only Actions
job is the actual Chromium verification path. Runner results will be recorded
below after completion; neither successful fixtures nor browser startup alone
count as collection recovery.

## First real Actions result

At `417f7a84e8e84cdccee7cc25b0b0a2d6307f1d60`,
[read-only run 42660640707](https://github.com/jasonjiang8866/ratepro/actions/runs/42660640707)
installed Chromium 156.0.8078.4 and passed all 16 browser-related tests (including
11 actual mocked-network Chromium cases). Maybank navigation failed before any
HTTP response at `2026-11-09T17:02:44.879Z`; no rates were extracted and both
feed files were unchanged. The first diagnostic regex truncated error codes
containing digits, so its `net::ERR_HTTP` is only a prefix, not a complete error
classification. This is fixed and regression-tested before the second probe.

CPF rendered successfully at `2026-11-09T17:02:49.208Z`, confirming the explicit
2.60% HDB quarter 2026-10-01 through 2026-12-31. The independent curl probe still
timed out after TLS (0.285286s) with zero response bytes over 30.002925s.
[Durable bounded evidence](playwright-sg-evidence-20261110.json) distinguishes
these results; no WAF or geographic root cause is inferred.

The first frontend workflow failed an existing real CLI integration test at the
default 5-second limit. Its three Node/tsx subprocesses take over 10 seconds in
this local environment. Only that test's limit is now 20 seconds, preserving all
assertions; no production timeout or collection policy changes. The SG/JP UI
workflow passed. HDB, stable and expanded source jobs passed; Maybank remained red.

Measured first-run job wall times (excluding queue): Maybank browser 41 seconds,
CPF browser 46 seconds; Chromium installation accounted for 22 and 20 seconds
respectively. The CPF live read took about 6 seconds. These are elapsed times,
not a billing estimate. The experiment adds no browser installation to the daily
collector or frontend production build.

## Corrected diagnosis and one protocol comparison

At `6f4e5c5034e1330f3295b04492a33f505dc2a021`,
[Maybank job 129312852841](https://github.com/jasonjiang8866/ratepro/actions/runs/42661181582/job/129312852841)
recorded **`net::ERR_HTTP2_PROTOCOL_ERROR`**, starting
`2026-11-09T17:09:24.414Z`, with no received HTTP response. No parser ran and both
feeds were unchanged. Its Chromium install was substantially slower than the
first job, but completed inside the five-minute job budget. CPF again passed;
all 17 browser-related tests, 165 ordinary tests/build, and SG/JP UI checks passed.

One separate `--http1` probe now tests Chromium's documented `--disable-http2`
switch, matching the existing curl HTTP/1.1 policy. The
[Chromium source](https://chromium.googlesource.com/chromium/src/+/HEAD/components/network_session_configurator/common/network_switch_list.h)
defines this protocol switch. This is not a TLS certificate bypass or a custom
identity. No denial was received on the default path. Each invocation still
makes one navigation and stops on denial/challenge; there is no automatic
protocol fallback or request retry. Reports include the actual browser arguments
and separate output directories. The default failed probe is now dispatch-only
(`probe_maybank_default: true`).

Research jobs now install only the headless shell used by their default launch,
using [Playwright's supported `--only-shell` option](https://playwright.dev/docs/browsers#chromium-headless-shell).
This skips an unused headed-browser download, not a different browser identity.
The local shell-only download also returned an invalid ZIP; all browser success
claims therefore still refer to Actions, not this local environment.
