import { afterEach, describe, expect, it, vi } from 'vitest';
import seed from './fixtures/feed.json';
import {
  FeedSchema,
  emptyCache,
  isStale,
  observationAge,
  freshnessWarning,
  CacheSchema,
} from '../src/lib/schema';
import { synchronize } from '../src/lib/sync';
import { collect } from '../scripts/collect';
import { mergeCheckEvidence } from '../src/lib/data';

const feed = FeedSchema.parse(seed);
const observedAt = '2026-10-31T08:00:00.000Z';
const now = '2026-11-01T08:00:00.000Z';
afterEach(() => vi.useRealTimers());
describe('freshness and independent check channels', () => {
  it('merges cross-tab evidence without regressing timestamps or mixing check channels', () => {
    const old = {
      ...emptyCache(),
      lastAttempt: observedAt,
      snapshotGeneratedAt: observedAt,
      publishedSources: [
        {
          sourceId: 'dbs-hdb' as const,
          attemptedAt: observedAt,
          status: 'ok' as const,
          message: 'Collector success',
        },
      ],
    };
    const incoming = {
      ...emptyCache(),
      lastAttempt: now,
      browserSources: [
        {
          sourceId: 'dbs-hdb' as const,
          attemptedAt: now,
          status: 'error' as const,
          message: 'Browser blocked',
        },
      ],
    };
    const merged = mergeCheckEvidence(old, incoming);
    expect(merged.publishedSources).toEqual(old.publishedSources);
    expect(merged.browserSources).toEqual(incoming.browserSources);
    expect(mergeCheckEvidence(merged, old)).toEqual(merged);
  });
  it('does not turn a browser failure into a collector failure or a successful browser observation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const published = {
      ...feed,
      generatedAt: observedAt,
      sources: [
        {
          sourceId: 'dbs-hdb',
          attemptedAt: observedAt,
          successAt: observedAt,
          status: 'ok',
          message: 'Collected',
        },
      ],
    };
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (url === '/data/rates.json') return new Response(JSON.stringify(published));
      throw Error('CORS');
    });
    const result = await synchronize(emptyCache(), true, fetcher);
    expect(result.cache.publishedSources).toEqual(published.sources);
    expect(result.cache.browserSources?.every((s) => s.status === 'error' && !s.successAt)).toBe(
      true,
    );
    expect(result.cache.offers).toEqual(feed.offers);
    expect(result.cache.snapshotGeneratedAt).toBe(observedAt);
    expect(result.cache.lastFeedCheck).toBe(now);
    const offline = await synchronize(
      result.cache,
      true,
      vi.fn().mockRejectedValue(Error('offline')),
    );
    expect(offline.cache.publishedSources).toEqual(published.sources);
    expect(offline.cache.snapshotGeneratedAt).toBe(observedAt);
    expect(CacheSchema.parse(JSON.parse(JSON.stringify(offline.cache)))).toEqual(offline.cache);
  });
  it('does not replace newer collector evidence with an older downloaded snapshot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const cache = {
      ...emptyCache(),
      snapshotGeneratedAt: now,
      publishedSources: [
        {
          sourceId: 'dbs-hdb' as const,
          attemptedAt: now,
          successAt: now,
          status: 'ok' as const,
          message: 'Newer success',
        },
      ],
    };
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (url === '/data/rates.json') return new Response(JSON.stringify(feed));
      throw Error('offline');
    });
    const result = await synchronize(cache, true, fetcher);
    expect(result.cache.publishedSources).toEqual(cache.publishedSources);
    expect(result.cache.snapshotGeneratedAt).toBe(now);
  });
  it('flags the seven-day threshold without treating a download as a new observation', () => {
    const offer = { ...feed.offers[1], observedAt };
    const sevenDays = Date.parse(observedAt) + 7 * 86400000;
    expect(isStale(offer, sevenDays)).toBe(false);
    expect(isStale(offer, sevenDays + 1)).toBe(true);
    expect(observationAge(offer, Date.parse(now))).toBe('Observed 1 day ago');
    expect(freshnessWarning(offer, sevenDays + 1)).toContain('Over 7 days');
  });
  it('expires a dated period at Singapore midnight, even after a recent observation', () => {
    const offer = {
      ...feed.offers[0],
      observedAt: '2026-12-31T15:00:00.000Z',
      effectiveUntil: '2026-12-31',
    };
    expect(isStale(offer, Date.parse('2026-12-31T15:59:59.000Z'))).toBe(false);
    expect(freshnessWarning(offer, Date.parse('2026-12-31T16:00:00.000Z'))).toContain(
      'Published period ended',
    );
  });
  it('keeps old cache exports readable without inventing collector or browser history', () => {
    const cache = CacheSchema.parse({
      ...emptyCache(),
      offers: feed.offers,
      sources: feed.sources,
    });
    expect(cache.publishedSources).toBeUndefined();
    expect(cache.browserSources).toBeUndefined();
  });
  it('isolates experimental retrieval while retaining every previous observation on failure', async () => {
    const fetcher = vi.fn().mockRejectedValue(Error('timeout'));
    const result = await collect(feed, fetcher, now, ['maybank']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('maybank2u.com.sg');
    expect(result.offers).toEqual(feed.offers);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].status).toBe('error');
  });
});
