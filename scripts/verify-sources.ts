import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { collect, nodePage } from './collect';
import { FeedSchema } from '../src/lib/schema';
import { fetchBytes } from '../src/lib/sync';
import { diagnosticFetch, type HttpEvidence } from './hdb-diagnostics';
import { createHash } from 'node:crypto';

// Read-only integration check: no repository push and no production deployment.
const previous = FeedSchema.parse(JSON.parse(await readFile('public/data/rates.json', 'utf8')));
const group = process.argv[2] ?? 'all';
const groups: Record<string, string[]> = {
  stable: ['dbs-hdb', 'dbs-green', 'sc-sora'],
  experimental: ['maybank'],
  expanded: ['uob-sora', 'citi'],
  hdb: ['hdb'],
  all: ['dbs-hdb', 'dbs-green', 'sc-sora', 'maybank', 'hdb', 'uob-sora', 'citi'],
};
if (!groups[group]) throw Error(`Unknown source group: ${group}`);
const required = groups[group];
const evidence: HttpEvidence[] = [];
const fetcher = group === 'hdb' ? diagnosticFetch(evidence) : fetch;
const feed = await collect(previous, fetcher, new Date().toISOString(), required);
if (group === 'hdb') {
  // Explicit opt-in research probe: not a fallback, not a source observation.
  // One request to the independent CPF publication; no retry on any outcome.
  let candidate: Record<string, unknown> | undefined;
  if (process.argv.includes('--probe-cpf')) {
    const url = 'https://www.cpf.gov.sg/service/article/how-are-cpf-interest-rates-determined';
    try {
      const bytes = await fetchBytes(url, fetcher, 30000);
      const page = nodePage(new TextDecoder().decode(bytes));
      candidate = {
        url,
        retrieval: 'ok',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bodyTextLength: page.text.trim().length,
        tableCount: page.tables.length,
        hasQuarterHeading: /Computation of CPF OA Interest Rate and HDB Mortgage Rate for/.test(
          page.text,
        ),
        collection: 'Not enabled or validated; HTTP success is not a rate observation',
      };
    } catch {
      candidate = {
        url,
        retrieval: 'failed',
        collection: 'Not enabled; prior observations retained',
      };
    }
  }
  const diagnostics = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    runner: process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions' : 'development',
    requestPolicy:
      'Default Node fetch; credentials omitted; no-cache; redirects rejected; no custom UA, cookies or proxy changes',
    evidence,
    candidate,
    offersUnchanged: JSON.stringify(feed.offers) === JSON.stringify(previous.offers),
    note: 'Headers and denial markers are evidence, not proof of a WAF rule or IP policy. Candidate retrieval never updates the feed.',
  };
  await writeFile('hdb-diagnostics.json', JSON.stringify(diagnostics, null, 2) + '\n');
  console.log(`HDB_DIAGNOSTICS_JSON=${JSON.stringify(diagnostics)}`);
}
await writeFile('source-check.json', JSON.stringify(feed, null, 2) + '\n');
for (const source of feed.sources)
  console.log(`${source.sourceId}: ${source.status} — ${source.message}`);
// Public observations only; retain the exact result in logs as well as the artifact.
console.log(`SOURCE_FEED_JSON=${JSON.stringify(feed)}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `## ${group} source health\n\n` +
      '| Source | Retrieval | Evidence endpoint | Retained observations |\n| --- | --- | --- | --- |\n' +
      feed.sources
        .map(
          (s) =>
            `| ${s.sourceId} | ${s.status} | ${s.fallbackSourceId ?? 'Primary'} | ${feed.offers.filter((o) => o.sourceId === s.sourceId).length} |`,
        )
        .join('\n') +
      '\n\nRetrieval failures keep prior observations and dates. This check does not publish data or deploy a website. Experimental failures remain failures.\n',
  );
}
if (required.some((id) => feed.sources.find((s) => s.sourceId === id)?.status !== 'ok')) {
  console.error(`A ${group} source could not be extracted. No published snapshot was changed.`);
  process.exitCode = 1;
}
