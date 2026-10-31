import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { load } from 'cheerio';
import { FeedSchema, SOURCES, type Feed, type SourceStatus } from '../src/lib/schema';
import { parsers, type Page } from '../src/lib/parsers';
import { fetchText } from '../src/lib/sync';
export function nodePage(html: string): Page {
  const $ = load(html);
  $('script,style,noscript').remove();
  return {
    text: $('body').text(),
    tables: $('table')
      .toArray()
      .map((t) =>
        $(t)
          .find('tr')
          .toArray()
          .map((r) =>
            $(r)
              .find('th,td')
              .toArray()
              .map((c) => $(c).text().replace(/\s+/g, ' ').trim()),
          ),
      ),
  };
}
export async function collect(
  previous: Feed,
  fetcher: typeof fetch = fetch,
  at = new Date().toISOString(),
  sourceIds: readonly string[] = SOURCES.map((source) => source.id),
): Promise<Feed> {
  const offers = new Map(previous.offers.map((o) => [o.id, o]));
  const statuses: SourceStatus[] = [];
  // Sequential, one GET per source; no crawling, authentication or retries.
  for (const source of SOURCES.filter((source) => sourceIds.includes(source.id))) {
    try {
      const parsed = parsers[source.id](
        nodePage(
          await fetchText(
            source.url,
            fetcher,
            'collectionTimeoutMs' in source ? source.collectionTimeoutMs : 12000,
          ),
        ),
        at,
        'collector',
      );
      for (const offer of parsed) offers.set(offer.id, offer);
      statuses.push({
        sourceId: source.id,
        attemptedAt: at,
        successAt: at,
        status: 'ok',
        message: 'Collected from official public page',
      });
    } catch (e) {
      statuses.push({
        sourceId: source.id,
        attemptedAt: at,
        successAt: previous.sources.find((s) => s.sourceId === source.id)?.successAt,
        status: 'error',
        message:
          `Collection failed; last observation retained. ${e instanceof Error ? e.message : 'Unknown error'}`.slice(
            0,
            300,
          ),
      });
    }
  }
  return FeedSchema.parse({
    version: 1,
    generatedAt: at,
    offers: [...offers.values()],
    sources: statuses,
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = 'public/data/rates.json';
  const previous = FeedSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const feed = await collect(previous);
  await writeFile(path + '.tmp', JSON.stringify(feed, null, 2) + '\n');
  await rename(path + '.tmp', path);
  for (const source of feed.sources)
    console.log(`${source.sourceId}: ${source.status} — ${source.message}`);
  // Partial success is useful; all-source failure leaves the published file untouched in CI.
  if (feed.sources.every((s) => s.status === 'error')) process.exitCode = 1;
}
