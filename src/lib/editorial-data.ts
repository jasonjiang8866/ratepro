import { z } from 'zod';
import { ArticleSchema, type Article, readingMinutes } from './editorial';
export const PAGE_SIZE = 20;
export const FILTERS = ['all', 'market', 'guide', 'package'] as const;
export type EditorialFilter = (typeof FILTERS)[number];
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const slug = ArticleSchema.shape.slug;
const market = ArticleSchema.shape.market;
export const SummarySchema = ArticleSchema.pick({
  market: true,
  slug: true,
  category: true,
  title: true,
  summary: true,
  reportDate: true,
  edition: true,
  supersedes: true,
  effectiveFrom: true,
  effectiveUntil: true,
})
  .extend({
    package: z.object({ expiry: z.iso.date().nullable() }).strict().nullable(),
    oldestCheckedAt: z.iso.datetime(),
    firstCheckedAt: z.iso.datetime(),
    minutes: z.number().int().positive(),
    supersededBy: slug.nullable(),
  })
  .strict();
export type ArticleSummary = z.infer<typeof SummarySchema>;
const base = { schemaVersion: z.literal(1), revision };
export const PageSchema = z
  .object({
    ...base,
    market,
    category: z.enum(FILTERS),
    page: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    items: z.array(SummarySchema).max(PAGE_SIZE),
  })
  .strict();
export type EditorialPage = z.infer<typeof PageSchema>;
const sourceLink = z.object({ publisher: z.string(), url: z.url() }).strict();
export const HomeDataSchema = z
  .object({
    ...base,
    market,
    featured: SummarySchema.extend({
      takeaways: z
        .array(
          z.object({ text: z.string().max(3000), sources: z.array(sourceLink).max(12) }).strict(),
        )
        .max(3),
    })
      .strict()
      .nullable(),
    packages: z
      .array(
        SummarySchema.extend({
          lender: z.string().max(3000),
          eligibilityPreview: z.string().max(181),
        }).strict(),
      )
      .max(3),
  })
  .strict();
export type HomeData = z.infer<typeof HomeDataSchema>;
export const CalendarSchema = z
  .object({
    ...base,
    market,
    month: z.string().regex(/^\d{4}-\d{2}$/),
    days: z.record(z.string(), revision),
  })
  .strict();
const counts = z
  .object({
    all: z.number().int().nonnegative(),
    market: z.number().int().nonnegative(),
    guide: z.number().int().nonnegative(),
    package: z.number().int().nonnegative(),
  })
  .strict();
const marketManifest = z
  .object({
    counts,
    home: z
      .object({
        firstMonth: z.string().nullable(),
        lastMonth: z.string().nullable(),
        before: revision,
        after: revision,
      })
      .strict(),
  })
  .strict();
export const ManifestSchema = z
  .object({
    ...base,
    pageSize: z.literal(PAGE_SIZE),
    markets: z.object({ SG: marketManifest, JP: marketManifest }).strict(),
  })
  .strict();
export type EditorialManifest = z.infer<typeof ManifestSchema>;
export const BodySchema = z
  .object({ ...base, article: ArticleSchema, meta: SummarySchema })
  .strict();
export type ArticleBody = z.infer<typeof BodySchema>;
export const LocatorSchema = z.object({ ...base, slug, market }).strict();
export function summarize(article: Article, all: readonly Article[]): ArticleSummary {
  const {
    market,
    slug,
    category,
    title,
    summary,
    reportDate,
    edition,
    supersedes,
    effectiveFrom,
    effectiveUntil,
  } = article;
  return SummarySchema.parse({
    market,
    slug,
    category,
    title,
    summary,
    reportDate,
    edition,
    supersedes,
    effectiveFrom,
    effectiveUntil,
    package: article.package ? { expiry: article.package.expiry } : null,
    oldestCheckedAt: new Date(
      Math.min(...article.sources.map((s) => Date.parse(s.checkedAt))),
    ).toISOString(),
    firstCheckedAt: article.sources[0].checkedAt,
    minutes: readingMinutes(article),
    supersededBy: all.find((a) => a.market === market && a.supersedes === slug)?.slug ?? null,
  });
}
