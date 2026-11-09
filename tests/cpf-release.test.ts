import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { collect } from '../scripts/collect';
import { cpfReleaseCurrent, parseCpfRelease } from '../scripts/cpf-release';
import { CPF_RELEASE, FeedSchema, evidenceFor, isStale } from '../src/lib/schema';

const html = readFileSync(new URL('fixtures/cpf-release.html', import.meta.url), 'utf8');
const at = '2026-11-09T16:00:00.000Z';
const previous = FeedSchema.parse(JSON.parse(readFileSync('public/data/rates.json', 'utf8')));
const pause = async () => {};

describe('dated CPF announcement fallback', () => {
  it('extracts explicit HDB rate, quarter and publication date with actual provenance', () => {
    const [offer] = parseCpfRelease(html, at);
    expect(offer).toMatchObject({
      id: 'hdb-concessionary',
      method: 'collector',
      evidenceSourceId: 'cpf-release',
      observedAt: at,
      documentDate: '2026-09-22',
      effectiveFrom: '2026-10-01',
      effectiveUntil: '2026-12-31',
      stages: [{ rate: 2.6, formula: 'CPF-OA + 0.10%' }],
    });
    expect(evidenceFor(offer).url).toBe(CPF_RELEASE.url);
    expect(isStale(offer, Date.parse('2026-12-31T16:00:00Z'))).toBe(true);
  });
  it.each([
    html.replaceAll('CPF Board', 'Unknown publisher'),
    html.replace('22 September 2026', '23 September 2026'),
    html.replace('concessionary interest rate for HDB housing loans', 'market interest rate'),
    html.replace('Remains unchanged at 2.6%', 'Remains unchanged at 2.7%'),
    html.replace('floor rate of 2.5%', 'floor rate of 2.4%'),
    html.replace('pegged at 0.1%', 'pegged at 0.2%'),
    html.replace(
      'from 1 October to 31 December 2026, as the OA',
      'from 1 July to 30 September 2026, as the OA',
    ),
    html + html,
    '<html><body><webruntime-app></webruntime-app></body></html>',
  ])('rejects absent, conflicting or ambiguous publication fields', (bad) => {
    expect(() => parseCpfRelease(bad, at)).toThrow();
  });
  it('expires at the Singapore quarter boundary, despite the title mentioning 2027', () => {
    expect(cpfReleaseCurrent('2026-12-31T15:59:59.999Z')).toBe(true);
    expect(cpfReleaseCurrent('2026-12-31T16:00:00Z')).toBe(false);
    expect(() => parseCpfRelease(html, '2026-12-31T16:00:00Z')).toThrow();
    expect(() => parseCpfRelease(html, '2026-09-30T15:59:59Z')).toThrow();
  });
  it('keeps both denials, then validates a separate public announcement without retrying 403s', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('denied', { status: 403 }))
      .mockResolvedValueOnce(new Response('challenge', { status: 403 }))
      .mockResolvedValueOnce(new Response(html));
    const feed = await collect(previous, fetcher, at, ['hdb'], pause);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2][0]).toBe(CPF_RELEASE.url);
    expect(feed.sources[0]).toMatchObject({
      status: 'ok',
      successAt: at,
      fallbackSourceId: 'cpf-release',
      primaryFailure: { httpStatus: 403, attempts: 1 },
      fallbackFailures: [{ sourceId: 'cpf-askgov', httpStatus: 403, attempts: 1 }],
    });
    expect(feed.offers.find((o) => o.sourceId === 'hdb')).toEqual(parseCpfRelease(html, at)[0]);
    expect(feed.offers.filter((o) => o.sourceId !== 'hdb')).toEqual(
      previous.offers.filter((o) => o.sourceId !== 'hdb'),
    );
  });
  it('retains values, review provenance and last success when the release is only an app shell', async () => {
    const retained = {
      ...previous,
      sources: [
        {
          sourceId: 'hdb' as const,
          status: 'ok' as const,
          attemptedAt: '2026-10-30T01:50:00Z',
          successAt: '2026-10-30T01:50:00Z',
          message: 'prior success',
        },
      ],
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('denied', { status: 403 }))
      .mockResolvedValueOnce(new Response('denied', { status: 403 }))
      .mockResolvedValueOnce(new Response('<webruntime-app></webruntime-app>'));
    const feed = await collect(retained, fetcher, at, ['hdb'], pause);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(feed.offers).toEqual(previous.offers);
    expect(feed.sources[0]).toMatchObject({
      status: 'error',
      failureKind: 'parse',
      successAt: retained.sources[0].successAt,
      attemptedAt: at,
      fallbackSourceId: 'cpf-release',
    });
  });
});
