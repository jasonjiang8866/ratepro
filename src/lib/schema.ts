import { z } from 'zod';
const date = z.string().datetime({ offset: true });
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v),
    'Invalid date',
  );
export const sourceIds = [
  'dbs-hdb',
  'dbs-green',
  'hdb',
  'maybank',
  'sc-sora',
  'uob-sora',
  'citi',
] as const;
export const banks = ['DBS', 'HDB', 'Maybank', 'Standard Chartered', 'UOB', 'Citi'] as const;
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
    property: z.enum(['HDB', 'Private', 'HDB / Private', 'Confirm with lender']),
    purpose: z.array(z.enum(['Purchase', 'Refinance', 'Confirm with lender'])).min(1),
    construction: z.enum(['Completed', 'Under construction', 'Any']),
    kind: z.enum(['Fixed', 'Floating', 'Concessionary']),
    stages: z.array(StageSchema).min(1).max(10),
    lockYears: z.number().int().min(0).max(30).nullable(),
    minLoan: z.number().min(0).max(100000000).nullable(),
    maxLoanExclusive: z.number().positive().max(100000000).optional(),
    customerTier: z.enum(['Citigold', 'Citibanking']).optional(),
    minRelationshipBalance: z.number().min(0).max(100000000).optional(),
    rateFloor: z.number().min(0).max(30).optional(),
    documentDate: day.optional(),
    evidenceSourceId: z.literal('cpf-askgov').optional(),
    terms: z.string().min(1).max(2000),
    observedAt: date,
    effectiveUntil: day.optional(),
    effectiveFrom: day.optional(),
    method: z.enum(['collector', 'browser', 'reviewed', 'imported']),
  })
  .strict()
  .superRefine((offer, ctx) => {
    if (
      offer.evidenceSourceId &&
      (offer.sourceId !== 'hdb' ||
        offer.id !== 'hdb-concessionary' ||
        !offer.effectiveFrom ||
        !offer.effectiveUntil)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'AskGov evidence requires the HDB concessionary record and explicit period',
      });
  });
export type Offer = z.infer<typeof OfferSchema>;
const FailureKind = z.enum(['http', 'timeout', 'network', 'response', 'parse', 'document']);
export const SourceFailureSchema = z
  .object({
    failureKind: FailureKind,
    httpStatus: z.number().int().min(100).max(599).optional(),
    attempts: z.number().int().min(1).max(2),
    message: z.string().max(300),
  })
  .strict();
export const SourceStatusSchema = z
  .object({
    sourceId: SourceId,
    attemptedAt: date,
    successAt: date.optional(),
    status: z.enum(['ok', 'error']),
    message: z.string().max(300),
    failureKind: FailureKind.optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    attempts: z.number().int().min(1).max(2).optional(),
    fallbackSourceId: z.literal('cpf-askgov').optional(),
    primaryFailure: SourceFailureSchema.optional(),
  })
  .strict()
  .superRefine((status, ctx) => {
    if (
      (status.fallbackSourceId || status.primaryFailure) &&
      (status.sourceId !== 'hdb' || !status.fallbackSourceId || !status.primaryFailure)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Fallback status requires HDB primary failure evidence',
      });
  });
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
  {
    id: 'uob-sora',
    name: 'UOB · Published SORA package',
    url: 'https://www.uob.com.sg/personal/borrow/property-loans/about-sora.page',
  },
  {
    id: 'citi',
    name: 'Citi · Published pricing PDF',
    url: 'https://www.citibank.com.sg/global_docs/pdf/Pricing-Packages.pdf',
    collectorOnly: true,
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
    name: 'UOB · Fixed-rate enquiries',
    url: 'https://www.uob.com.sg/personal/borrow/property-loans/private-home-loan.page',
    status: 'Quote required',
    detail:
      'Fixed-rate and combination packages require a quote. The separately published SORA schedule is included in this directory.',
  },
  {
    name: 'HSBC · Home loans',
    url: 'https://www.hsbc.com.sg/loans/products/home/',
    status: 'Quote required',
    detail:
      'Headline pricing depends on Premier relationship and loan-size conditions. No complete stage schedule is extracted; request a personalised quote.',
  },
] as const;
export function sourceFor(id: Offer['sourceId']) {
  return SOURCES.find((s) => s.id === id)!;
}
export const HDB_FALLBACK = {
  id: 'cpf-askgov',
  name: 'CPF / AskGov · HDB quarterly rate',
  url: 'https://ask.gov.sg/cpf/questions/cm2s5b54c005r12kzrep7aayw',
  collectionTimeoutMs: 30000,
} as const;
export function evidenceFor(offer: Offer) {
  return offer.evidenceSourceId === HDB_FALLBACK.id ? HDB_FALLBACK : sourceFor(offer.sourceId);
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
