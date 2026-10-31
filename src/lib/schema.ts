import { z } from 'zod';
const date = z.string().datetime({ offset: true });
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v),
    'Invalid date',
  );
export const sourceIds = ['dbs-hdb', 'dbs-green', 'hdb'] as const;
export const SourceId = z.enum(sourceIds);
export const StageSchema = z
  .object({
    label: z.string().min(1).max(80),
    rate: z.number().min(0).max(30),
    formula: z.string().max(120),
  })
  .strict();
export const OfferSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,80}$/),
    sourceId: SourceId,
    bank: z.enum(['DBS', 'HDB']),
    name: z.string().min(1).max(120),
    property: z.enum(['HDB', 'Private']),
    purpose: z.array(z.enum(['Purchase', 'Refinance'])).min(1),
    construction: z.enum(['Completed', 'Under construction', 'Any']),
    kind: z.enum(['Fixed', 'Floating', 'Concessionary']),
    stages: z.array(StageSchema).min(1).max(10),
    lockYears: z.number().int().min(0).max(30).nullable(),
    minLoan: z.number().min(0).max(100000000).nullable(),
    terms: z.string().min(1).max(2000),
    observedAt: date,
    effectiveUntil: day.optional(),
    method: z.enum(['collector', 'browser', 'reviewed', 'imported']),
  })
  .strict();
export type Offer = z.infer<typeof OfferSchema>;
export const SourceStatusSchema = z
  .object({
    sourceId: SourceId,
    attemptedAt: date,
    successAt: date.optional(),
    status: z.enum(['ok', 'error']),
    message: z.string().max(300),
  })
  .strict();
export type SourceStatus = z.infer<typeof SourceStatusSchema>;
export const FeedSchema = z
  .object({
    version: z.literal(1),
    generatedAt: date,
    offers: z.array(OfferSchema).max(200),
    sources: z.array(SourceStatusSchema).max(20),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.offers.map((x) => x.id)).size !== v.offers.length)
      c.addIssue({ code: 'custom', message: 'Duplicate offer IDs' });
    for (const offer of v.offers)
      if (!offer.id.startsWith(offer.sourceId + '-'))
        c.addIssue({ code: 'custom', message: 'Offer ID/source mismatch' });
  });
export type Feed = z.infer<typeof FeedSchema>;
export const RevisionSchema = z.object({ offer: OfferSchema, replacedAt: date }).strict();
export const CacheSchema = z
  .object({
    version: z.literal(1),
    offers: z.array(OfferSchema).max(200),
    history: z.array(RevisionSchema).max(500),
    sources: z.array(SourceStatusSchema).max(20),
    lastAttempt: date.optional(),
    lastFeedCheck: date.optional(),
  })
  .strict();
export type Cache = z.infer<typeof CacheSchema>;
export const SOURCES = [
  {
    id: 'dbs-hdb',
    name: 'DBS · HDB home loan',
    url: 'https://www.dbs.com.sg/personal/loans/home-loans/hdb-loan',
  },
  {
    id: 'dbs-green',
    name: 'DBS · Green home loan',
    url: 'https://www.dbs.com.sg/personal/loans/home-loans/dbs-green-home-loan',
  },
  {
    id: 'hdb',
    name: 'HDB · Concessionary loan',
    url: 'https://www.hdb.gov.sg/managing-my-home/finances/loan-matters/interest-rate',
  },
] as const;
export function sourceFor(id: Offer['sourceId']) {
  return SOURCES.find((s) => s.id === id)!;
}
export function emptyCache(): Cache {
  return { version: 1, offers: [], history: [], sources: [] };
}
export function isStale(o: Offer, now = Date.now()) {
  return (
    now - Date.parse(o.observedAt) > 7 * 86400000 ||
    Boolean(o.effectiveUntil && new Date(now).toISOString().slice(0, 10) > o.effectiveUntil)
  );
}
