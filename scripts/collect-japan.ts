import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JP_SOURCES, JpFeedSchema, type JpFeed } from '../src/lib/japan-rates';
import { retrieve } from './retrieval';
import { parseJapan } from './japan-parsers';
export async function collectJapan(
  previous: JpFeed,
  fetcher: typeof fetch = fetch,
  at = new Date().toISOString(),
): Promise<JpFeed> {
  const observations = new Map(previous.observations.map((o) => [o.sourceId, o]));
  const sources: JpFeed['sources'] = [];
  for (const source of JP_SOURCES) {
    let attempts = 1;
    try {
      const bytes = await retrieve(source.url, fetcher, 15000, (n) => {
        attempts = n;
      });
      const next = parseJapan(source.id, bytes, at);
      const prior = observations.get(source.id);
      if (prior && next.publicationMonth < prior.publicationMonth)
        throw Error('Publication month regressed');
      observations.set(source.id, next); // Replace the entire source only after complete validation.
      sources.push({
        sourceId: source.id,
        attemptedAt: at,
        successAt: at,
        status: 'ok',
        attempts,
        message: `Validated ${next.rates.length} rates; publication ${next.publicationMonth}`,
      });
    } catch (error) {
      sources.push({
        sourceId: source.id,
        attemptedAt: at,
        successAt: previous.sources.find((s) => s.sourceId === source.id)?.successAt,
        status: 'error',
        attempts,
        message:
          `Last observation retained. ${error instanceof Error ? error.message : 'Unknown error'}`.slice(
            0,
            300,
          ),
      });
    }
  }
  return JpFeedSchema.parse({
    version: 1,
    market: 'JP',
    currency: 'JPY',
    generatedAt: at,
    observations: [...observations.values()],
    sources,
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = 'public/data/rates-jp.json';
  const previous = JpFeedSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const feed = await collectJapan(previous);
  await writeFile('japan-source-check.json', JSON.stringify(feed, null, 2) + '\n');
  for (const s of feed.sources) console.log(`${s.sourceId}: ${s.status} — ${s.message}`);
  const strict = process.argv.includes('--check');
  if (
    feed.sources.every((s) => s.status === 'error') ||
    (strict && feed.sources.some((s) => s.status === 'error'))
  )
    process.exitCode = 1;
  if (!strict && feed.sources.some((s) => s.status === 'ok')) {
    await writeFile(path + '.tmp', JSON.stringify(feed, null, 2) + '\n');
    await rename(path + '.tmp', path);
  }
}
