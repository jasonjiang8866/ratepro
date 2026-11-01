import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { collect, nodePage } from '../scripts/collect';
import { parseHdbAskGov } from '../scripts/hdb-askgov';
import { parseHdb } from '../src/lib/parsers';
import {
  FeedSchema,
  OfferSchema,
  SourceStatusSchema,
  HDB_FALLBACK,
  evidenceFor,
  emptyCache,
} from '../src/lib/schema';
import { mergeFeed } from '../src/lib/data';
import seed from './fixtures/feed.json';

const html = readFileSync(new URL('fixtures/cpf-askgov.html', import.meta.url), 'utf8');
const primary = readFileSync(new URL('fixtures/hdb.html', import.meta.url), 'utf8');
const at = '2026-11-01T04:00:00.000Z';
const previous = FeedSchema.parse(seed);
const pause = async () => {};
const parse = (content = html, when = at) => parseHdbAskGov(nodePage(content), when)[0];

describe('official AskGov HDB quarter', () => {
  it('extracts an explicit HDB rate, period and publisher without treating page age as observation time', () => {
    const offer = parse(html.replace('Updated by CPF', 'Updated by CPF 1mo ago'));
    expect(offer).toMatchObject({
      id: 'hdb-concessionary',
      sourceId: 'hdb',
      evidenceSourceId: 'cpf-askgov',
      observedAt: at,
      effectiveFrom: '2026-10-01',
      effectiveUntil: '2026-12-31',
      method: 'collector',
    });
    expect(offer.stages[0].rate).toBe(2.6);
    expect(offer.documentDate).toBeUndefined();
    expect(evidenceFor(offer).url).toBe(HDB_FALLBACK.url);
  });
  it('uses Singapore midnight at both ends of the quarter, including the primary parser', () => {
    expect(() => parse(html, '2026-09-30T15:59:59.999Z')).toThrow('does not cover');
    expect(parse(html, '2026-09-30T16:00:00.000Z').effectiveFrom).toBe('2026-10-01');
    expect(parse(html, '2026-12-31T15:59:59.999Z').effectiveUntil).toBe('2026-12-31');
    expect(() => parse(html, '2026-12-31T16:00:00.000Z')).toThrow('does not cover');
    expect(() => parseHdb(nodePage(primary), '2026-12-31T16:00:00.000Z', 'collector')).toThrow();
  });
  it('accepts consistent published changes without hardcoding the observed rate', () => {
    expect(parse(html.replace('2.50%', '2.65%').replace('2.60%', '2.75%')).stages[0].rate).toBe(
      2.75,
    );
  });
  it('rejects missing, ambiguous, inconsistent and invalid-quarter content', () => {
    for (const bad of [
      html.replace('Updated by CPF', 'Updated by another agency'),
      html.replace('Updated by CPF', 'Updated by CPFake'),
      html.replace('HDB mortgage rate for', 'Other mortgage rate for'),
      html.replace('2.60%', 'Not published'),
      html.replace('2.60%', '2.70%'),
      html.replace('0.10%', '0.20%'),
      html.replace('1 October 2026', '2 October 2026'),
      html.replace(/31\s+December/, '32 December'),
      html.replaceAll('October 2026 to December 2026', 'July 2026 to September 2026'),
      html + html,
      '<html>Temporarily unavailable</html>',
    ])
      expect(() => parse(bad)).toThrow();
  });
  it('rejects cross-source provenance and incomplete fallback status on imported data', () => {
    expect(() => OfferSchema.parse({ ...parse(), sourceId: 'dbs-hdb' })).toThrow();
    expect(() => OfferSchema.parse({ ...parse(), effectiveUntil: undefined })).toThrow();
    expect(() =>
      SourceStatusSchema.parse({
        sourceId: 'hdb',
        attemptedAt: at,
        status: 'ok',
        message: '',
        fallbackSourceId: 'cpf-askgov',
      }),
    ).toThrow();
  });
});

describe('HDB primary → official fallback → retained observation', () => {
  it('uses the primary without requesting AskGov when its current table is valid', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(primary));
    const result = await collect(previous, fetcher, at, ['hdb'], pause);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.sources[0].fallbackSourceId).toBeUndefined();
    expect(result.offers.find((o) => o.sourceId === 'hdb')?.evidenceSourceId).toBeUndefined();
  });
  it('falls back after one primary 403 and retains the primary denial separately', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
      .mockResolvedValueOnce(new Response(html));
    const result = await collect(previous, fetcher, at, ['hdb'], pause);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe(HDB_FALLBACK.url);
    expect(result.sources[0]).toMatchObject({
      status: 'ok',
      fallbackSourceId: 'cpf-askgov',
      attempts: 1,
      primaryFailure: { failureKind: 'http', httpStatus: 403, attempts: 1 },
    });
    expect(result.offers.filter((o) => o.sourceId === 'hdb')).toEqual([parse()]);
    expect(result.offers.filter((o) => o.sourceId !== 'hdb')).toEqual(
      previous.offers.filter((o) => o.sourceId !== 'hdb'),
    );
  });
  it('uses AskGov after a primary parse failure and bounds retries independently', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('<html>New layout</html>'))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(html));
    const wait = vi.fn().mockResolvedValue(undefined);
    const result = await collect(previous, fetcher, at, ['hdb'], wait);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledExactlyOnceWith(2000);
    expect(result.sources[0]).toMatchObject({
      status: 'ok',
      attempts: 2,
      primaryFailure: { failureKind: 'parse', attempts: 1 },
    });
  });
  it('retains every prior value and date when both endpoints are denied', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () => new Response('Forbidden', { status: 403 }));
    const result = await collect(previous, fetcher, at, ['hdb'], pause);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.offers).toEqual(previous.offers);
    expect(result.sources[0]).toMatchObject({
      status: 'error',
      failureKind: 'http',
      httpStatus: 403,
      attempts: 1,
      fallbackSourceId: 'cpf-askgov',
      primaryFailure: { httpStatus: 403 },
    });
  });
  it('does not renew an expired quarter or retry its parser; preserves last success', async () => {
    const retained = FeedSchema.parse({
      ...previous,
      offers: [parse()],
      sources: [
        {
          sourceId: 'hdb',
          status: 'ok',
          message: 'previous extraction',
          attemptedAt: at,
          successAt: at,
        },
      ],
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
      .mockResolvedValueOnce(new Response(html));
    const result = await collect(retained, fetcher, '2026-12-31T16:00:00.000Z', ['hdb'], pause);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.offers).toEqual(retained.offers);
    expect(result.sources[0]).toMatchObject({
      status: 'error',
      failureKind: 'parse',
      attempts: 1,
      successAt: at,
    });
  });
  it('clears fallback provenance when the primary recovers without inventing a rate-change history', async () => {
    const cache = mergeFeed(emptyCache(), { ...previous, offers: [parse()] }, at);
    const next = await collect(
      { ...previous, offers: [parse()] },
      vi.fn().mockResolvedValue(new Response(primary)),
      '2026-11-02T04:00:00.000Z',
      ['hdb'],
      pause,
    );
    const merged = mergeFeed(cache, next, '2026-11-02T04:00:00.000Z');
    expect(merged.offers[0].evidenceSourceId).toBeUndefined();
    expect(merged.history).toHaveLength(0);
    expect(merged.offers).toHaveLength(1);
  });
});
