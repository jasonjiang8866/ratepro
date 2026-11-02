import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { load } from 'cheerio';
import { FeedSchema, SOURCES, HDB_FALLBACK, type Feed, type SourceStatus } from '../src/lib/schema';
import { parsers, type Page } from '../src/lib/parsers';
import { RetrievalError } from '../src/lib/sync';
import { retrieve } from './retrieval';
import { parseCiti, pdfText } from './citi';
import { curlFetch } from './curl-fetch';
import { parseHdbAskGov } from './hdb-askgov';

function failure(error: unknown, attempts: number, phase: 'parse' | 'document') {
  return {
    failureKind: error instanceof RetrievalError ? error.kind : phase,
    httpStatus: error instanceof RetrievalError ? error.httpStatus : undefined,
    attempts,
    message: (error instanceof Error ? error.message : 'Unknown error').slice(0, 300),
  };
}
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
  pause?: (ms: number) => Promise<void>,
): Promise<Feed> {
  const offers = new Map(previous.offers.map((o) => [o.id, o]));
  const statuses: SourceStatus[] = [];
  // Sequential with one bounded transient retry; no crawling or authentication.
  for (const source of SOURCES.filter((source) => sourceIds.includes(source.id))) {
    let attempts = 1;
    let phase: 'parse' | 'document' = 'parse';
    let primaryFailure: SourceStatus['primaryFailure'];
    let fallbackSourceId: SourceStatus['fallbackSourceId'];
    try {
      let parsed;
      try {
        const bytes = await retrieve(
          source.url,
          ['maybank', 'uob-sora'].includes(source.id) && fetcher === fetch ? curlFetch : fetcher,
          'collectionTimeoutMs' in source ? source.collectionTimeoutMs : 12000,
          (n) => {
            attempts = n;
          },
          pause,
        );
        if (source.id === 'citi') {
          phase = 'document';
          const text = await pdfText(bytes);
          phase = 'parse';
          parsed = parseCiti(text, at, 'collector');
        } else
          parsed = parsers[source.id](nodePage(new TextDecoder().decode(bytes)), at, 'collector');
      } catch (error) {
        if (source.id !== 'hdb') throw error;
        // A different official publication, not a retry or bypass of the denied HDB page.
        primaryFailure = failure(error, attempts, phase);
        fallbackSourceId = HDB_FALLBACK.id;
        attempts = 1;
        phase = 'parse';
        const bytes = await retrieve(
          HDB_FALLBACK.url,
          fetcher,
          HDB_FALLBACK.collectionTimeoutMs,
          (n) => {
            attempts = n;
          },
          pause,
        );
        parsed = parseHdbAskGov(nodePage(new TextDecoder().decode(bytes)), at);
      }
      for (const offer of parsed) offers.set(offer.id, offer);
      statuses.push({
        sourceId: source.id,
        attemptedAt: at,
        successAt: at,
        status: 'ok',
        message: fallbackSourceId
          ? 'Collected from official CPF / AskGov fallback; HDB primary page unavailable.'
          : 'Collected from official public page',
        attempts,
        fallbackSourceId,
        primaryFailure,
      });
    } catch (e) {
      statuses.push({
        sourceId: source.id,
        attemptedAt: at,
        successAt: previous.sources.find((s) => s.sourceId === source.id)?.successAt,
        status: 'error',
        ...failure(e, attempts, phase),
        fallbackSourceId,
        primaryFailure,
        message:
          `Collection failed${fallbackSourceId ? ' (CPF / AskGov fallback)' : ''}; last observation retained. ${e instanceof Error ? e.message : 'Unknown error'}`.slice(
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
  for (const source of feed.sources) {
    console.log(`${source.sourceId}: ${source.status} — ${source.message}`);
    if (source.primaryFailure)
      console.log(
        `${source.sourceId} primary: ${source.primaryFailure.message}; ${source.primaryFailure.attempts} attempt(s).`,
      );
  }
  // Partial success is useful; all-source failure leaves the published file untouched in CI.
  if (feed.sources.every((s) => s.status === 'error')) process.exitCode = 1;
}
