import { join } from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import {
  AnalyticsIndexSchema,
  ChangeEventSchema,
  SeriesSchema,
  type HistoryRecord,
  type Observation,
  type ProductVersion,
  type ChangeEvent,
  type AnalyticsIndex,
  type Market,
} from '../../src/lib/history';
import { canonical, digest } from './normalize';
import { files, writeJson } from './store';
const metric = (o: Observation, v: ProductVersion) =>
  v.basis === 'sora-spread' ? o.pricing.spread : o.pricing.annualRate;
function rateSignature(o: Observation) {
  return canonical({
    ...o.pricing,
    schedule: o.pricing.schedule.map((s) => {
      const { label: _label, id: _id, purpose: _purpose, kind: _kind, term: _term, ...pricing } = s;
      return pricing;
    }),
  });
}
export function analyze(records: HistoryRecord[], market: Market, generatedAt: string) {
  const rows = records.filter((r) => r.market === market);
  const versions = new Map(rows.filter((r) => r.type === 'product-version').map((r) => [r.id, r]));
  const observations = rows
    .filter((r): r is Observation => r.type === 'observation')
    .sort(
      (a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.id.localeCompare(b.id),
    );
  for (const o of observations) {
    const v = versions.get(o.productVersionId);
    if (!v || v.productId !== o.productId || v.sourceId !== o.sourceId)
      throw Error(`Broken product version: ${o.id}`);
  }
  const events: ChangeEvent[] = [];
  const groups = new Map<string, Observation[]>();
  const event = (body: Omit<ChangeEvent, 'schemaVersion' | 'id' | 'market'>) =>
    events.push(
      ChangeEventSchema.parse({
        schemaVersion: 1,
        id: digest({ market, ...body }),
        market,
        ...body,
      }),
    );
  for (const o of observations) {
    const list = groups.get(o.productId) ?? [];
    const previous = list.at(-1);
    // Conflicting snapshots at the same claimed observation time need review, not an invented sequence.
    if (previous?.observedAt === o.observedAt)
      throw Error(`Conflicting observation: ${market}/${o.productId}/${o.observedAt}`);
    const v = versions.get(o.productVersionId)!;
    const body = {
      productId: o.productId,
      at: o.observedAt,
      previousObservationId: previous?.id ?? null,
      observationId: o.id,
      basis: v.basis,
    };
    if (!previous) event({ ...body, kind: 'initial', delta: null });
    else {
      const old = versions.get(previous.productVersionId)!;
      if (rateSignature(previous) !== rateSignature(o) || old.basis !== v.basis) {
        const a = metric(previous, old),
          b = metric(o, v);
        const delta =
          a !== null && b !== null && old.comparisonKey === v.comparisonKey
            ? Number((b - a).toFixed(6))
            : null;
        event({
          ...body,
          kind:
            delta !== null && delta > 0
              ? 'rate-up'
              : delta !== null && delta < 0
                ? 'rate-down'
                : 'rate-change',
          delta,
        });
      }
      if (
        canonical(old.terms) !== canonical(v.terms) ||
        old.name !== v.name ||
        old.rateType !== v.rateType
      )
        event({ ...body, kind: 'terms-change', delta: null });
    }
    list.push(o);
    groups.set(o.productId, list);
  }
  const catalogs = rows
    .filter((r) => r.type === 'catalog')
    .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt) || a.id.localeCompare(b.id));
  let tracked = new Set<string>(),
    seen = new Set<string>();
  for (const c of catalogs) {
    const next = new Set(c.productIds);
    for (const id of tracked)
      if (!next.has(id))
        event({
          productId: id,
          at: c.generatedAt,
          kind: 'not-tracked',
          delta: null,
          basis: null,
          previousObservationId: null,
          observationId: null,
        });
    for (const id of next)
      if (!tracked.has(id) && seen.has(id))
        event({
          productId: id,
          at: c.generatedAt,
          kind: 'tracking-resumed',
          delta: null,
          basis: null,
          previousObservationId: null,
          observationId: null,
        });
    tracked = next;
    seen = new Set([...seen, ...next]);
  }
  events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const products: AnalyticsIndex['products'] = [...groups]
    .map(([productId, points]) => {
      const first = points[0],
        last = points.at(-1)!,
        v = versions.get(last.productVersionId)!;
      // Statistics do not mix a product's old pricing basis with its current one.
      const numbers = points
        .filter((p) => versions.get(p.productVersionId)!.comparisonKey === v.comparisonKey)
        .map((p) => metric(p, versions.get(p.productVersionId)!))
        .filter((n): n is number => n !== null);
      return {
        productId,
        sourceId: v.sourceId,
        bank: v.bank,
        name: v.name,
        basis: v.basis,
        comparisonKey: v.comparisonKey,
        rateType: v.rateType,
        firstObservedAt: first.observedAt,
        lastObservedAt: last.observedAt,
        observations: points.length,
        durationDays: (Date.parse(last.observedAt) - Date.parse(first.observedAt)) / 86400000,
        min: numbers.length ? Math.min(...numbers) : null,
        max: numbers.length ? Math.max(...numbers) : null,
        latest: metric(last, v),
        tracked: tracked.has(productId),
        effectiveUntil: last.effectiveUntil,
        years: [...new Set(points.map((p) => new Date(p.observedAt).getUTCFullYear()))],
      };
    })
    .sort((a, b) => a.bank.localeCompare(b.bank) || a.productId.localeCompare(b.productId));
  const attempts = rows.filter((r) => r.type === 'attempt');
  const sources: AnalyticsIndex['sources'] = [
    ...new Set([...attempts.map((a) => a.sourceId), ...products.map((p) => p.sourceId)]),
  ]
    .sort()
    .map((sourceId) => {
      // Snapshot corrections of the same attemptedAt count as one logical attempt; fail closed on conflicting outcomes.
      const buckets = new Map<string, typeof attempts>();
      for (const a of attempts.filter((a) => a.sourceId === sourceId))
        buckets.set(a.attemptedAt, [...(buckets.get(a.attemptedAt) ?? []), a]);
      const good = [...buckets]
        .filter(([, a]) => a.every((x) => x.status === 'ok'))
        .map(([at]) => at)
        .sort();
      return {
        sourceId,
        observations: observations.filter((o) => o.sourceId === sourceId).length,
        attempts: buckets.size,
        successes: good.length,
        successRate: buckets.size ? good.length / buckets.size : null,
        lastAttempt: [...buckets.keys()].sort().at(-1) ?? null,
        lastSuccess: good.at(-1) ?? null,
      };
    });
  const index = AnalyticsIndexSchema.parse({
    schemaVersion: 1,
    market,
    generatedAt,
    firstObservedAt: observations[0]?.observedAt ?? null,
    lastSuccessfulCollection:
      sources
        .map((s) => s.lastSuccess)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
    products,
    sources,
    recentEvents: events
      .filter((e) => e.kind !== 'initial')
      .slice(-60)
      .reverse(),
  });
  return { index, events, groups, versions };
}
export async function generateAnalytics(
  records: HistoryRecord[],
  output: string,
  generatedAt = new Date().toISOString(),
) {
  const stats = [];
  for (const market of ['SG', 'JP'] as const) {
    const expected = new Set<string>();
    const write = async (path: string, value: unknown) => {
      expected.add(path);
      await writeJson(path, value);
    };
    const { index, events, groups, versions } = analyze(records, market, generatedAt);
    const indexPath = join(output, market, 'index.json');
    const previous = await readFile(indexPath, 'utf8')
      .then((t) => JSON.parse(t))
      .catch(() => null);
    if (
      previous &&
      canonical({ ...previous, generatedAt: null }) === canonical({ ...index, generatedAt: null })
    )
      index.generatedAt = previous.generatedAt;
    await write(indexPath, index);
    for (const [productId, obs] of groups) {
      for (const year of new Set(obs.map((p) => new Date(p.observedAt).getUTCFullYear()))) {
        const points = obs
          .filter((p) => new Date(p.observedAt).getUTCFullYear() === year)
          .map((p) => ({
            id: p.id,
            observedAt: p.observedAt,
            value: metric(p, versions.get(p.productVersionId)!),
            referenceRate: p.pricing.referenceRate,
            evidenceUrl: p.evidenceUrl,
            method: p.method,
            effectiveFrom: p.effectiveFrom,
            effectiveUntil: p.effectiveUntil,
            publicationMonth: p.publicationMonth,
            productVersionId: p.productVersionId,
            comparisonKey: versions.get(p.productVersionId)!.comparisonKey,
            provenance: p.provenance,
          }));
        await write(
          join(output, market, productId, `${year}.json`),
          SeriesSchema.parse({ schemaVersion: 1, market, productId, year, points }),
        );
      }
    }
    const days = new Map<string, ChangeEvent[]>();
    for (const e of events) {
      const day = e.at.slice(0, 10);
      days.set(day, [...(days.get(day) ?? []), e]);
    }
    for (const [day, entries] of days)
      await write(join(output, market, 'events', day + '.json'), {
        schemaVersion: 1,
        market,
        events: entries,
      });
    // Derived views are replaceable; remove obsolete partitions after an earlier backfill.
    for (const path of await files(join(output, market)))
      if (path.endsWith('.json') && !expected.has(path)) await unlink(path);
    stats.push({
      market,
      products: groups.size,
      observations: [...groups.values()].reduce((n, g) => n + g.length, 0),
      events: events.length,
      firstObservedAt: index.firstObservedAt,
      attempts: index.sources.reduce((n, s) => n + s.attempts, 0),
    });
  }
  return stats;
}
