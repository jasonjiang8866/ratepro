import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSbi } from '../src/lib/parsers';
import { parseCiti } from '../scripts/citi';
import { nodePage, collect, writeSnapshot } from '../scripts/collect';
import { healthMarkdown, validateCollectedGroup } from '../scripts/source-health';
import { FeedSchema } from '../src/lib/schema';
import baseline from './fixtures/feed.json';
import { offerPayment } from '../src/lib/data';
const at = '2026-11-14T12:00:00.000Z';
const sbi = readFileSync(new URL('./fixtures/sbi.html', import.meta.url), 'utf8');
const citi = readFileSync(new URL('./fixtures/citi-layout.txt', import.meta.url), 'utf8');

describe('SBI official product coverage', () => {
  it('extracts three schedules, distinct minimums and BUC eligibility', () => {
    const offers = parseSbi(nodePage(sbi), at, 'collector');
    expect(offers.map((o) => o.id)).toEqual(['sbi-sora-2y', 'sbi-sora-3y', 'sbi-fixed-2y']);
    expect(offers.map((o) => o.minLoan)).toEqual([250000, 250000, 400000]);
    expect(offers.map((o) => o.lockYears)).toEqual([2, 3, 2]);
    expect(offers.map((o) => o.construction)).toEqual(['Completed', 'Any', 'Completed']);
    expect(offers[0].stages.map((s) => s.benchmark?.spread)).toEqual([0.5, 0.5, 1]);
    expect(offers[1].stages.map((s) => s.benchmark?.spread)).toEqual([0.75, 0.75, 0.75, 1]);
    expect(offers[2].stages.map((s) => s.rate)).toEqual([2.25, 2.25, null]);
    expect(offers[2].stages[2].benchmark?.spread).toBe(0.65);
    expect(offers.every((o) => o.effectiveFrom === undefined)).toBe(true);
  });
  it('rejects missing/duplicate rows, wrong tenors and changed scope', () => {
    for (const bad of [
      sbi + sbi,
      sbi.replace('3 onwards', '4 onwards'),
      sbi.replace('3M Comp SORA + 0.50%', '1M Comp SORA + 0.50%'),
      sbi.replace('2.25% Fixed', 'Call for quote'),
      sbi.replace('Minimum SGD 400,000', 'Minimum not stated'),
      sbi.replace('are only eligible', 'are also eligible'),
    ])
      expect(() => parseSbi(nodePage(bad), at, 'collector')).toThrow();
  });
  it('updates the full group and retains it unchanged after a source failure', async () => {
    const previous = FeedSchema.parse(baseline);
    const good = await collect(previous, vi.fn().mockResolvedValue(new Response(sbi)), at, ['sbi']);
    expect(good.sources[0].status).toBe('ok');
    expect(good.offers.filter((o) => o.sourceId === 'sbi')).toHaveLength(3);
    const bad = await collect(
      good,
      vi.fn().mockResolvedValue(new Response(sbi.replace('3 onwards', 'changed'))),
      '2026-11-15T12:00:00.000Z',
      ['sbi'],
    );
    expect(bad.offers).toEqual(good.offers);
    expect(bad.sources[0].failureKind).toBe('parse');
  });
});

describe('Citi fixed and construction schedules', () => {
  it('keeps fixed years, post-fixed spreads, tiers and BUC terms distinct', () => {
    const offers = parseCiti(citi, at, 'collector');
    expect(offers).toHaveLength(9);
    const fixed = offers.filter((o) => o.kind === 'Fixed');
    expect(fixed.map((o) => o.stages.map((s) => s.rate))).toEqual([
      [2.1, 2.1, null, null],
      [2, 2, null, null],
      [2.15, 2.15, null, null],
      [2.25, 2.25, null, null],
    ]);
    expect(fixed.map((o) => o.stages[2].benchmark?.spread)).toEqual([0.85, 0.85, 1, 1]);
    expect(fixed.every((o) => o.construction === 'Confirm with lender')).toBe(true);
    expect(offerPayment(fixed[0], 1000000, 25)).toBeNull();
    expect(fixed.map((o) => o.maxLoanExclusive)).toEqual([undefined, 1000000, undefined, 1000000]);
    const buc = offers.find((o) => o.id === 'citi-citigold-sora-buc')!;
    expect(buc).toMatchObject({
      lockYears: 0,
      minLoan: 1500000,
      minRelationshipBalance: 250000,
      construction: 'Under construction',
    });
    expect(buc.stages.map((s) => s.benchmark?.spread)).toEqual([1, 1, 1, 1, 1]);
  });
  it('fails the complete publication if any fixed or BUC column changes', () => {
    for (const bad of [
      citi.replace('2.10% p.a. Fixed', ''),
      citi.replace('2.10% p.a. Fixed', '2.10% p.a. Floating'),
      citi.replace('Year 5 and onwards', 'Year 6 and onwards'),
      citi.replace('(No Lock-in)', '(1-year Lock-in)'),
      citi.replace('S$1,500,000', 'not specified'),
    ])
      expect(() => parseCiti(bad, at, 'collector')).toThrow();
  });
  it('accepts changed published prices without hard-coded rate values', () => {
    expect(
      parseCiti(citi.replaceAll('2.10% p.a. Fixed', '2.30% p.a. Fixed'), at, 'collector').find(
        (o) => o.id === 'citi-citigold-fixed-2y-large',
      )?.stages[0].rate,
    ).toBe(2.3);
  });
});

describe('publication and coverage evidence', () => {
  it('rejects partial groups and regressed PDF dates', () => {
    const old = FeedSchema.parse(baseline);
    const offers = parseCiti(citi, at, 'collector');
    expect(() => validateCollectedGroup('citi', offers.slice(0, 4), old)).toThrow('Incomplete');
    const previous = { ...old, offers };
    expect(() =>
      validateCollectedGroup(
        'citi',
        offers.map((o) => ({ ...o, documentDate: '2026-09-29' })),
        previous,
      ),
    ).toThrow('regressed');
  });
  it('shows missing, stale and fallback observations separately', () => {
    const feed = FeedSchema.parse({ ...baseline, generatedAt: at });
    const report = healthMarkdown(feed);
    expect(report).toContain('21 supported products');
    expect(report).toContain('| sbi | not checked | 0 / 3 |');
    expect(report).toContain('Retained records keep their original observation times');
  });
  it('leaves existing snapshot bytes untouched on total failure and writes partial success atomically', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ratepro-'));
    try {
      const path = join(dir, 'rates.json');
      await writeFile(path, 'original bytes');
      const feed = FeedSchema.parse({
        ...baseline,
        generatedAt: at,
        sources: [{ sourceId: 'sbi', attemptedAt: at, status: 'error', message: 'HTTP 403' }],
      });
      await expect(writeSnapshot(path, feed)).rejects.toThrow('All sources failed');
      expect(await readFile(path, 'utf8')).toBe('original bytes');
      feed.sources.push({
        sourceId: 'citi',
        attemptedAt: at,
        status: 'ok',
        message: 'Collected',
        successAt: at,
      });
      await writeSnapshot(path, feed);
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(feed);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
