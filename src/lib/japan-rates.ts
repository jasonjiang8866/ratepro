import { z } from 'zod';
export const JP_SOURCES = [
  {
    id: 'jp-mufg',
    name: 'MUFG Bank',
    url: 'https://www.bk.mufg.jp/kariru/jutaku/yuuguu/',
    basis: 'Applied rate',
  },
  {
    id: 'jp-smbc',
    name: 'SMBC',
    url: 'https://www.smbc.co.jp/kojin/kinri/loan.html',
    basis: 'Standard rate · before individual discounts',
  },
] as const;
export const JpSourceId = z.enum(['jp-mufg', 'jp-smbc']);
const timestamp = z.string().datetime({ offset: true });
const rate = z.number().finite().min(0).max(20);
export const JpObservationSchema = z
  .object({
    sourceId: JpSourceId,
    observedAt: timestamp,
    publicationMonth: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
    conditions: z.string().min(20).max(6000),
    rates: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]+$/),
            purpose: z.enum(['Purchase', 'Refinance']),
            kind: z.enum(['Variable', 'Initial fixed', 'Full-term fixed']),
            term: z.string().min(1).max(80),
            label: z.string().min(1).max(120),
            annualRate: rate,
            referenceRate: rate.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict()
  .superRefine((o, ctx) => {
    if (
      new Set(o.rates.map((r) => r.id)).size !== o.rates.length ||
      o.rates.some((r) => !r.id.startsWith(o.sourceId + '-'))
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate or mismatched Japan rate IDs' });
    if (o.publicationMonth > japanMonth(new Date(o.observedAt)))
      ctx.addIssue({ code: 'custom', message: 'Future publication month' });
  });
export const JpFeedSchema = z
  .object({
    version: z.literal(1),
    market: z.literal('JP'),
    currency: z.literal('JPY'),
    generatedAt: timestamp,
    observations: z.array(JpObservationSchema).max(2),
    sources: z
      .array(
        z
          .object({
            sourceId: JpSourceId,
            attemptedAt: timestamp,
            successAt: timestamp.optional(),
            status: z.enum(['ok', 'error']),
            message: z.string().max(300),
            attempts: z.number().int().min(1).max(2),
          })
          .strict(),
      )
      .max(2),
  })
  .strict()
  .superRefine((feed, ctx) => {
    for (const list of [feed.observations, feed.sources])
      if (new Set(list.map((s) => s.sourceId)).size !== list.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate Japan sources' });
    for (const observation of feed.observations)
      if (Date.parse(observation.observedAt) > Date.parse(feed.generatedAt))
        ctx.addIssue({ code: 'custom', message: 'Observation newer than feed' });
  });
export type JpFeed = z.infer<typeof JpFeedSchema>;
export type JpObservation = z.infer<typeof JpObservationSchema>;
export function japanMonth(now: Date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  }).format(now);
}
export function jpFreshness(observation: JpObservation, now: Date) {
  if (observation.publicationMonth < japanMonth(now)) return 'Previous publication month';
  if (now.getTime() - Date.parse(observation.observedAt) > 48 * 60 * 60 * 1000)
    return 'Check overdue';
  return 'Observed this month';
}
