import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import { readFileSync, readdirSync } from 'node:fs';
import {
  ArticleSchema,
  editorialPeriod,
  editorialStatus,
  selectFeaturedArticle,
  type Article,
} from '../src/lib/editorial';
import { articleHref, type MarketCode } from '../src/lib/markets';
import btoRecord from '../content/insights/2026-11-bto-launch-application-deadline.json';
import baselineRecord from '../content/insights/2026-11-market-initial-observation.json';
import japanRecord from '../content/insights/jp-mortgage-first-look.json';

const content = vi.hoisted(() => ({ articles: [] as Article[] }));
vi.mock('../src/lib/content', () => content);
import { Home } from '../src/components/Home';

const bto = ArticleSchema.parse(btoRecord);
const baseline = ArticleSchema.parse(baselineRecord);
const japan = ArticleSchema.parse(japanRecord);
const after = new Date('2026-11-12T04:00:00Z');
const corpus = ['insights', 'promotions']
  .flatMap((folder) =>
    readdirSync(`content/${folder}`)
      .filter((file) => file.endsWith('.json'))
      .map((file) =>
        ArticleSchema.parse(JSON.parse(readFileSync(`content/${folder}/${file}`, 'utf8'))),
      ),
  )
  .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || a.slug.localeCompare(b.slug));
const render = (now: Date, market: MarketCode = 'SG', slug?: string) =>
  load(renderToStaticMarkup(createElement(Home, { now, market, slug })));

beforeEach(() => {
  content.articles = [...corpus];
});

describe('deadline-aware briefing selection', () => {
  it.each([
    ['2026-11-10T16:00:00Z', true], // 11 Nov 00:00 SGT
    ['2026-11-11T15:58:59Z', true],
    ['2026-11-11T15:59:00Z', true], // stated deadline minute
    ['2026-11-11T15:59:59.999Z', true], // inclusive date, immediately before midnight
    ['2026-11-11T16:00:00Z', false], // 12 Nov 00:00 SGT, still 11 Nov UTC
    ['2026-11-12T04:00:00Z', false], // 12 Nov noon SGT
  ])('uses the SG deadline at %s (eligible: %s)', (instant, eligible) => {
    const now = new Date(instant);
    expect(selectFeaturedArticle([bto], 'SG', now)).toBe(eligible ? bto : undefined);
    expect(editorialPeriod(bto, now)).toBe(eligible ? 'current' : 'ended');
    expect(editorialStatus(bto, now) === 'Period ended').toBe(!eligible);
    const $ = render(now);
    expect($('.briefing h2 a').attr('href')).toBe(articleHref(eligible ? bto : baseline));
  });

  it('falls back to an older eligible report without renewing its source checks', () => {
    expect(selectFeaturedArticle([bto, baseline], 'SG', after)).toBe(baseline);
    const $ = render(after);
    expect($('.briefing .story-status').text()).toBe('Recheck needed');
    expect($('.briefing .story-meta').text()).toContain('3 Nov 2026');
  });

  it('orders eligible reports by report date then slug, without mutating inputs', () => {
    const z = { ...baseline, slug: 'z-report' };
    const a = { ...baseline, slug: 'a-report' };
    const newer = { ...baseline, slug: 'new-report', reportDate: '2026-11-06' };
    const input = Object.freeze([z, bto, newer, a]);
    const before = JSON.stringify(input);
    expect(selectFeaturedArticle(input, 'SG', after)).toBe(newer);
    expect(selectFeaturedArticle([z, a], 'SG', after)).toBe(a);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('does not feature an upcoming report, and includes it when its local start arrives', () => {
    const upcoming = { ...bto, effectiveFrom: '2026-11-13', effectiveUntil: null };
    expect(selectFeaturedArticle([upcoming, baseline], 'SG', after)).toBe(baseline);
    expect(editorialStatus(upcoming, after)).toBe('Upcoming period');
    expect(selectFeaturedArticle([upcoming], 'SG', new Date('2026-11-12T16:00:00Z'))).toBe(
      upcoming,
    );
  });

  it('never resurrects a superseded report when its correction expires', () => {
    const correction = { ...bto, supersedes: baseline.slug };
    expect(selectFeaturedArticle([baseline, correction], 'SG', after)).toBeUndefined();
    expect(
      selectFeaturedArticle([baseline, correction], 'SG', new Date('2026-11-11T15:59:00Z')),
    ).toBe(correction);
  });

  it('uses the earliest known end for period labels, including package expiry', () => {
    const promotion = corpus.find((a) => a.category === 'package')!;
    for (const [effectiveUntil, expiry] of [
      ['2026-11-30', '2026-11-11'],
      ['2026-11-11', '2026-11-30'],
    ]) {
      const article = { ...promotion, effectiveUntil, package: { ...promotion.package!, expiry } };
      expect(editorialStatus(article, after)).toBe('Period ended');
      expect(editorialPeriod(article, after)).toBe('ended');
    }
  });

  it('keeps market selection, supersedes and local expiry boundaries isolated', () => {
    // Even an invalid cross-market replacement cannot suppress an SG candidate.
    const jp = { ...japan, supersedes: bto.slug, effectiveUntil: '2026-11-11' };
    const now = new Date('2026-11-11T15:00:00Z'); // JP has reached 12 Nov; SG has not
    expect(selectFeaturedArticle([jp, bto], 'SG', now)).toBe(bto);
    expect(selectFeaturedArticle([jp, bto], 'JP', now)).toBeUndefined();
    expect(selectFeaturedArticle([jp], 'JP', new Date('2026-11-11T14:59:59.999Z'))).toBe(jp);
    expect(selectFeaturedArticle([bto, japan], 'JP', after)).toBe(japan);
    expect(selectFeaturedArticle([japan], 'SG', after)).toBeUndefined();
  });
});

describe('homepage archive and reader regression', () => {
  it.each(['ended', 'upcoming', 'empty'] as const)(
    'renders an honest empty briefing with %s candidates',
    (scenario) => {
      content.articles =
        scenario === 'ended'
          ? [bto, japan]
          : scenario === 'upcoming'
            ? [{ ...bto, effectiveFrom: '2026-11-13', effectiveUntil: null }, japan]
            : [];
      const $ = render(after);
      expect($('.briefing').length).toBe(0);
      expect($('.journal-empty h2').text()).toBe('No current briefing is available.');
      expect($('.journal-empty').text()).toContain('reading room');
      expect($('.story-row').length).toBe(scenario === 'empty' ? 0 : 1);
    },
  );

  it('keeps expired BTO in the reading room and at its original URL with full evidence', () => {
    const before = JSON.stringify(content.articles);
    const $ = render(after);
    const row = $('.story-row').filter(
      (_, el) => $(el).find('h3 a').attr('href') === articleHref(bto),
    );
    expect(row.length).toBe(1);
    expect(row.find('.story-status').text()).toBe('Period ended');
    expect(
      $('.story-row h3 a')
        .map((_, el) => $(el).attr('href'))
        .get(),
    ).toEqual(corpus.filter((a) => a.market === 'SG').map(articleHref));
    const reader = render(after, 'SG', bto.slug);
    expect(reader('.reader h1').text()).toBe(bto.title);
    expect(reader('.reader-header .story-status').text()).toBe('Period ended');
    expect(reader('.reader-sources').text()).toContain('11 Nov 2026');
    expect(reader('.reader-sources').text()).toContain('5 Nov 2026');
    expect(
      reader('.reader-sources .source-note a')
        .map((_, el) => reader(el).attr('href'))
        .get(),
    ).toEqual(bto.sources.map((s) => s.url));
    expect(JSON.stringify(content.articles)).toBe(before);
  });

  it('retains correction history and both original reader links', () => {
    const correction = { ...bto, supersedes: baseline.slug };
    content.articles = [correction, baseline];
    const $ = render(after);
    expect($('.briefing').length).toBe(0);
    expect($('.story-row').length).toBe(2);
    expect(
      $('.story-status')
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(['Period ended', 'Superseded report']);
    const older = render(after, 'SG', baseline.slug);
    expect(older('.correction-notice a').attr('href')).toBe(articleHref(correction));
    const updated = render(after, 'SG', correction.slug);
    expect(updated('.reader-sources > a').attr('href')).toBe(articleHref(baseline));
  });

  it('keeps JP briefing and archive identical across the SG BTO expiry', () => {
    // Isolate SG expiry from later editorial additions with their own JP expiry.
    content.articles = [bto, japan];
    const jpFeatured = japan;
    for (const now of [new Date('2026-11-11T15:59:59Z'), after]) {
      const $ = render(now, 'JP');
      expect($('.briefing h2 a').attr('href')).toBe(articleHref(jpFeatured));
      expect(
        $('.story-row h3 a')
          .map((_, el) => $(el).attr('href'))
          .get(),
      ).toEqual([articleHref(japan)]);
      expect($('.journal').text()).not.toMatch(/BTO|HDB|SORA/);
    }
    expect(render(after, 'JP', bto.slug)('h1').text()).toBe('We couldn’t find that report.');
  });

  it('does not change the package-watchlist ordering or expiry labels', () => {
    const $ = render(new Date('2026-12-01T04:00:00Z'), 'JP');
    const packages = corpus
      .filter(
        (a) =>
          a.market === 'JP' &&
          a.category === 'package' &&
          !corpus.some((b) => b.supersedes === a.slug),
      )
      .slice(0, 3);
    expect(
      $('.watch-card h3 a')
        .map((_, el) => $(el).attr('href'))
        .get(),
    ).toEqual(packages.map(articleHref));
    expect($('.watch-card .story-status').first().text()).toBe('Period ended');
  });
});
