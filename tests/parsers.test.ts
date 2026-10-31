import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import seed from './fixtures/feed.json';
import { FeedSchema } from '../src/lib/schema';
import { parseDbsHdb, parseDbsGreen, parseHdb } from '../src/lib/parsers';
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
    expect(result.sources.map((s) => s.status)).toEqual(['ok', 'ok', 'error']);
    expect(result.offers[0].observedAt).toBe(previous.offers[0].observedAt);
    expect(result.offers[1].observedAt).toContain('2026-11-01');
  });
});
