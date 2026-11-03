import { describe, expect, it } from 'vitest';
import published from '../public/data/rates-jp.json';
import { JpFeedSchema } from '../src/lib/japan-rates';
import { japanComparisonItems, japanComparisonWarnings } from '../src/lib/japan-comparison';

const feed = JpFeedSchema.parse(published);
const purchase = feed.observations.flatMap((o) => o.rates.filter((r) => r.purpose === 'Purchase'));
const mufg = purchase.find((r) => r.id.startsWith('jp-mufg') && r.kind === 'Variable')!;
const smbc = purchase.find((r) => r.id.startsWith('jp-smbc') && r.kind === 'Variable')!;

describe('Japan comparison contracts', () => {
  it('keeps selection order, deduplicates and bounds selection without sorting by headline price', () => {
    const ids = [smbc.id, mufg.id, smbc.id, ...purchase.map((r) => r.id)];
    const items = japanComparisonItems(feed, ids, 'Purchase');
    expect(items).toHaveLength(3);
    expect(items.slice(0, 2).map((i) => i.rate.id)).toEqual([smbc.id, mufg.id]);
    expect(new Set(items.map((i) => i.rate.id)).size).toBe(3);
  });

  it('rejects stale or foreign IDs and selections from the other borrowing purpose', () => {
    const refinance = feed.observations[0].rates.find((r) => r.purpose === 'Refinance')!;
    expect(
      japanComparisonItems(feed, ['removed', 'dbs-fixed', refinance.id, mufg.id], 'Purchase').map(
        (i) => i.rate.id,
      ),
    ).toEqual([mufg.id]);
    expect(japanComparisonItems(feed, [mufg.id], 'Refinance')).toEqual([]);
  });

  it('resolves current values and drops withdrawn rows after a feed update', () => {
    const next = structuredClone(feed);
    const row = next.observations[0].rates.find((r) => r.id === mufg.id)!;
    row.annualRate += 0.125;
    expect(japanComparisonItems(next, [mufg.id], 'Purchase')[0].rate.annualRate).toBe(
      mufg.annualRate + 0.125,
    );
    next.observations[0].rates = next.observations[0].rates.filter((r) => r.id !== mufg.id);
    expect(japanComparisonItems(next, [mufg.id], 'Purchase')).toEqual([]);
  });

  it('flags applied-versus-standard rates even when both rates are variable', () => {
    const items = japanComparisonItems(feed, [mufg.id, smbc.id], 'Purchase');
    expect(japanComparisonWarnings(items)).toEqual([
      expect.stringContaining('Different rate bases'),
    ]);
  });

  it('flags fixed-period and publication-month differences independently of rate basis', () => {
    const fixed = purchase.find((r) => r.id.startsWith('jp-mufg') && r.kind === 'Initial fixed')!;
    const items = structuredClone(japanComparisonItems(feed, [mufg.id, fixed.id], 'Purchase'));
    // Clone the second observation separately; both rows originally share one bank snapshot.
    items[1].observation = { ...items[1].observation, publicationMonth: '2026-10' };
    expect(japanComparisonWarnings(items)).toEqual([
      expect.stringContaining('Different rate types or fixed periods'),
      expect.stringContaining('Different publication months'),
    ]);
  });
});
