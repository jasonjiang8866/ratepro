import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArticles, selectFeaturedArticle, type Article } from '../src/lib/editorial';
import {
  BodySchema,
  HomeDataSchema,
  LocatorSchema,
  ManifestSchema,
  PageSchema,
  CalendarSchema,
  summarize,
  PAGE_SIZE,
  FILTERS,
  type HomeData,
} from '../src/lib/editorial-data';
import { type MarketCode } from '../src/lib/markets';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function readArticles(root = 'content', now = new Date()) {
  const raw: unknown[] = [];
  for (const folder of ['insights', 'promotions'])
    for (const name of readdirSync(join(root, folder)).sort()) {
      if (!name.endsWith('.json')) throw Error(`Unexpected content file: ${folder}/${name}`);
      const article = JSON.parse(readFileSync(join(root, folder, name), 'utf8'));
      if (`${article.slug}.json` !== name) throw Error(`Filename/slug mismatch: ${name}`);
      if ((article.category === 'package') !== (folder === 'promotions'))
        throw Error(`Wrong content folder: ${name}`);
      raw.push(article);
    }
  return validateArticles(raw, now);
}
export function homeData(
  articles: readonly Article[],
  market: MarketCode,
  now: Date,
  revision: string,
): HomeData {
  const selected = selectFeaturedArticle(articles, market, now);
  return HomeDataSchema.parse({
    schemaVersion: 1,
    revision,
    market,
    featured: selected
      ? {
          ...summarize(selected, articles),
          takeaways: selected.takeaways.map((t) => ({
            text: t.text,
            sources: t.sourceIds.map((id) => {
              const s = selected.sources.find((s) => s.id === id)!;
              return { publisher: s.publisher, url: s.url };
            }),
          })),
        }
      : null,
    packages: articles
      .filter(
        (a) =>
          a.market === market &&
          a.category === 'package' &&
          !articles.some((b) => b.supersedes === a.slug),
      )
      .slice(0, 3)
      .map((a) => ({
        ...summarize(a, articles),
        lender: a.package!.lender,
        eligibilityPreview:
          a.package!.eligibility.length > 180
            ? a.package!.eligibility.slice(0, 180) + '…'
            : a.package!.eligibility,
      })),
  });
}
export function generateEditorial(articles: Article[], output: string) {
  articles = validateArticles(articles);
  const revision = hash({ format: 1, articles });
  const generated = new Map<string, string>();
  const put = (path: string, value: unknown, limit = 128 * 1024) => {
    const data = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(data) > limit)
      throw Error(`Editorial payload exceeds byte budget: ${path}`);
    generated.set(path, data);
  };
  const markets = {} as Record<MarketCode, unknown>;
  const common = { schemaVersion: 1 as const, revision };
  for (const a of articles) {
    const meta = summarize(a, articles);
    put(`articles/${a.slug}.json`, BodySchema.parse({ ...common, article: a, meta }), 512 * 1024);
    put(
      `resolve/${a.slug}.json`,
      LocatorSchema.parse({ ...common, slug: a.slug, market: a.market }),
      2048,
    );
  }
  for (const market of ['SG', 'JP'] as const) {
    const counts = {} as Record<string, number>;
    for (const category of FILTERS) {
      const selected = articles.filter(
        (a) => a.market === market && (category === 'all' || a.category === category),
      );
      counts[category] = selected.length;
      for (let page = 1; page <= Math.max(1, Math.ceil(selected.length / PAGE_SIZE)); page++)
        put(
          `${revision}/${market}/pages/${category}/${page}.json`,
          PageSchema.parse({
            ...common,
            market,
            category,
            page,
            total: selected.length,
            items: selected
              .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
              .map((a) => summarize(a, articles)),
          }),
        );
    }
    // Only period boundaries can change the selected briefing. Calendars contain at most 31 hash pointers, never bodies.
    const boundaries = articles
      .filter((a) => a.market === market && a.category === 'market')
      .flatMap((a) => [
        ...(a.effectiveFrom ? [a.effectiveFrom] : []),
        ...(a.effectiveUntil
          ? [new Date(Date.parse(a.effectiveUntil) + 86400000).toISOString().slice(0, 10)]
          : []),
      ])
      .sort();
    const variant = (day: string) => {
      // Local noon is safe for both SG and JP when testing date-only eligibility.
      const data = homeData(articles, market, new Date(day + 'T04:00:00Z'), revision),
        id = hash(data);
      put(`${revision}/${market}/home/${id}.json`, data, 96 * 1024);
      return id;
    };
    const first = boundaries[0]?.slice(0, 7) ?? null,
      last = boundaries.at(-1)?.slice(0, 7) ?? null;
    const before = variant(
      boundaries.length
        ? new Date(Date.parse(boundaries[0]) - 86400000).toISOString().slice(0, 10)
        : '2000-01-01',
    );
    const after = variant(boundaries.at(-1) ?? '2000-01-01');
    if (first && last) {
      let month = first,
        iterations = 0;
      while (month <= last) {
        if (++iterations > 1200)
          throw Error('Editorial calendar exceeds 100-year generation budget');
        const days: Record<string, string> = {};
        let day = month + '-01';
        while (day.startsWith(month)) {
          days[day] = variant(day);
          day = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10);
        }
        put(
          `${revision}/${market}/calendar/${month}.json`,
          CalendarSchema.parse({ ...common, market, month, days }),
          8192,
        );
        month = day.slice(0, 7);
      }
    }
    markets[market] = { counts, home: { firstMonth: first, lastMonth: last, before, after } };
  }
  put('manifest.json', ManifestSchema.parse({ ...common, pageSize: PAGE_SIZE, markets }), 8192);
  // This directory is generated only. Source content and other public data are untouched.
  rmSync(output, { recursive: true, force: true });
  for (const [path, data] of generated) {
    mkdirSync(dirname(join(output, path)), { recursive: true });
    writeFileSync(join(output, path), data);
  }
  return {
    revision,
    articles: articles.length,
    files: generated.size,
    bytes: [...generated.values()].reduce((n, t) => n + Buffer.byteLength(t), 0),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(
    JSON.stringify(
      generateEditorial(
        readArticles(process.env.EDITORIAL_CONTENT_DIR ?? 'content'),
        process.env.EDITORIAL_OUTPUT_DIR ?? 'public/data/editorial/v1',
      ),
    ),
  );
}
