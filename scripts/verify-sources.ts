import { readFile, writeFile } from 'node:fs/promises';
import { collect } from './collect';
import { FeedSchema } from '../src/lib/schema';

// Read-only integration check: no repository push and no production deployment.
const previous = FeedSchema.parse(JSON.parse(await readFile('public/data/rates.json', 'utf8')));
const feed = await collect(previous);
await writeFile('source-check.json', JSON.stringify(feed, null, 2) + '\n');
for (const source of feed.sources)
  console.log(`${source.sourceId}: ${source.status} — ${source.message}`);
// Public observations only; retain the exact result in logs as well as the artifact.
console.log(`SOURCE_FEED_JSON=${JSON.stringify(feed)}`);
const required = ['maybank', 'sc-sora'];
if (required.some((id) => feed.sources.find((s) => s.sourceId === id)?.status !== 'ok')) {
  console.error(
    'A newly integrated source could not be extracted. No published snapshot was changed.',
  );
  process.exitCode = 1;
}
