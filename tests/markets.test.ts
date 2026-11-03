import { describe, it, expect } from 'vitest';
import {
  markets,
  MARKET_CODES,
  resolveMarket,
  marketDay,
  marketMoney,
  articleHref,
} from '../src/lib/markets';
import { ArticleSchema, validateArticles, editorialStatus } from '../src/lib/editorial';
import baseline from '../content/insights/2026-11-hdb-quarter.json';

describe('market isolation and legacy navigation', () => {
  it('keeps explicit and old shared links independent of saved preferences', () => {
    expect(resolveMarket('?market=JP', '#/rates', 'SG')).toBe('JP');
    expect(resolveMarket('?market=sg', '#/home', 'JP')).toBe('SG');
    expect(resolveMarket('', '#/rates', 'JP')).toBe('SG');
    expect(resolveMarket('', '#/read/old-sg-report', 'JP', 'SG')).toBe('SG');
    expect(resolveMarket('', '#/read/jp-guide', 'SG', 'JP')).toBe('JP');
    expect(resolveMarket('', '', 'JP')).toBe('JP');
    expect(resolveMarket('?market=UNKNOWN', '#/rates', 'JP')).toBe('SG');
    expect(resolveMarket('', '', '{bad-json')).toBe('SG');
    expect(articleHref({ market: 'JP', slug: 'jp-guide' })).toBe('?market=JP#/read/jp-guide');
  });
  it('uses local calendar boundaries and yen formatting', () => {
    const boundary = new Date('2026-11-30T15:00:00Z');
    expect(marketDay(boundary, 'JP')).toBe('2026-12-01');
    expect(marketDay(boundary, 'SG')).toBe('2026-11-30');
    expect(marketMoney(123456.7, 'JP')).toMatch(/123,457/);
    expect(marketMoney(123456.7, 'JP')).not.toContain('S$');
  });
  it('keeps legacy records valid but rejects unknown markets', () => {
    const { market: _, ...legacy } = baseline;
    expect(ArticleSchema.parse(legacy).market).toBe('SG');
    expect(() => ArticleSchema.parse({ ...baseline, market: 'US' })).toThrow();
    expect(markets.map((m) => m.code)).toEqual([...MARKET_CODES]);
  });
  it('validates and expires each record using its own local day', () => {
    const a = {
      ...baseline,
      market: 'JP',
      reportDate: '2026-12-01',
      effectiveUntil: '2026-11-30',
      sources: baseline.sources.map((s) => ({ ...s, checkedAt: '2026-11-30T15:01:00Z' })),
    };
    const now = new Date('2026-11-30T15:02:00Z');
    const [jp] = validateArticles([a], now);
    expect(editorialStatus(jp, now)).toBe('Period ended');
    expect(() => validateArticles([{ ...a, market: 'SG' }], now)).toThrow('Future report');
  });
  it('cannot supersede another market, but event keys are country-scoped', () => {
    const now = new Date('2026-11-04T00:00:00Z');
    const japan = { ...baseline, market: 'JP', slug: 'jp-baseline', reportDate: '2026-11-03' };
    expect(validateArticles([baseline, japan], now)).toHaveLength(2);
    expect(() =>
      validateArticles(
        [
          baseline,
          { ...japan, eventKey: 'correction', reportDate: '2026-11-03', supersedes: baseline.slug },
        ],
        now,
      ),
    ).toThrow('Invalid supersedes');
  });
});
