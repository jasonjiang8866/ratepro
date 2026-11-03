import { JP_SOURCES, type JpFeed, type JpObservation } from './japan-rates';

export const JP_COMPARISON_LIMIT = 3;
export type JpPurpose = JpObservation['rates'][number]['purpose'];
export type JpComparisonItem = {
  source: (typeof JP_SOURCES)[number];
  observation: JpObservation;
  rate: JpObservation['rates'][number];
};

// Resolve IDs against the current feed. Removed rows and other borrowing purposes
// must never survive as stale comparison values after a snapshot refresh.
export function japanComparisonItems(feed: JpFeed, ids: string[], purpose: JpPurpose) {
  const available = feed.observations.flatMap((observation) => {
    const source = JP_SOURCES.find((s) => s.id === observation.sourceId)!;
    return observation.rates
      .filter((rate) => rate.purpose === purpose)
      .map((rate) => ({ source, observation, rate }));
  });
  return [...new Set(ids)]
    .map((id) => available.find((item) => item.rate.id === id))
    .filter((item): item is JpComparisonItem => !!item)
    .slice(0, JP_COMPARISON_LIMIT);
}

export function japanComparisonWarnings(items: JpComparisonItem[]) {
  const warnings: string[] = [];
  if (new Set(items.map((item) => item.source.basis)).size > 1)
    warnings.push(
      'Different rate bases: MUFG applied rates include conditional discounts; SMBC standard rates are before individual discounts. These headline rates cannot establish which bank is cheaper.',
    );
  if (new Set(items.map(({ rate }) => `${rate.kind}:${rate.term}`)).size > 1)
    warnings.push(
      'Different rate types or fixed periods: the duration of rate certainty differs. Initial fixed rates apply only for the stated period; variable rates can change.',
    );
  if (new Set(items.map(({ observation }) => observation.publicationMonth)).size > 1)
    warnings.push('Different publication months: these observations are not from the same month.');
  return warnings;
}
