import { z } from 'zod';
import { MARKET_CODES, marketDay, type MarketCode } from './markets';

const text = z.string().trim().min(1).max(3000);
const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const day = z.iso.date();
const source = z
  .object({
    id,
    publisher: text,
    title: text,
    url: z.url().refine((value) => {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    }, 'Use a public HTTPS source URL'),
    checkedAt: z.iso.datetime(),
    documentDate: day.nullable(),
  })
  .strict();
const claim = z.object({ text, sourceIds: z.array(id).min(1) }).strict();
const section = z
  .object({
    heading: text,
    kind: z.enum(['fact', 'analysis']),
    text,
    sourceIds: z.array(id).min(1),
  })
  .strict();
export const ArticleSchema = z
  .object({
    schemaVersion: z.literal(1),
    // Missing market remains SG for legacy records and already-open content PRs.
    market: z.enum(MARKET_CODES).default('SG'),
    slug: id,
    category: z.enum(['market', 'guide', 'package']),
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(260),
    reportDate: day,
    edition: z.enum(['baseline', 'update', 'weekly', 'guide']),
    // A stable key identifies one underlying event/package across reruns.
    eventKey: id,
    supersedes: id.nullable(),
    effectiveFrom: day.nullable(),
    effectiveUntil: day.nullable(),
    takeaways: z.array(claim).min(1).max(3),
    sections: z.array(section).min(1).max(12),
    sources: z.array(source).min(1).max(12),
    package: z
      .object({
        lender: text,
        eligibility: text,
        conditions: text,
        expiry: day.nullable(),
        sourceIds: z.array(id).min(1),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type Article = z.infer<typeof ArticleSchema>;
export const categories = {
  market: 'Market watch',
  package: 'Package updates',
  guide: 'Buying & refinancing guides',
};
export function singaporeDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function validateArticles(raw: unknown[], now = new Date()): Article[] {
  const articles = raw.map((value) => ArticleSchema.parse(value));
  const slugs = new Set<string>();
  const events = new Set<string>();
  for (const a of articles) {
    const today = marketDay(now, a.market);
    if (slugs.has(a.slug) || events.has(`${a.market}:${a.eventKey}`))
      throw new Error(`Duplicate slug/event: ${a.slug}`);
    slugs.add(a.slug);
    events.add(`${a.market}:${a.eventKey}`);
    if (a.reportDate > today) throw new Error(`Future report: ${a.slug}`);
    if ((a.category === 'package') !== (a.package !== null))
      throw new Error(`Package fields/category mismatch: ${a.slug}`);
    if (a.effectiveFrom && a.effectiveUntil && a.effectiveFrom > a.effectiveUntil)
      throw new Error(`Inverted effective period: ${a.slug}`);
    if (a.package?.expiry && a.effectiveFrom && a.package.expiry < a.effectiveFrom)
      throw new Error(`Inverted package period: ${a.slug}`);
    const refs = new Set(a.sources.map((s) => s.id));
    if (
      refs.size !== a.sources.length ||
      new Set(a.sources.map((s) => s.url)).size !== a.sources.length
    )
      throw new Error(`Duplicate source: ${a.slug}`);
    for (const s of a.sources) {
      if (
        new Date(s.checkedAt).getTime() > now.getTime() ||
        marketDay(new Date(s.checkedAt), a.market) > a.reportDate
      )
        throw new Error(`Future check: ${a.slug}`);
      if (s.documentDate && s.documentDate > marketDay(new Date(s.checkedAt), a.market))
        throw new Error(`Future source document: ${a.slug}`);
    }
    for (const claim of [...a.takeaways, ...a.sections, ...(a.package ? [a.package] : [])]) {
      if (claim.sourceIds.some((ref) => !refs.has(ref)))
        throw new Error(`Unknown evidence: ${a.slug}`);
    }
  }
  for (const a of articles) {
    if (a.supersedes) {
      const previous = articles.find((item) => item.slug === a.supersedes);
      if (!previous || previous.market !== a.market || previous.reportDate >= a.reportDate)
        throw new Error(`Invalid supersedes: ${a.slug}`);
    }
  }
  return articles.sort(
    (a, b) => b.reportDate.localeCompare(a.reportDate) || a.slug.localeCompare(b.slug),
  );
}
export function editorialPeriod(a: Article, now = new Date()): 'ended' | 'upcoming' | 'current' {
  const today = marketDay(now, a.market);
  const end = [a.effectiveUntil, a.package?.expiry].filter((v): v is string => !!v).sort()[0];
  if (end && today > end) return 'ended';
  if (a.effectiveFrom && today < a.effectiveFrom) return 'upcoming';
  // No stated end means no known expiry, not confirmed ongoing availability.
  return 'current';
}
export function selectFeaturedArticle(
  articles: readonly Article[],
  market: MarketCode,
  now = new Date(),
): Article | undefined {
  const records = articles.filter((a) => a.market === market);
  const superseded = new Set(records.map((a) => a.supersedes));
  return records
    .filter(
      (a) =>
        a.category === 'market' && !superseded.has(a.slug) && editorialPeriod(a, now) === 'current',
    )
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || a.slug.localeCompare(b.slug))[0];
}
export function editorialStatus(a: Article, now = new Date()): string {
  const period = editorialPeriod(a, now);
  if (period === 'ended') return 'Period ended';
  if (period === 'upcoming') return 'Upcoming period';
  const lastCheck = Math.min(...a.sources.map((s) => Date.parse(s.checkedAt)));
  if (now.getTime() - lastCheck > 7 * 86400000) return 'Recheck needed';
  return a.edition === 'baseline'
    ? 'Baseline · not a new launch'
    : a.edition === 'guide'
      ? 'Explainer'
      : 'Dated report';
}
export function readingMinutes(a: Article) {
  return Math.max(
    1,
    Math.ceil(
      [a.summary, ...a.takeaways.map((t) => t.text), ...a.sections.map((s) => s.text)]
        .join(' ')
        .split(/\s+/).length / 200,
    ),
  );
}
