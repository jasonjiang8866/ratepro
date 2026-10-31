import { z } from 'zod';
const date = z.string().datetime({ offset: true });
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v),
    'Invalid date',
  );
export const sourceIds = ['dbs-hdb', 'dbs-green', 'hdb', 'maybank', 'sc-sora'] as const;
export const banks = ['DBS', 'HDB', 'Maybank', 'Standard Chartered'] as const;
export const SourceId = z.enum(sourceIds);
export function soraFormula(tenor: '1M' | '3M', spread: number) {
  const exact = spread === Number(spread.toFixed(2)) ? spread.toFixed(2) : String(spread);
  return `${tenor} Compounded SORA + ${exact}%`;
}
export const StageSchema = z
  .object({
    label: z.string().min(1).max(80),
    rate: z.number().min(0).max(30).nullable(),
    formula: z.string().max(120),
    benchmark: z
      .object({
        name: z.literal('SORA'),
        tenor: z.enum(['1M', '3M']),
        spread: z.number().min(0).max(30),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((stage, ctx) => {
    // A spread is not an all-in rate. No benchmark fixing is collected yet.
    if ((stage.rate === null) !== Boolean(stage.benchmark))
      ctx.addIssue({
        code: 'custom',
        message: 'SORA formulas require a null all-in rate and a benchmark',
      });
    if (
      stage.benchmark &&
      stage.formula !== soraFormula(stage.benchmark.tenor, stage.benchmark.spread)
    )
      ctx.addIssue({ code: 'custom', message: 'Benchmark formula mismatch' });
  });
export const OfferSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,80}$/),
    sourceId: SourceId,
    bank: z.enum(banks),
    name: z.string().min(1).max(120),
    property: z.enum(['HDB', 'Private', 'HDB / Private']),
    purpose: z.array(z.enum(['Purchase', 'Refinance'])).min(1),
    construction: z.enum(['Completed', 'Under construction', 'Any']),
    kind: z.enum(['Fixed', 'Floating', 'Concessionary']),
    stages: z.array(StageSchema).min(1).max(10),
    lockYears: z.number().int().min(0).max(30).nullable(),
    minLoan: z.number().min(0).max(100000000).nullable(),
    terms: z.string().min(1).max(2000),
    observedAt: date,
    effectiveUntil: day.optional(),
    effectiveFrom: day.optional(),
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
    snapshotGeneratedAt: date.optional(),
    publishedSources: z.array(SourceStatusSchema).max(20).optional(),
    browserSources: z.array(SourceStatusSchema).max(20).optional(),
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
  {
    id: 'maybank',
    name: 'Maybank · Published home loan packages',
    url: 'https://www.maybank2u.com.sg/en/rates/rates-sora.page',
    collectionTimeoutMs: 30000,
  },
  {
    id: 'sc-sora',
    name: 'Standard Chartered · Published SORA package',
    url: 'https://www.sc.com/sg/borrow/mortgages/sora/',
  },
] as const;
// Research links are not collected products and never enter numeric rankings.
export const REFERENCE_SOURCES = [
  {
    name: 'OCBC · Home loans',
    url: 'https://www.ocbc.com/personal-banking/ls_personal/loans/new-purchase-of-hdb-private-property',
    status: 'Quote required',
    detail:
      'Fixed and SORA options are described, but the reviewed page has no complete numerical rate schedule. Ask the bank for a quote.',
  },
  {
    name: 'UOB · Private home loan',
    url: 'https://www.uob.com.sg/personal/borrow/property-loans/private-home-loan.page',
    status: 'Quote required',
    detail:
      'The reviewed page directs fixed-rate and combination-package enquiries to a mortgage specialist. No numerical quote is included here.',
  },
  {
    name: 'Citi · Published pricing PDF',
    url: 'https://www.citibank.com.sg/global_docs/pdf/Pricing-Packages.pdf',
    status: 'Document review required',
    detail:
      'The PDF has dated pricing, customer-tier and loan-size conditions. Not automatically extracted; check the current document with Citi.',
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
    Boolean(o.effectiveUntil && singaporeDay(now) > o.effectiveUntil)
  );
}
export function singaporeDay(now: number) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}
export function observationAge(o: Offer, now = Date.now()) {
  const days = Math.floor(Math.max(0, now - Date.parse(o.observedAt)) / 86400000);
  return days === 0
    ? 'Observed less than 24 hours ago'
    : `Observed ${days} day${days === 1 ? '' : 's'} ago`;
}
export function freshnessWarning(o: Offer, now = Date.now()) {
  if (o.effectiveUntil && singaporeDay(now) > o.effectiveUntil)
    return 'Published period ended · historical observation';
  if (isStale(o, now)) return 'Over 7 days since observation · confirm with lender';
  return undefined;
}
