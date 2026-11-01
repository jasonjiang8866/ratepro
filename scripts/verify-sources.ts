import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { collect } from './collect';
import { FeedSchema } from '../src/lib/schema';

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
const feed = await collect(previous, fetch, new Date().toISOString(), required);
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
