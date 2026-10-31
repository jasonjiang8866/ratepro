import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseUobSora } from '../src/lib/parsers';
import { nodePage, collect } from '../scripts/collect';
import { parseCiti, pdfText } from '../scripts/citi';
import { retrieve } from '../scripts/retrieval';
import { FeedSchema } from '../src/lib/schema';
import { matchesProperty, offerPayment } from '../src/lib/data';
import seed from './fixtures/feed.json';
const at = '2026-10-31T12:00:00.000Z';
const uob = readFileSync(new URL('fixtures/uob.html', import.meta.url), 'utf8');
const citi = readFileSync(new URL('fixtures/citi-layout.txt', import.meta.url), 'utf8');
describe('expanded official schedules', () => {
  it('extracts the complete UOB schedule with eligibility and commitment', () => {
    const [o] = parseUobSora(nodePage(uob), at, 'collector');
    expect(o.stages.map((s) => s.benchmark?.spread)).toEqual([0.7, 0.7, 0.8, 1]);
    expect(o.minLoan).toBe(250000);
    expect(o.lockYears).toBe(2);
    expect(o.terms).toContain('direct-to-bank');
    expect(o.construction).toBe('Completed');
    expect(offerPayment(o, 500000, 25)).toBeNull();
  });
  it('rejects missing UOB rows, duplicates and changed eligibility', () => {
    for (const html of [
      uob.replace('Year 2', 'Year 20'),
      uob + uob,
      uob.replace('completed residential', 'commercial'),
      uob.replace('3M Compounded SORA', '1M Compounded SORA'),
    ])
      expect(() => parseUobSora(nodePage(html), at, 'collector')).toThrow();
  });
  it('keeps Citi tiers, bands, floor and print date separate from observations', () => {
    const o = parseCiti(citi, at, 'collector');
    expect(o).toHaveLength(4);
    expect(o.map((v) => v.stages.map((s) => s.benchmark?.spread))).toEqual([
      [0.45, 0.45, 0.6, 0.85],
      [0.55, 0.55, 0.7, 0.85],
      [0.95, 0.95, 1, 1],
      [1, 1, 1, 1],
    ]);
    expect(o[0].minRelationshipBalance).toBe(250000);
    expect(o[2].minRelationshipBalance).toBeUndefined();
    expect(o[1].maxLoanExclusive).toBe(1000000);
    expect(o[0].maxLoanExclusive).toBeUndefined();
    expect(
      o.every(
        (v) => v.rateFloor === 0.85 && v.documentDate === '2026-09-30' && v.observedAt === at,
      ),
    ).toBe(true);
    expect(o[0].effectiveFrom).toBeUndefined();
    expect(matchesProperty(o[0], 'HDB')).toBe(false);
    expect(offerPayment(o[0], 500000, 25)).toBeNull();
  });
  it('rejects PDF ambiguity, shifted tenor, missing columns and loan bands', () => {
    for (const bad of [
      citi + citi,
      citi.replace('Printed on 30/09/2026', 'Printed on 30/09/2027'),
      citi.replace('Printed on 30/09/2026', 'Printed on 31/09/2026'),
      citi.replace('1M Compounded SORA', '3M Compounded SORA'),
      citi.replace('+ 0.45% p.a.', ''),
      citi.replace('(less than S$1,000,000)', ''),
      citi.replace('AUM≥S$250,000', 'AUM not specified'),
    ])
      expect(() => parseCiti(bad, at, 'collector')).toThrow();
  });
  it('rejects HTML returned instead of PDF before launching the extractor', async () => {
    await expect(pdfText(new TextEncoder().encode('<html>Access denied</html>'))).rejects.toThrow(
      'PDF',
    );
  });
});
describe('bounded retrieval recovery', () => {
  it('retries a transient 503 once with a delay and then succeeds', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok'));
    const pause = vi.fn().mockResolvedValue(undefined),
      attempts = vi.fn();
    expect(
      new TextDecoder().decode(
        await retrieve('https://example.test', fetcher, 100, attempts, pause),
      ),
    ).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledWith(2000);
  });
  it.each([401, 403, 404, 429])('does not retry HTTP %s', async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('unavailable', { status }));
    await expect(
      retrieve(
        'https://example.test',
        fetcher,
        100,
        () => {},
        async () => {},
      ),
    ).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retains data and records a timeout after exactly two attempts', async () => {
    const previous = FeedSchema.parse(seed);
    const fetcher = vi.fn().mockRejectedValue(new DOMException('slow', 'TimeoutError'));
    const result = await collect(previous, fetcher, at, ['maybank'], async () => {});
    expect(result.offers).toEqual(previous.offers);
    expect(result.sources[0]).toMatchObject({
      status: 'error',
      failureKind: 'timeout',
      attempts: 2,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not retry a changed table and retains previous observations', async () => {
    const previous = FeedSchema.parse({
      ...seed,
      offers: [...seed.offers, ...parseUobSora(nodePage(uob), at, 'collector')],
    });
    const fetcher = vi.fn().mockResolvedValue(new Response('<html>New layout</html>'));
    const result = await collect(
      previous,
      fetcher,
      '2026-11-01T00:00:00.000Z',
      ['uob-sora'],
      async () => {},
    );
    expect(result.offers).toEqual(previous.offers);
    expect(result.sources[0]).toMatchObject({ failureKind: 'parse', attempts: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
