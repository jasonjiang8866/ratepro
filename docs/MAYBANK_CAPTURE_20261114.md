# Maybank: verified local capture and remaining automation blocker

PR #24 starts from main `e51fe62fbdd17633570ef26a6d5692798cd85dfe`.
The existing four-product parser works on a complete official page. The unresolved
issue is the request from GitHub runners, before any response body reaches it.

## New live comparisons

All requests used the canonical [official package page](https://www.maybank2u.com.sg/en/rates/rates-sora.page), one GET, 30 seconds, a 2 MB body limit, HTTPS certificate/hostname checks and no redirect following.

| Environment / request | TLS completed | Response bytes | Result |
| --- | --- | --- | --- |
| GitHub macOS 15 ARM, ordinary HTTP/1.1 | 0.059 s | 0 | 30 s timeout |
| GitHub Ubuntu 24.04, HTTP/1.1 + TLS 1.2 | 0.304 s | 0 | 30 s timeout |
| GitHub Ubuntu 24.04, HTTP/1.1, truthful RatePro user agent and `Accept: text/html` | 0.078 s | 0 | 30 s timeout |
| Development environment, ordinary HTTP/1.1 | completed | 27,808 | HTTP 200; all four schedules validated |

Runner evidence: [OS/TLS comparison](https://github.com/jasonjiang8866/ratepro/actions/runs/43608549466), [identified request](https://github.com/jasonjiang8866/ratepro/actions/runs/43608823551).
[Sanitized durable reports](maybank-transport-evidence-20261114.json) preserve exact timings and UTC dates.
The identified request declared `RatePro/1.0 (+https://github.com/jasonjiang8866/ratepro)`; it did not impersonate a browser. TLS 1.2 was a compatibility comparison, not disabled verification.

Together with the preceding Linux x64/ARM, Windows and Chromium tests, these results
show environment-dependent transport failure. They do not establish a geographic
block, WAF rule, bank policy or a parser defect. No response denial/challenge was
received in these three requests. Further automatic parameter experiments are not
enabled. The comparison workflow is now manual-dispatch only; failures remain failures.
No experimental request option is installed in the daily collector.

## Usable fallback: capture a fresh page directly

From an up-to-date checkout in an environment with ordinary permitted access:

```sh
npm ci
npm run capture:maybank
```

The command makes one ordinary curl HTTP/1.1 request and creates a new directory
under `research-output/maybank-capture-*` containing:

- `official.html`: exact successful response bytes;
- `transport.json`: sanitized timings and parser results;
- `evidence.json`: original URL, actual UTC capture time, original/base/candidate
  hashes and every before/after field for all four products;
- `rates.json`: complete candidate feed, preserving every other product and all
  scheduled collection statuses.

There are no URL, saved-file or observation-date overrides. The command requires
HTTP 200 and four complete schedules, reparses the original bytes, checks product
IDs and hashes, rejects observations that are stale/future or not newer than the
retained group, and detects a base snapshot changed during capture. Timeouts,
denials and malformed/partial documents create no candidate. Each successful
attempt has a unique output directory, so a failure cannot be confused with a
previous successful file.

To perform another fresh read and atomically apply just that validated update to
this checkout:

```sh
npm run capture:maybank -- --apply
npm test
npm run build
```

`--apply` does not import an old candidate. It fetches the page again and binds the
new result to the current base. It changes the local feed only; it does not commit,
push, merge or deploy. Run on a data branch and review the four-record diff plus
`evidence.json` before creating the data PR. Keep the original response with the
review evidence. A hash binds content; it is not a bank signature.

This is an actual automatic HTTP capture, so observations use `method: collector`.
It is not a human review. The existing `review:file` workflow remains the route
for a separately obtained official file and real human attestation.

## This PR's data update

The real `--apply` command succeeded at **2026-11-14T15:15:57.318Z**
(23:15 Singapore), with four complete schedules and original body SHA-256
`a29b8174ebb56951cff3239c3f6c8f1fd18b86327af587698c1d05fe9954d816`.
The preceding read at 15:13:17Z also parsed all four schedules. Page bytes differed,
but the extracted terms/rates did not; hashes are specific to each actual response.

[Capture evidence and before/after records](maybank-capture-evidence-20261114.json)
bind the original main snapshot and resulting candidate. Only the four Maybank
observation times and feed generation time changed semantically. Other 17 products,
all collection health records, missing effective/publication dates and SORA
formulas remain unchanged. JSON whitespace follows the collector's serializer.
The raw page stays in the local evidence bundle, not the published feed.

**This does not restore GitHub's daily Maybank collection.** Scheduled status stays
failed and future failed runs retain the original successful observation dates.
Fresh rates and a failing scheduled collector are separate facts.

For unattended recovery, this command still needs a persistent permitted execution
environment that can reach the public page, or a bank-supported publication/export
with the same complete schedules. No such additional host/feed is configured by
this PR. FAQs without numerical schedules, reference/board rates, snippets and
third-party broker quotes do not qualify as replacements.

## Validation

Tests exercise complete-group parsing, HTTP denial/timeout rejection, body tampering,
stale/future captures, regressed observation dates, unexpected product IDs, and
unchanged other-source records and scheduled health. A real CLI test with a controlled
curl executable covers successful atomic application, transport failure and a
concurrent base edit without contacting a bank. Live local capture and GitHub
transport experiments are recorded separately from these deterministic tests.
