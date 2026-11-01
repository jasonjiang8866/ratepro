# Review official files when automated retrieval is unavailable

This workflow prepares a candidate, presents every before/after record, and stages
a human-reviewed snapshot for a separate data PR. It never fetches a URL, modifies
`public/data/rates.json`, commits, opens a PR, merges or deploys by itself.
An inaccessible source remains inaccessible; a reviewed file does not turn its
collector health green.

## Supported evidence

| Source argument                                                 | Format                    | Required publication                                                              |
| --------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| `dbs-hdb`, `dbs-green`, `hdb`, `maybank`, `sc-sora`, `uob-sora` | `html`                    | Complete saved official page matching the existing strict parser                  |
| `cpf-askgov`                                                    | `html`                    | CPF-published AskGov question, explicit full current quarter and HDB/OA/fee table |
| `cpf-board`                                                     | `html` or `rendered-json` | CPF Board article and the same explicit quarterly facts                           |
| `citi`                                                          | `pdf`                     | Original two-page official pricing PDF; Poppler `pdftotext` must be installed     |

URLs come from the repository allowlist. `rendered-json` is the `{text,tables}`
DOM capture emitted by `research:cpf`; its presence alone does not mean the live
experiment succeeded. Generic PDFs, screenshots, search snippets, OCR/LLM guesses,
partial tables and arbitrary new bank sources are not accepted. New publications
need their own parser and tests before use.

The operator must obtain the document through permitted ordinary access and
record when its rate content was actually observed. Do not use the file mtime,
publication/print date, page update date, prepare time or staging time as that
observation. Do not re-date an old saved file. Stop on denial/challenge; request
an authorised export/feed or keep the old observation instead.

A local file and a matching heading cannot authenticate the publisher. The human
reviewer must verify the official URL, complete original file and capture time.
Hashes prevent accidental replacement between preparation and staging; they are
not publisher signatures or reviewer authentication.

## Prepare and inspect

Use an up-to-date checkout of the intended data PR base, after this tooling is
available on that base. Keep evidence files outside tracked production data.
The following values are placeholders, not dates to copy into a real observation:

```sh
npm run review:file -- prepare \
  --source maybank --format html --file /path/to/official.html \
  --observed-at '<actual ISO-8601 capture time with timezone>' \
  --out review-output/maybank-candidate
```

Read `review-output/maybank-candidate/review.md` beside the original publication.
It includes every field before and after, and the evidence, base and candidate
SHA-256 values. Check all stages, eligibility, minimum/maximum loan, commitment,
customer tier and effective period, including unchanged values. A SORA spread
must remain a formula with a null all-in rate. Do not approve by copying a hash
without reviewing the corresponding candidate.

Preparation rejects future observations, evidence older than seven days,
observations no newer than the retained source, expired periods and changed
product IDs. Maybank's four products and Citi's four products are handled as a
whole source group. Use a separate parser/schema PR for a product ID change.

## Explicit review and staging

After a real review, bind the approval to the displayed candidate hash:

```sh
npm run review:file -- stage \
  --file /path/to/official.html \
  --candidate review-output/maybank-candidate/candidate.json \
  --approve-sha '<reviewed candidate SHA-256>' \
  --reviewer '<reviewer name or GitHub handle>' \
  --out review-output/maybank-staged
```

The command checks the current base hash, original evidence hash, candidate hash,
time/expiry constraints and a fresh strict extraction of the file. If the daily
collector has changed the base, prepare and review again. It writes only new files
inside ignored `review-output/` directories and refuses overwrites and symlinked
output paths. Use a new directory for a new attempt.

The staged records use `method: reviewed` and retain the supplied observation
time. `generatedAt` is only staging time. Other sources and all automatic
collector statuses, including errors, remain unchanged. CPF Board and AskGov
evidence have distinct source links; neither is relabelled as the HDB main page.

## Create a data PR after review

On a separate branch from the reviewed base, copy the staged `rates.json` to
`public/data/rates.json`. Preserve `review.json`, the candidate diff and evidence
hash in a dated record under `docs/reviews/`; retain the original publication in
an appropriate evidence archive. Do not publish personal information or session
data from a saved page. Run `npm test` and `npm run build`, inspect the data diff,
then commit and open a draft data PR for repository review. Do not merge directly.

The second repository review must check that the snapshot still matches the
staged candidate and that the recorded base has not changed. If it has, repeat
preparation and staging against the new base. These CLI checks are local review
guardrails, not a server-enforced approval system. No current rates are published
by the development PR that introduces this workflow.

## Read-only experiments

```sh
npx playwright install --with-deps chromium
npm run test:browser
npm run research:cpf
npm run research:maybank
```

The separate `Read-only retrieval research` Actions workflow installs Chromium
and runs the same commands. Its permissions are read-only. CPF uses one fresh
default browser context, runs the public page's own JavaScript and reads visible
DOM, including open shadow roots. It does not reverse engineer or directly call
undocumented data endpoints. Main-document redirects, observed access denials and
challenge responses stop the experiment. There is no proxy/client spoofing,
stored session, challenge solving or retry. A validated candidate is still not an
enabled collector or a published observation.

Maybank makes one ordinary curl HTTP/1.1 request matching the existing collector.
It records only bounded timing fields and the exit/status code, not IP addresses,
cookies, raw headers or response bodies. The last completed milestone narrows the
observed failure stage but does not prove the cause. Both experiments save
short-lived Actions artifacts and never write the production snapshot.
