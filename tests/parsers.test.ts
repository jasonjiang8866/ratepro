import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import seed from './fixtures/feed.json';
import { FeedSchema, SOURCES, StageSchema } from '../src/lib/schema';
import {
  parseDbsHdb,
  parseDbsGreen,
  parseHdb,
  parseMaybank,
  parseScSora,
} from '../src/lib/parsers';
import {
  compareInitialRates,
  stageDisplay,
  offerPayment,
  matchesProperty,
  mergeFeed,
} from '../src/lib/data';
import { emptyCache } from '../src/lib/schema';
import { nodePage, collect } from '../scripts/collect';
const at = '2026-10-30T02:00:00.000Z';
const html = (name: string) =>
  readFileSync(new URL(`fixtures/${name}.html`, import.meta.url), 'utf8');
describe('source-specific extraction', () => {
  it('extracts CPF-OA rates, all stages and minimum loan', () => {
    const [o] = parseDbsHdb(nodePage(html('dbs-hdb')), at, 'collector');
    expect(o.stages.map((s) => s.rate)).toEqual([1.78, 2.2, 2.4]);
    expect(o.kind).toBe('Floating');
    expect(o.minLoan).toBe(100000);
    expect(o.lockYears).toBe(3);
  });
  it('extracts all-in FHR6 rate rather than the spread', () => {
    const [o] = parseDbsGreen(nodePage(html('dbs-green')), at, 'collector');
    expect(o.stages[0].rate).toBe(1.48);
    expect(o.stages[0].formula).toBe('FHR6 + 0.68%');
    expect(o.minLoan).toBe(1000000);
  });
  it('uses only the current HDB quarter and excludes the historical market rate', () => {
    const [o] = parseHdb(nodePage(html('hdb')), at, 'collector');
    expect(o.stages[0].rate).toBe(2.6);
    expect(o.effectiveUntil).toBe('2026-12-31');
  });
  it('fails closed when layout changes, values disappear, or a block page is returned', () => {
    expect(() => parseDbsHdb(nodePage('<h1>Access denied</h1>'), at, 'collector')).toThrow();
    expect(() =>
      parseDbsHdb(nodePage(html('dbs-hdb').replace('CPF-OA', 'New benchmark')), at, 'collector'),
    ).toThrow();
    expect(() =>
      parseDbsGreen(nodePage(html('dbs-green').replace('All-in rate:', 'Total:')), at, 'collector'),
    ).toThrow();
    expect(() =>
      parseHdb(nodePage(html('hdb')), '2027-02-01T00:00:00.000Z', 'collector'),
    ).toThrow();
  });
  it('supports whitespace variation and ignores irrelevant content', () => {
    const p = nodePage('<script>evil()</script>' + html('dbs-green').replaceAll('FHR6', 'FHR6\n'));
    expect(p.text).not.toContain('evil');
    expect(parseDbsGreen(p, at, 'collector')[0].stages[0].rate).toBe(1.48);
  });
  it('keeps a failing source while updating successful sources', async () => {
    const previous = FeedSchema.parse(seed);
    const result = await collect(
      previous,
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes('hdb.gov')) return new Response('blocked', { status: 403 });
        return new Response(html(String(url).includes('green') ? 'dbs-green' : 'dbs-hdb'));
      }),
      '2026-11-01T00:00:00.000Z',
    );
    expect(result.sources.map((s) => s.status)).toEqual([
      'ok',
      'ok',
      ...SOURCES.slice(2).map(() => 'error'),
    ]);
    expect(result.offers[0].observedAt).toBe(previous.offers[0].observedAt);
    expect(result.offers[1].observedAt).toContain('2026-11-01');
  });
});

describe('expanded official schedules', () => {
  const observed = '2026-10-31T09:00:00.000Z';
  const maybank = () => parseMaybank(nodePage(html('maybank')), observed, 'collector');
  const sc = () => parseScSora(nodePage(html('sc')), observed, 'collector');
  it('extracts four completed-property packages and fixed-to-SORA transitions', () => {
    const offers = maybank();
    expect(offers).toHaveLength(4);
    expect(offers.map((o) => o.stages[0].rate)).toEqual([3.3, 3.75, null, null]);
    expect(offers.map((o) => o.lockYears)).toEqual([2, 3, 2, 2]);
    expect(offers.every((o) => o.minLoan === 100000 && o.construction === 'Completed')).toBe(true);
    expect(offers[0].stages.at(-1)).toMatchObject({
      rate: null,
      benchmark: { name: 'SORA', tenor: '1M', spread: 1 },
    });
    expect(offers[2].stages[0].benchmark?.spread).toBe(0.8);
    expect(offers[3].stages[0].benchmark?.tenor).toBe('3M');
    expect(offers[3].stages[0].benchmark?.spread).toBe(0.7);
  });
  it('preserves the source effective date separately from a fresh SC observation', () => {
    const [o] = sc();
    expect(o.observedAt).toBe(observed);
    expect(o.effectiveFrom).toBe('2021-02-27');
    expect(o.stages.map((s) => s.rate)).toEqual([null, null, null, null]);
    expect(o.stages.map((s) => s.benchmark?.spread)).toEqual([1, 1, 1, 1]);
    expect(o.minLoan).toBe(100000);
    expect(o.lockYears).toBe(2);
    expect(o.property).toBe('HDB / Private');
  });
  it.each([
    ['maybank', '3.30% p.a.', 'Contact us'],
    ['maybank', 'Year 2', 'Year 7'],
    ['maybank', '1M Compounded SORA + 0.80%', '1M Compounded SORA - 0.80%'],
    ['maybank', 'minimum loan size', 'loan size'],
    ['sc', '3M Compounded SORA + 1.00%', '1M Compounded SORA + 1.00%'],
    ['sc', '27 February 2021', '27 February 2099'],
    ['sc', 'S$100,000', 'Contact us'],
  ])('fails closed when %s data changes (%s)', (source, from, to) => {
    const parser = source === 'maybank' ? parseMaybank : parseScSora;
    expect(() => parser(nodePage(html(source).replace(from, to)), observed, 'collector')).toThrow();
  });
  it('rejects duplicate tables/rows and blocked pages instead of taking the first match', () => {
    const p = nodePage(html('maybank'));
    expect(() =>
      parseMaybank({ ...p, tables: [...p.tables, p.tables[0]] }, observed, 'collector'),
    ).toThrow();
    p.tables[0].push([...p.tables[0][1]]);
    expect(() => parseMaybank(p, observed, 'collector')).toThrow();
    expect(() => parseScSora(nodePage('<h1>Access denied</h1>'), observed, 'collector')).toThrow();
  });
  it('never permits a spread to masquerade as an all-in rate', () => {
    const stage = sc()[0].stages[0];
    expect(() => StageSchema.parse({ ...stage, rate: 1 })).toThrow();
    expect(() =>
      StageSchema.parse({ label: 'Year 1', rate: null, formula: 'Unavailable' }),
    ).toThrow();
    expect(() => StageSchema.parse({ ...stage, formula: '3M Compounded SORA + 0.01%' })).toThrow();
    expect(stageDisplay(stage)).toBe('3M Compounded SORA + 1.00%');
    expect(offerPayment(sc()[0], 500000, 25)).toBeNull();
    expect(offerPayment(maybank()[0], 500000, 25)).toBeGreaterThan(0);
  });
  it('puts formulas after numerical rates in both directions and supports property filters', () => {
    const offers = [...sc(), ...maybank()];
    expect(
      [...offers].sort((a, b) => compareInitialRates(a, b)).map((o) => o.stages[0].rate),
    ).toEqual([3.3, 3.75, null, null, null]);
    expect(
      [...offers].sort((a, b) => compareInitialRates(a, b, true)).map((o) => o.stages[0].rate),
    ).toEqual([3.75, 3.3, null, null, null]);
    expect(matchesProperty(sc()[0], 'HDB')).toBe(true);
    expect(matchesProperty(sc()[0], 'Private')).toBe(true);
  });
  it('retains entire failed-source observations while another source updates', async () => {
    const previous = FeedSchema.parse({ ...seed, offers: [...seed.offers, ...maybank(), ...sc()] });
    const result = await collect(
      previous,
      vi.fn(async (url) => {
        if (String(url).includes('maybank')) return new Response('blocked', { status: 403 });
        if (String(url).includes('sc.com'))
          return new Response(html('sc').replace('1.00%', '1.10%'));
        return new Response('unavailable', { status: 503 });
      }),
      '2026-11-01T00:00:00.000Z',
      SOURCES.map((s) => s.id),
      async () => {},
    );
    expect(result.offers.filter((o) => o.sourceId === 'maybank')).toEqual(
      previous.offers.filter((o) => o.sourceId === 'maybank'),
    );
    expect(result.offers.find((o) => o.sourceId === 'hdb')).toEqual(
      previous.offers.find((o) => o.sourceId === 'hdb'),
    );
    expect(result.offers.find((o) => o.sourceId === 'sc-sora')?.stages[0].benchmark?.spread).toBe(
      1.1,
    );
    expect(result.sources).toHaveLength(SOURCES.length);
    const cache = mergeFeed(
      mergeFeed(emptyCache(), previous, '2026-11-02T00:00:00.000Z'),
      result,
      '2026-11-02T00:00:00.000Z',
    );
    expect(cache.history).toHaveLength(1);
    expect(cache.history[0].offer.sourceId).toBe('sc-sora');
    expect(cache.history[0].offer.stages[0].benchmark?.spread).toBe(1);
  });
});
