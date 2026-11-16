import { z } from 'zod';

export const HistoryMarket = z.enum(['SG', 'JP']);
const timestamp = z.string().datetime({ offset: true });
const id = z.string().regex(/^[a-z0-9-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const numericRate = z.number().finite().min(0).max(30).nullable();
export const ProvenanceSchema = z
  .object({
    mode: z.enum(['git-backfill', 'snapshot', 'collection']),
    importedAt: timestamp,
    feedGeneratedAt: timestamp,
    feedPath: z.string(),
    feedSha256: hash,
    commit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    committedAt: timestamp.nullable(),
    runUrl: z.url().nullable(),
  })
  .strict();
const base = { schemaVersion: z.literal(1), id: hash, market: HistoryMarket };
export const ProductVersionSchema = z
  .object({
    ...base,
    type: z.literal('product-version'),
    productId: id,
    sourceId: id,
    bank: z.string(),
    name: z.string(),
    rateType: z.string(),
    basis: z.enum(['published-rate', 'sora-spread', 'applied-rate', 'standard-rate']),
    comparisonKey: z.string(),
    terms: z.record(z.string(), z.unknown()),
  })
  .strict();
export const PricingSchema = z
  .object({
    annualRate: numericRate,
    spread: numericRate,
    referenceRate: numericRate,
    benchmark: z.string().nullable(),
    // Full stage schedule is retained; the headline metric is always the initial stage.
    schedule: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();
export const ObservationSchema = z
  .object({
    ...base,
    type: z.literal('observation'),
    productId: id,
    sourceId: id,
    productVersionId: hash,
    observedAt: timestamp,
    effectiveFrom: z.iso.date().nullable(),
    effectiveUntil: z.iso.date().nullable(),
    publicationMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .nullable(),
    method: z.enum(['collector', 'browser', 'reviewed', 'imported', 'unspecified']),
    status: z.literal('observed'),
    evidenceUrl: z.url(),
    pricing: PricingSchema,
    provenance: ProvenanceSchema,
  })
  .strict();
export const AttemptSchema = z
  .object({
    ...base,
    type: z.literal('attempt'),
    sourceId: id,
    attemptedAt: timestamp,
    status: z.enum(['ok', 'error']),
    evidenceUrl: z.url(),
    details: z.record(z.string(), z.unknown()),
    provenance: ProvenanceSchema,
  })
  .strict();
export const CatalogSchema = z
  .object({
    ...base,
    type: z.literal('catalog'),
    generatedAt: timestamp,
    productIds: z.array(id),
    provenance: ProvenanceSchema,
  })
  .strict();
export const HistoryRecordSchema = z.discriminatedUnion('type', [
  ProductVersionSchema,
  ObservationSchema,
  AttemptSchema,
  CatalogSchema,
]);
export type HistoryRecord = z.infer<typeof HistoryRecordSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type ProductVersion = z.infer<typeof ProductVersionSchema>;
export type Attempt = z.infer<typeof AttemptSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Market = z.infer<typeof HistoryMarket>;
export const ChangeEventSchema = z
  .object({
    ...base,
    productId: id,
    at: timestamp,
    kind: z.enum([
      'initial',
      'rate-up',
      'rate-down',
      'rate-change',
      'terms-change',
      'not-tracked',
      'tracking-resumed',
    ]),
    previousObservationId: hash.nullable(),
    observationId: hash.nullable(),
    delta: z.number().nullable(),
    basis: ProductVersionSchema.shape.basis.nullable(),
  })
  .strict();
export type ChangeEvent = z.infer<typeof ChangeEventSchema>;
export const PointSchema = z
  .object({
    id: hash,
    observedAt: timestamp,
    value: numericRate,
    referenceRate: numericRate,
    evidenceUrl: z.url(),
    method: ObservationSchema.shape.method,
    effectiveFrom: z.iso.date().nullable(),
    effectiveUntil: z.iso.date().nullable(),
    publicationMonth: ObservationSchema.shape.publicationMonth,
    productVersionId: hash,
    comparisonKey: z.string(),
    provenance: ProvenanceSchema,
  })
  .strict();
export type TrendPoint = z.infer<typeof PointSchema>;
export const SeriesSchema = z
  .object({
    schemaVersion: z.literal(1),
    market: HistoryMarket,
    productId: id,
    year: z.number().int(),
    points: z.array(PointSchema),
  })
  .strict();
export const ProductSummarySchema = z.object({
  productId: id,
  sourceId: id,
  bank: z.string(),
  name: z.string(),
  basis: ProductVersionSchema.shape.basis,
  comparisonKey: z.string(),
  rateType: z.string(),
  firstObservedAt: timestamp,
  lastObservedAt: timestamp,
  observations: z.number().int(),
  durationDays: z.number(),
  min: numericRate,
  max: numericRate,
  latest: numericRate,
  tracked: z.boolean(),
  effectiveUntil: z.iso.date().nullable(),
  years: z.array(z.number().int()),
});
export type ProductSummary = z.infer<typeof ProductSummarySchema>;
export const AnalyticsIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    market: HistoryMarket,
    generatedAt: timestamp,
    firstObservedAt: timestamp.nullable(),
    lastSuccessfulCollection: timestamp.nullable(),
    products: z.array(ProductSummarySchema),
    recentEvents: z.array(ChangeEventSchema),
    sources: z.array(
      z.object({
        sourceId: id,
        observations: z.number().int(),
        attempts: z.number().int(),
        successes: z.number().int(),
        successRate: z.number().nullable(),
        lastAttempt: timestamp.nullable(),
        lastSuccess: timestamp.nullable(),
      }),
    ),
  })
  .strict();
export type AnalyticsIndex = z.infer<typeof AnalyticsIndexSchema>;
export const ranges = ['1M', '3M', '6M', '1Y', 'All'] as const;
export type TrendRange = (typeof ranges)[number];
export function rangeStart(range: TrendRange, now: number) {
  if (range === 'All') return -Infinity;
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 }[range];
  const date = new Date(now);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime();
}
export function filterPoints(points: TrendPoint[], range: TrendRange, now: number) {
  const start = rangeStart(range, now);
  return points.filter((p) => Date.parse(p.observedAt) >= start && Date.parse(p.observedAt) <= now);
}
export function comparable(
  a: Pick<ProductSummary, 'comparisonKey'>,
  b: Pick<ProductSummary, 'comparisonKey'>,
) {
  return a.comparisonKey === b.comparisonKey;
}
// No interpolation across missed daily observations, unknown rates or expired periods.
export function chartSegments(points: TrendPoint[]) {
  const segments: TrendPoint[][] = [];
  let current: TrendPoint[] = [];
  for (const p of points) {
    const prev = current.at(-1);
    if (
      p.value === null ||
      (prev &&
        (Date.parse(p.observedAt) - Date.parse(prev.observedAt) > 36 * 3600000 ||
          (prev.effectiveUntil && p.observedAt.slice(0, 10) > prev.effectiveUntil)))
    ) {
      if (current.length) segments.push(current);
      current = [];
    }
    if (p.value !== null) current.push(p);
  }
  if (current.length) segments.push(current);
  return segments;
}
