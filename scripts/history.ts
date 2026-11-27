import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BYTES } from '../src/lib/data';
import { HistoryMarket, type Market, type Provenance } from '../src/lib/history';
import { bytesDigest, normalize, sourceUrls } from './history/normalize';
import { Ledger } from './history/store';
import { analyze, generateAnalytics } from './history/analytics';

export const feedPaths = { SG: 'public/data/rates.json', JP: 'public/data/rates-jp.json' };
const schemaPaths = { SG: 'src/lib/schema.ts', JP: 'src/lib/japan-rates.ts' };
export function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}
function captureBlobsAt(repo: string, commit: string) {
  return (path: string) =>
    execFileSync('git', ['show', `${commit}:${path}`], {
      cwd: repo,
      maxBuffer: MAX_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
}
export async function backfill(repo: string, ledger: Ledger, ref: string, importedAt: string) {
  if (git(repo, 'rev-parse', '--is-shallow-repository') === 'true')
    throw Error('Backfill requires full Git history (fetch-depth: 0)');
  const head = git(repo, 'rev-parse', '--verify', `${ref}^{commit}`);
  const report: {
    head: string;
    snapshots: number;
    added: number;
    rejected: { commit: string; market: Market; reason: string }[];
  } = { head, snapshots: 0, added: 0, rejected: [] };
  for (const market of ['SG', 'JP'] as const) {
    const commits = git(
      repo,
      'log',
      '--first-parent',
      '--reverse',
      '--format=%H',
      head,
      '--',
      feedPaths[market],
    )
      .split('\n')
      .filter(Boolean);
    for (const commit of commits) {
      try {
        const text = execFileSync('git', ['show', `${commit}:${feedPaths[market]}`], {
          cwd: repo,
          encoding: 'utf8',
          maxBuffer: 20 * 1024 * 1024,
        });
        const raw = JSON.parse(text);
        const provenance: Provenance = {
          mode: 'git-backfill',
          importedAt,
          feedGeneratedAt: raw.generatedAt,
          feedPath: feedPaths[market],
          feedSha256: bytesDigest(text),
          commit,
          committedAt: git(repo, 'show', '-s', '--format=%cI', commit),
          runUrl: null,
        };
        const urls = sourceUrls(git(repo, 'show', `${commit}:${schemaPaths[market]}`));
        report.added += await ledger.append(
          normalize(raw, market, provenance, urls, captureBlobsAt(repo, commit)),
        );
        report.snapshots++;
      } catch (error) {
        report.rejected.push({
          commit,
          market,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return report;
}
export async function ingestFile(
  repo: string,
  ledger: Ledger,
  market: Market,
  input: string,
  mode: 'snapshot' | 'collection',
  importedAt: string,
) {
  const text = await readFile(join(repo, input), 'utf8'),
    raw = JSON.parse(text);
  let snapshotCommit: string | null = null;
  if (mode === 'snapshot') {
    try {
      const head = git(repo, 'rev-parse', 'HEAD');
      const committed = execFileSync('git', ['show', `${head}:${input}`], {
        cwd: repo,
        encoding: 'utf8',
      });
      if (committed === text) snapshotCommit = head;
    } catch {
      /* Uncommitted snapshots have no immutable Git blob evidence. */
    }
  }
  const provenance: Provenance = {
    mode,
    importedAt,
    feedGeneratedAt: raw.generatedAt,
    feedPath: input,
    feedSha256: bytesDigest(text),
    commit: snapshotCommit,
    committedAt: snapshotCommit ? git(repo, 'show', '-s', '--format=%cI', snapshotCommit) : null,
    runUrl:
      process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
        ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
  };
  return ledger.append(
    normalize(
      raw,
      market,
      provenance,
      sourceUrls(
        snapshotCommit
          ? git(repo, 'show', `${snapshotCommit}:${schemaPaths[market]}`)
          : await readFile(join(repo, schemaPaths[market]), 'utf8'),
      ),
      snapshotCommit ? captureBlobsAt(repo, snapshotCommit) : undefined,
    ),
  );
}
async function main() {
  const args = process.argv.slice(2),
    command = args[0];
  const option = (name: string) => args[args.indexOf(name) + 1];
  if (args.includes('--market')) HistoryMarket.parse(option('--market'));
  if (args.includes('--input') && !args.includes('--market'))
    throw Error('--input requires --market');
  const repo = process.cwd(),
    root = join(repo, 'public/data/history/v1'),
    output = join(repo, 'public/data/analytics/v1');
  const ledger = await Ledger.open(root),
    now = new Date().toISOString();
  if (command === 'backfill') {
    const report = await backfill(
      repo,
      ledger,
      args.includes('--ref') ? option('--ref') : 'origin/main',
      now,
    );
    await mkdir('history-reports', { recursive: true });
    await writeFile('history-reports/backfill.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (report.rejected.length)
      throw Error(
        'Rejected snapshots recorded in history-reports/backfill.json; review before publication',
      );
  } else if (command === 'ingest') {
    for (const market of ['SG', 'JP'] as const)
      if (!args.includes('--market') || option('--market') === market) {
        const input = args.includes('--input') ? option('--input') : feedPaths[market];
        console.log(
          `${market}: ${await ingestFile(repo, ledger, market, input, args.includes('--input') ? 'collection' : 'snapshot', now)} new records`,
        );
      }
  } else if (command !== 'build' && command !== 'validate')
    throw Error('Use backfill, ingest, build or validate');
  if (command === 'validate') {
    for (const market of ['SG', 'JP'] as const) analyze(ledger.records(), market, now);
    console.log(`Validated ${ledger.records().length} immutable records and their relationships`);
    return;
  }
  const stats = await generateAnalytics(ledger.records(), output, now);
  console.log(JSON.stringify(stats, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
