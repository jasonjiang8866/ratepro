import { describe, it, expect, vi } from 'vitest';
import seed from './fixtures/feed.json';
import { FeedSchema, emptyCache, isStale, SOURCES } from '../src/lib/schema';
import {
  mergeFeed,
  readCache,
  saveCache,
  parseImport,
  payment,
  CACHE_KEY,
  MAX_BYTES,
} from '../src/lib/data';
import { synchronize, fetchText } from '../src/lib/sync';
const feed = FeedSchema.parse(seed);
const now = '2026-11-02T00:00:00.000Z';
function revision(rate: number, at = '2026-11-01T00:00:00.000Z') {
  const copy = structuredClone(feed);
  copy.generatedAt = at;
  copy.offers = [
    {
      ...copy.offers[1],
      observedAt: at,
      stages: copy.offers[1].stages.map((s, i) => (i ? s : { ...s, rate })),
    },
  ];
  copy.sources = [];
  return copy;
}
describe('incremental observations', () => {
  it('merges repeated snapshots without duplicates', () => {
    const c = mergeFeed(emptyCache(), feed, now);
    const twice = mergeFeed(c, feed, now);
    expect(twice.offers).toHaveLength(3);
    expect(twice.history).toEqual([]);
  });
  it('records a changed rate once and rejects older overwrites', () => {
    let c = mergeFeed(emptyCache(), feed, now);
    c = mergeFeed(c, revision(1.6), now);
    c = mergeFeed(c, feed, now);
    c = mergeFeed(c, revision(1.6), now);
    expect(c.offers.find((o) => o.id === 'dbs-hdb-cpf-oa')?.stages[0].rate).toBe(1.6);
    expect(c.history).toHaveLength(1);
    expect(c.history[0].offer.stages[0].rate).toBe(1.78);
  });
  it('updates observation date but not history when terms are unchanged', () => {
    const c = mergeFeed(mergeFeed(emptyCache(), feed, now), revision(1.78), now);
    expect(c.history).toHaveLength(0);
    expect(c.offers[1].observedAt).toContain('2026-11-01');
  });
  it('archives changes to terms even when the rate is unchanged', () => {
    const f = revision(1.78);
    f.offers[0].minLoan = 200000;
    expect(mergeFeed(mergeFeed(emptyCache(), feed, now), f, now).history).toHaveLength(1);
  });
  it('preserves previous offers and observation dates on source failure', () => {
    const c = mergeFeed(emptyCache(), feed, now);
    const failed = {
      version: 1,
      generatedAt: now,
      offers: [],
      sources: [
        { sourceId: 'dbs-hdb', attemptedAt: now, status: 'error', message: 'Network unavailable' },
      ],
    };
    expect(mergeFeed(c, failed, now).offers).toEqual(c.offers);
  });
  it('rejects future observations and duplicated or mismatched IDs', () => {
    expect(() => mergeFeed(emptyCache(), revision(2, '2099-01-01T00:00:00.000Z'), now)).toThrow();
    expect(() => FeedSchema.parse({ ...feed, offers: [feed.offers[0], feed.offers[0]] })).toThrow();
    expect(() =>
      FeedSchema.parse({ ...feed, offers: [{ ...feed.offers[0], id: 'other-offer' }] }),
    ).toThrow();
  });
  it('rejects accumulated imports beyond the cache limit without altering existing data', () => {
    const many = {
      ...feed,
      offers: Array.from({ length: 200 }, (_, i) => ({
        ...feed.offers[0],
        id: `hdb-package-${i}`,
      })),
    };
    const cached = mergeFeed(emptyCache(), many, now);
    expect(() => mergeFeed(cached, feed, now)).toThrow();
    expect(cached.offers).toHaveLength(200);
  });
  it('bounds retained history', () => {
    let c = mergeFeed(emptyCache(), feed, now);
    for (let i = 0; i < 520; i++) {
      const at = new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString();
      c = mergeFeed(c, revision(1 + i / 1000, at), now);
    }
    expect(c.history.length).toBe(500);
  });
  it('marks old observations and expired quarters stale', () => {
    expect(isStale(feed.offers[0], Date.parse('2027-01-01'))).toBe(true);
    expect(
      isStale(
        { ...feed.offers[0], observedAt: '2027-01-01T00:00:00.000Z' },
        Date.parse('2027-01-01'),
      ),
    ).toBe(true);
    expect(isStale(feed.offers[1], Date.parse('2026-10-31'))).toBe(false);
  });
});
describe('storage and sharing', () => {
  it('recovers safely from corrupt or inaccessible storage', () => {
    expect(readCache({ getItem: () => '{broken' }).warning).toBeTruthy();
    expect(
      readCache({
        getItem: () => {
          throw Error('Denied');
        },
      }).cache.offers,
    ).toEqual([]);
  });
  it('handles write quota failures without losing the in-memory model', () => {
    expect(
      saveCache(
        {
          setItem: () => {
            throw Error('quota');
          },
        },
        emptyCache(),
      ),
    ).toContain('unavailable');
  });
  it('round trips cached observations', () => {
    let value = '';
    const c = mergeFeed(emptyCache(), feed, now);
    saveCache(
      {
        setItem: (key, data) => {
          expect(key).toBe(CACHE_KEY);
          value = data;
        },
      },
      c,
    );
    expect(readCache({ getItem: () => value }).cache).toEqual(c);
    expect(parseImport(value).offers).toHaveLength(3);
    expect(parseImport(value).offers[0].method).toBe('imported');
    expect(parseImport(value).sources).toEqual([]);
  });
  it('rejects invalid, oversized or executable source URLs', () => {
    expect(() => parseImport('x'.repeat(MAX_BYTES + 1))).toThrow();
    expect(() =>
      parseImport(
        JSON.stringify({
          ...feed,
          offers: [{ ...feed.offers[0], sourceUrl: 'javascript:alert(1)' }],
        }),
      ),
    ).toThrow();
    expect(() =>
      parseImport(
        JSON.stringify({
          ...feed,
          offers: [{ ...feed.offers[0], stages: [{ label: 'x', rate: -1, formula: 'x' }] }],
        }),
      ),
    ).toThrow();
  });
});
describe('refresh resilience', () => {
  it('throttles automatic requests and allows forced refresh', async () => {
    const fetcher = vi.fn().mockRejectedValue(Error('offline'));
    const c = { ...emptyCache(), lastAttempt: new Date().toISOString() };
    await synchronize(c, false, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    await synchronize(c, true, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1 + SOURCES.length);
  });
  it('keeps cached data if both feed and direct requests fail', async () => {
    const c = mergeFeed(emptyCache(), feed, now);
    const result = await synchronize(c, true, vi.fn().mockRejectedValue(Error('CORS')));
    expect(result.cache.offers).toEqual(c.offers);
    expect(result.cache.sources.every((s) => s.status === 'error')).toBe(true);
  });
  it('accepts a same-origin feed even if all direct checks fail', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (url === '/data/rates.json') return new Response(JSON.stringify(feed));
      throw Error('CORS');
    });
    const result = await synchronize(emptyCache(), true, fetcher);
    expect(result.cache.offers).toHaveLength(3);
    expect(result.cache.lastFeedCheck).toBeTruthy();
    expect(result.message).toContain('snapshot');
  });
  it('publishes the snapshot before slow cross-origin checks settle', async () => {
    const progress = vi.fn();
    let sawSnapshot = false;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (url === '/data/rates.json') return new Response(JSON.stringify(feed));
      sawSnapshot = progress.mock.calls.length === 1;
      throw Error('CORS');
    });
    await synchronize(emptyCache(), true, fetcher, progress);
    expect(sawSnapshot).toBe(true);
    expect(progress.mock.calls[0][0].offers).toHaveLength(3);
  });
  it('rejects oversized streaming bodies without Content-Length', async () => {
    await expect(
      fetchText(
        '/data/rates.json',
        vi.fn().mockResolvedValue(new Response('x'.repeat(MAX_BYTES + 1))),
      ),
    ).rejects.toThrow('too large');
  });
});
describe('repayment estimates', () => {
  it('calculates a standard amortising payment', () =>
    expect(payment(500000, 2.6, 25)).toBeCloseTo(2268.35, 1));
  it('handles a zero interest rate', () => expect(payment(120000, 0, 10)).toBe(1000));
  it('rejects invalid inputs', () => {
    expect(payment(-1, 2, 25)).toBeNull();
    expect(payment(1, 2, 0)).toBeNull();
    expect(payment(1, NaN, 25)).toBeNull();
  });
});
