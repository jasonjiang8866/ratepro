import { appendFile } from 'node:fs/promises';
import { SOURCES, isStale, type Feed, type SourceStatus } from '../src/lib/schema';

// Supported product groups, not a claim of complete market coverage.
export const expectedProducts = {
  'dbs-hdb': 1,
  'dbs-green': 1,
  hdb: 1,
  maybank: 4,
  'sc-sora': 1,
  'uob-sora': 1,
  citi: 9,
  sbi: 3,
} as const;

export function sourceHealth(feed: Feed) {
  return SOURCES.map((source) => {
    const status = feed.sources.find((item) => item.sourceId === source.id);
    const offers = feed.offers.filter((offer) => offer.sourceId === source.id);
    const stale = offers.filter((offer) => isStale(offer, Date.parse(feed.generatedAt))).length;
    return {
      sourceId: source.id,
      status: status?.status ?? 'not checked',
      expected: expectedProducts[source.id],
      available: offers.length,
      stale,
      evidence: status?.fallbackSourceId ?? 'primary',
      failure: status?.failureKind,
      missing: Math.max(0, expectedProducts[source.id] - offers.length),
      healthy: status?.status === 'ok' && offers.length === expectedProducts[source.id] && !stale,
    };
  });
}

export function healthMarkdown(feed: Feed) {
  const health = sourceHealth(feed);
  const healthy = health.filter((row) => row.healthy).length;
  return (
    `## SG collection coverage\n\n${healthy}/${health.length} sources healthy; ${feed.offers.length}/${Object.values(expectedProducts).reduce((a, b) => a + b, 0)} supported products present.\n\n` +
    '| Source | Retrieval | Products / supported | Stale | Evidence | Failure |\n| --- | --- | --- | --- | --- | --- |\n' +
    health
      .map(
        (row) =>
          `| ${row.sourceId} | ${row.status} | ${row.available} / ${row.expected} | ${row.stale} | ${row.evidence} | ${row.failure ?? '—'} |`,
      )
      .join('\n') +
    '\n\nA completed workflow can publish partial data. Retained records keep their original observation times; a primary-page denial and a successful official fallback are reported separately.\n'
  );
}

export async function reportHealth(feed: Feed) {
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, healthMarkdown(feed));
  for (const row of sourceHealth(feed).filter((row) => !row.healthy))
    console.log(
      `::warning title=Incomplete SG source::${row.sourceId}: ${row.status}, ${row.available}/${row.expected} supported products, ${row.stale} stale; ${row.failure ?? 'check coverage'}`,
    );
}

export function validateCollectedGroup(
  sourceId: SourceStatus['sourceId'],
  feed: Feed['offers'],
  previous: Feed,
) {
  if (
    feed.length !== expectedProducts[sourceId] ||
    feed.some((offer) => offer.sourceId !== sourceId) ||
    new Set(feed.map((offer) => offer.id)).size !== feed.length
  )
    throw Error('Incomplete or inconsistent supported product group');
  for (const offer of feed) {
    const old = previous.offers.find((item) => item.id === offer.id);
    if (old?.documentDate && offer.documentDate && offer.documentDate < old.documentDate)
      throw Error('Source document date regressed; retained previous observation');
  }
}
