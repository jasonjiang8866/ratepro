# Standalone Maybank capture job

This one-shot task can run on a trusted PC/NAS or another permitted environment.
It does not register a self-hosted GitHub Actions runner, serve a network endpoint,
merge a PR, deploy the website or change the scheduled collector's health.
No host or schedule is provisioned by this repository change.

## Verify access first

From a reviewed checkout with Node 22.12+ and curl:

```sh
npm ci
npm run job:maybank
```

The default is read-only against GitHub. It reads the latest main commit and its
snapshot, makes one bounded ordinary Maybank request, validates all six complete
schedules, checks main again, and saves a candidate under
`research-output/maybank-job/capture-*`. `plan.json` includes the exact source
files that would be committed. This is an actual live capture, not a saved-file
import. Existing data PRs from this repository's `data/maybank-*` branches suppress
another capture/PR until reviewed, closed or merged.

Access to both `api.github.com` and the canonical Maybank public page must work in
that environment. A successful local capture elsewhere does not establish NAS,
Cloudflare or GitHub-runner connectivity. There is no automatic proxy/client
fallback. Network errors and denials stop the task.

## Container

```sh
docker compose -f collectors/maybank/compose.yml build
docker compose -f collectors/maybank/compose.yml run --rm maybank --help
docker compose -f collectors/maybank/compose.yml run --rm maybank
```

The task runs as the unprivileged `node` user, with a read-only root filesystem,
a temporary `/tmp`, no published ports or Linux capabilities, and a persistent
named volume for evidence and submission state. The Docker build uses the existing
lockfile. It neither installs a browser nor requires a Docker socket at runtime.
The image contains no GitHub credential. Only this task's explicit startup code
runs; incoming pull requests cannot schedule work on the host.

## Create a draft data PR

Supply a fine-grained token scoped only to `jasonjiang8866/ratepro`, with Contents
and Pull requests read/write permission. No Actions, administration or workflow
write permission is needed. Provide it via `GH_TOKEN`, or a readable secret file
whose path is in `MAYBANK_GITHUB_TOKEN_FILE`. Never put its value in source, a
Compose file, command-line arguments or logs.

With `GH_TOKEN` already supplied to the host environment by your secret manager:

```sh
npm run job:maybank -- --submit
# Or pass that environment variable into the container without expanding its value:
docker compose -f collectors/maybank/compose.yml run --rm -e GH_TOKEN maybank --submit
```

`--submit` performs a new capture, rechecks main before writing, and creates a new
`data/maybank-*` branch and a **draft** PR. It changes exactly the SG snapshot plus
two evidence files under `docs/captures/maybank/`: original official HTML and the
source/base/candidate hashes and every before/after field. All other products and
scheduled statuses remain unchanged. The new commit has the exact main commit
used for capture as its parent, so it cannot silently replace later main changes.
Review the evidence, CI and any merge conflict normally. No auto-merge is enabled.
The original HTML is retained as evidence, not executed or included in the website.

Run only one configured instance, with the same persistent evidence volume.
There is no background loop. A host scheduler can invoke the one-shot command
once per day after deployment and successful live verification; no schedule is
installed here. Pending PRs are not automatically approved or refreshed.

## Interrupted submissions

An exclusive `research-output/maybank-job/publishing.json` prevents overlapping
submissions on the same state volume. Before the first write it records the branch,
base SHA and evidence directory. A timeout during a GitHub mutation is ambiguous:
the operation may have succeeded remotely. The task never blindly retries it and
leaves the file in place, blocking future submissions.

Inspect the recorded branch and the repository's PRs. If the PR exists, retain its
link with the evidence. If a branch exists without a PR, inspect its exact commit
and open the missing PR through the normal repository UI. Clear `publishing.json`
only after reconciling that interrupted attempt and confirming no task is running.
Do not delete evidence or a remote branch merely to make the next invocation pass.
Failures before any mutation remove the lock so the next scheduled attempt can
retry normally. Credentials and raw API error bodies are never logged.

## Validation and limits

`tests/maybank-job.test.ts` verifies immutable-base reads, unchanged source health,
pending PR handling, stale/base-change rejection, branch-only writes, draft PRs,
no retry after an ambiguous mutation, and credential/header restrictions using
controlled network doubles. The separate container CI builds the actual Dockerfile
and executes the CLI help and these tests inside an unprivileged read-only container.
It does not claim live Maybank access from GitHub.

The engineering environment uses the connected GitHub adapter for real API reads
and data-PR writes because direct GitHub network access is unavailable there.
The same exported prepare/submit functions perform that live validation; the
standalone HTTPS transport is tested with controlled responses. A long-running
host still needs a real `--submit` check with its own scoped credential before
calling that deployment verified.

References: [GitHub fine-grained permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens),
[Git data API](https://docs.github.com/en/rest/git/trees),
[self-hosted runner security](https://docs.github.com/en/actions/reference/security/secure-use).
