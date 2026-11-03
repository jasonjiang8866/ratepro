import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseJapan } from '../scripts/japan-parsers';
import { collectJapan } from '../scripts/collect-japan';
import { JpFeedSchema, japanMonth, jpFreshness, type JpFeed } from '../src/lib/japan-rates';
const at = '2026-11-03T06:00:00Z';
const mufg = readFileSync('tests/fixtures/japan/mufg.html');
const smbc = Buffer.from(readFileSync('tests/fixtures/japan/smbc.shift-jis.b64', 'utf8'), 'base64');
const empty: JpFeed = {
  version: 1,
  market: 'JP',
  currency: 'JPY',
  generatedAt: at,
  observations: [],
  sources: [],
};
const fetcher: typeof fetch = async (url) =>
  new Response(new Uint8Array(String(url).includes('mufg') ? mufg : smbc));
const edit = (from: string, to: string) =>
  new TextEncoder().encode(mufg.toString().replaceAll(from, to));
describe('Japan rate collection', () => {
  it('validates the published Japan snapshot', () => {
    expect(() =>
      JpFeedSchema.parse(JSON.parse(readFileSync('public/data/rates-jp.json', 'utf8'))),
    ).not.toThrow();
  });
  it('separates applied/reference rates, purchase/refinance and initial/full-term fixed periods', () => {
    const o = parseJapan('jp-mufg', mufg, at);
    expect(o.rates).toHaveLength(16);
    expect(o.publicationMonth).toBe('2026-11');
    expect(o.rates.find((r) => r.kind === 'Variable' && r.purpose === 'Purchase')).toMatchObject({
      annualRate: 1.195,
      referenceRate: 3.375,
    });
    expect(
      o.rates.find((r) => r.kind === 'Variable' && r.purpose === 'Refinance')?.annualRate,
    ).toBe(1.245);
    expect(o.rates.find((r) => r.kind === 'Initial fixed' && r.term === '10年')?.annualRate).toBe(
      3.89,
    );
    expect(o.conditions).toContain('当初固定期間終了後');
    expect(o.conditions).toContain('2.2');
  });
  it('decodes Shift-JIS and does not collect car loans or Flat35 as mortgage table rows', () => {
    const o = parseJapan('jp-smbc', smbc, at);
    expect(o.rates).toHaveLength(23);
    expect(o.rates.filter((r) => r.purpose === 'Purchase')).toHaveLength(11);
    expect(o.rates.find((r) => r.kind === 'Variable')?.annualRate).toBe(3.375);
    expect(o.rates.every((r) => !/マイカー|フラット/.test(r.label))).toBe(true);
    expect(o.conditions).toContain('not discounted offers');
  });
  it.each([
    ['1.195', '1.195～1.495'],
    ['固定10年', '固定11年'],
    ['2026年11月にお借り入れの場合', '最新の金利'],
    ['2026年11月', '2026年12月'],
    ['日本国籍', 'UNKNOWN'],
    ['当初固定期間終了後は、', 'UNKNOWN'],
  ])('fails closed on ambiguous/changed source: %s', (from, to) => {
    expect(() => parseJapan('jp-mufg', edit(from, to), at)).toThrow();
  });
  it('preserves failed-source observation dates while updating a successful source', async () => {
    const previous = await collectJapan(empty, fetcher, at);
    const next = await collectJapan(
      previous,
      async (url) =>
        String(url).includes('mufg') ? new Response('denied', { status: 403 }) : fetcher(url),
      '2026-11-04T06:00:00Z',
    );
    expect(next.observations.find((o) => o.sourceId === 'jp-mufg')).toEqual(
      previous.observations[0],
    );
    expect(next.sources[0]).toMatchObject({ status: 'error', attempts: 1, successAt: at });
    expect(next.observations.find((o) => o.sourceId === 'jp-smbc')?.observedAt).toBe(
      next.generatedAt,
    );
  });
  it('rejects regressions and keeps old observations on total failure', async () => {
    const previous = await collectJapan(empty, fetcher, at);
    const next = await collectJapan(
      previous,
      async () => new Response(edit('2026年11月', '2026年10月')),
      '2026-11-04T06:00:00Z',
    );
    expect(next.observations).toEqual(previous.observations);
    expect(next.sources.every((s) => s.status === 'error')).toBe(true);
  });
  it('does not mix markets, currencies, duplicate sources or future observations', () => {
    expect(() => JpFeedSchema.parse({ ...empty, market: 'SG' })).toThrow();
    expect(() => JpFeedSchema.parse({ ...empty, currency: 'SGD' })).toThrow();
    const o = parseJapan('jp-mufg', mufg, at);
    expect(() => JpFeedSchema.parse({ ...empty, observations: [o, o] })).toThrow();
    expect(() =>
      JpFeedSchema.parse({
        ...empty,
        observations: [{ ...o, observedAt: '2026-11-04T06:00:00Z' }],
      }),
    ).toThrow();
    expect(japanMonth(new Date('2026-11-30T15:00:00Z'))).toBe('2026-12');
    expect(jpFreshness(o, new Date('2026-12-01T00:00:00Z'))).toBe('Previous publication month');
    expect(jpFreshness(o, new Date('2026-11-06T00:00:00Z'))).toBe('Check overdue');
  });
});
