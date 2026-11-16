import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateEditorial, readArticles } from '../scripts/build-editorial';
import { createEditorialClient, LruCache } from '../src/lib/content';
import { syntheticCorpus } from './helpers/editorial-corpus';
import { validateArticles } from '../src/lib/editorial';
const root = mkdtempSync(join(tmpdir(), 'ratepro-editorial-'));
const articles = readArticles();
const corpus = validateArticles(syntheticCorpus(articles));
const output = join(root, 'generated');
const built = generateEditorial(corpus, output);
const read = (path: string) => readFileSync(join(output, path), 'utf8');
const signal = () => new AbortController().signal;
const mocked = () =>
  vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url).replace('/data/editorial/v1/', '');
    try {
      return new Response(read(path), { headers: { 'content-type': 'application/json' } });
    } catch {
      return new Response('', { status: 404 });
    }
  });
afterAll(() => rmSync(root, { recursive: true, force: true }));
describe('static editorial generation', () => {
  it('generates deterministic files without body, full sources or detailed terms in indexes', () => {
    const first = read('manifest.json');
    expect(generateEditorial([...corpus].reverse(), join(root, 'reverse')).revision).toBe(
      built.revision,
    );
    expect(readFileSync(join(root, 'reverse', 'manifest.json'), 'utf8')).toBe(first);
    const paths = readdirSync(output, { recursive: true })
      .filter((p) => String(p).endsWith('.json'))
      .map(String);
    for (const path of paths.filter((p) => !p.startsWith('articles/'))) {
      const json = read(path);
      expect(json).not.toContain('UNOPENED_BODY_SENTINEL');
      expect(json).not.toContain('DETAILED_TERMS_');
      expect(json).not.toContain('"sections"');
      expect(json).not.toContain('"sourceIds"');
      expect(json).not.toContain('"conditions"');
    }
    expect(paths.filter((p) => p.startsWith('articles/'))).toHaveLength(1000);
  });
  it('paginates every category across the full market corpus, including old records', () => {
    for (const market of ['SG', 'JP'])
      for (const category of ['all', 'guide', 'market', 'package']) {
        const expected = corpus.filter(
          (a) => a.market === market && (category === 'all' || a.category === category),
        );
        const seen = [];
        for (let page = 1; page <= Math.ceil(expected.length / 20); page++) {
          const data = JSON.parse(
            read(`${built.revision}/${market}/pages/${category}/${page}.json`),
          );
          expect(data.items.length).toBeLessThanOrEqual(20);
          expect(data.total).toBe(expected.length);
          seen.push(...data.items.map((a: { slug: string }) => a.slug));
        }
        expect(seen).toEqual(expected.map((a) => a.slug));
      }
  });
  it('rejects duplicate slugs, missing bodies, invalid evidence and revision references', () => {
    expect(() => generateEditorial([...articles, articles[0]], join(root, 'invalid'))).toThrow(
      /Duplicate/,
    );
    for (const patch of [
      { sections: [] },
      { supersedes: 'missing' },
      { sections: [{ ...articles[0].sections[0], sourceIds: ['missing'] }] },
    ]) {
      expect(() =>
        generateEditorial([{ ...articles[0], ...patch }], join(root, 'invalid')),
      ).toThrow();
    }
  });
  it('retains old reports and bidirectional correction metadata', () => {
    const old = {
      ...articles[0],
      slug: 'old-report',
      eventKey: 'old-event',
      reportDate: '2026-11-01',
      sources: articles[0].sources.map((s) => ({
        ...s,
        checkedAt: '2026-11-01T00:00:00Z',
        documentDate: null,
      })),
      supersedes: null,
    };
    const newer = {
      ...old,
      slug: 'new-report',
      eventKey: 'new-event',
      reportDate: '2026-11-02',
      supersedes: 'old-report',
    };
    const target = join(root, 'corrections');
    generateEditorial([old, newer], target);
    expect(
      JSON.parse(readFileSync(join(target, 'articles/old-report.json'), 'utf8')).meta.supersededBy,
    ).toBe('new-report');
    expect(
      JSON.parse(readFileSync(join(target, 'articles/new-report.json'), 'utf8')).article.supersedes,
    ).toBe('old-report');
  });
});
describe('bounded fetch client', () => {
  it('loads SG/JP pages independently and does not request any unopened body', async () => {
    const fetcher = mocked(),
      client = createEditorialClient(fetcher);
    await client.home('SG', new Date('2026-11-16T00:00:00Z'), signal());
    await client.page('SG', 'all', 1, signal());
    expect(
      fetcher.mock.calls.every(
        ([u]) => !String(u).includes('/articles/') && !String(u).includes('/JP/'),
      ),
    ).toBe(true);
    const before = fetcher.mock.calls.length;
    await client.page('JP', 'guide', 2, signal());
    expect(fetcher.mock.calls.slice(before).map(([u]) => u)).toEqual([
      `/data/editorial/v1/${built.revision}/JP/pages/guide/2.json`,
    ]);
  });
  it('caps bodies at five and pages at six; revisiting evicted entries fetches again', async () => {
    const fetcher = mocked(),
      client = createEditorialClient(fetcher);
    const records = corpus.filter((a) => a.market === 'SG').slice(0, 7);
    for (const a of records) await client.article(a.slug, 'SG', signal());
    expect(client.stats().bodies.entries).toBe(5);
    expect(client.stats().bodies.bytes).toBeLessThanOrEqual(512 * 1024);
    const calls = fetcher.mock.calls.length;
    await client.article(records[0].slug, 'SG', signal());
    expect(fetcher.mock.calls.length).toBe(calls + 1);
    for (let n = 1; n <= 9; n++) await client.page('SG', 'all', n, signal());
    expect(client.stats().pages.entries).toBe(6);
    expect(client.stats().pages.bytes).toBeLessThanOrEqual(384 * 1024);
    const pageCalls = fetcher.mock.calls.length;
    await client.page('SG', 'all', 1, signal());
    expect(fetcher.mock.calls.length).toBe(pageCalls + 1);
  });
  it('enforces LRU promotion, byte budget, TTL and oversized entry bypass', () => {
    const cache = new LruCache<string>(5, 10, 100);
    cache.set('a', 'a', 4, 0);
    cache.set('b', 'b', 4, 0);
    cache.get('a', 1);
    cache.set('c', 'c', 4, 2);
    expect(cache.get('b', 3)).toBeUndefined();
    expect(cache.stats().bytes).toBe(8);
    cache.set('oversize', 'large', 11, 4);
    expect(cache.stats().entries).toBe(2);
    expect(cache.get('a', 100)).toBeUndefined();
    cache.clear();
    expect(cache.stats().bytes).toBe(0);
  });
  it('recovers from a deployment revision mismatch and clears stale caches', async () => {
    const fetcher = mocked();
    const client = createEditorialClient(fetcher);
    await client.page('SG', 'all', 1, signal());
    const real = fetcher.getMockImplementation()!;
    let stale = true;
    fetcher.mockImplementation(async (url) => {
      if (String(url).includes('/articles/') && stale) {
        stale = false;
        const data = JSON.parse(read(`articles/${articles[0].slug}.json`));
        data.revision = '0'.repeat(64);
        return new Response(JSON.stringify(data));
      }
      return real(url);
    });
    const body = await client.article(articles[0].slug, articles[0].market, signal());
    expect(body.revision).toBe(built.revision);
    expect(fetcher.mock.calls.filter(([u]) => String(u).endsWith('manifest.json'))).toHaveLength(2);
  });
  it('never caches aborted requests, and rejects cross-market and absent articles', async () => {
    const fetcher = mocked(),
      client = createEditorialClient(fetcher);
    const c = new AbortController();
    c.abort();
    await expect(client.article(articles[0].slug, articles[0].market, c.signal)).rejects.toThrow();
    expect(client.stats().bodies.entries).toBe(0);
    await expect(
      client.article(articles[0].slug, articles[0].market === 'SG' ? 'JP' : 'SG', signal()),
    ).rejects.toMatchObject({ status: 404 });
    await expect(client.article('does-not-exist', 'SG', signal())).rejects.toMatchObject({
      status: 404,
    });
    expect(await client.locate(articles[0].slug, signal())).toBe(articles[0].market);
  });
  it('rejects oversized/malformed responses and allows a successful retry', async () => {
    const fetcher = mocked(),
      client = createEditorialClient(fetcher);
    fetcher.mockResolvedValueOnce(new Response('x'.repeat(8193)));
    await expect(client.page('SG', 'all', 1, signal())).rejects.toThrow(/budget/);
    fetcher.mockResolvedValueOnce(new Response('{}'));
    await expect(client.page('SG', 'all', 1, signal())).rejects.toThrow();
    expect((await client.page('SG', 'all', 1, signal())).items).toHaveLength(20);
  });
  it('selects bounded home calendars at market midnight without renewing evidence', async () => {
    const client = createEditorialClient(mocked());
    const before = await client.home('SG', new Date('2026-11-11T15:59:59Z'), signal());
    const after = await client.home('SG', new Date('2026-11-11T16:00:00Z'), signal());
    expect(before.featured?.slug).not.toBe('stress-report-19');
    expect(after.featured?.effectiveUntil ?? '9999-12-31').not.toBe('2026-11-11');
    expect(client.stats().homes.entries).toBeLessThanOrEqual(2);
  });
});
