import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sgRaw from '../public/data/rates.json';
import jpRaw from '../public/data/rates-jp.json';
import { FeedSchema, type Feed } from '../src/lib/schema';
import { analyze, generateAnalytics } from '../scripts/history/analytics';
import { bytesDigest, canonical, normalize, sourceUrls } from '../scripts/history/normalize';
import { backfill, git } from '../scripts/history';
import { Ledger, files, readRecords } from '../scripts/history/store';
import {
  chartSegments,
  comparable,
  filterPoints,
  rangeStart,
  type HistoryRecord,
  type Provenance,
  type TrendPoint,
} from '../src/lib/history';
import { collect } from '../scripts/collect';
const day1 = '2026-11-01T01:00:00.000Z',
  day2 = '2026-11-02T01:00:00.000Z',
  importedAt = '2026-11-16T12:00:00.000Z';
const sg = FeedSchema.parse(sgRaw);
const sgUrls = sourceUrls(await readFile('src/lib/schema.ts', 'utf8'));
const jpUrls = sourceUrls(await readFile('src/lib/japan-rates.ts', 'utf8'));
const provenance = (generatedAt = day1): Provenance => ({
  mode: 'git-backfill',
  importedAt,
  feedGeneratedAt: generatedAt,
  feedPath: 'public/data/rates.json',
  feedSha256: bytesDigest('fixture'),
  commit: 'a'.repeat(40),
  committedAt: importedAt,
  runUrl: null,
});
function feed(at = day1): Feed {
  return {
    version: 1,
    generatedAt: at,
    offers: [{ ...sg.offers.find((o) => o.id === 'dbs-hdb-cpf-oa')!, observedAt: at }],
    sources: [{ sourceId: 'dbs-hdb', status: 'ok', attemptedAt: at, successAt: at, message: 'ok' }],
  };
}
function records(...feeds: Feed[]) {
  return [
    ...new Map(
      feeds
        .flatMap((f) => normalize(f, 'SG', provenance(f.generatedAt), sgUrls))
        .map((r) => [r.id, r]),
    ).values(),
  ];
}
const dirs: string[] = [];
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'ratepro-history-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe('immutable observation ledger', () => {
  it('repeated collection and repeated backfill do not append duplicate rows or change original provenance', async () => {
    const root = await temp(),
      ledger = await Ledger.open(root);
    const r = records(feed());
    expect(await ledger.append(r)).toBe(4);
    const before = await Promise.all((await files(root)).map((p) => readFile(p, 'utf8')));
    expect(
      await ledger.append(
        normalize(
          feed(),
          'SG',
          { ...provenance(), importedAt: '2027-01-01T00:00:00.000Z' },
          sgUrls,
        ),
      ),
    ).toBe(0);
    expect(await Promise.all((await files(root)).map((p) => readFile(p, 'utf8')))).toEqual(before);
    expect(
      (await readRecords(root)).find((r) => r.type === 'observation')?.provenance.importedAt,
    ).toBe(importedAt);
  });
  it('keeps unchanged daily observations distinct from rate and terms events', () => {
    const first = feed(),
      second = feed(day2);
    const result = analyze(records(first, second), 'SG', importedAt);
    expect(result.index.products[0].observations).toBe(2);
    expect(result.events.map((e) => e.kind)).toEqual(['initial']);
    expect(result.index.products[0].min).toBe(first.offers[0].stages[0].rate);
    expect(result.index.products[0].durationDays).toBe(1);
  });
  it('distinguishes rate changes, terms changes and renames; retains stable product identity', () => {
    const first = feed(),
      second = feed(day2);
    second.offers[0].stages = structuredClone(second.offers[0].stages);
    second.offers[0].stages[0].rate! += 0.25;
    expect(analyze(records(first, second), 'SG', importedAt).events.map((e) => e.kind)).toEqual([
      'initial',
      'rate-up',
    ]);
    second.offers[0].stages[0].rate! -= 0.5;
    expect(
      analyze(records(first, second), 'SG', importedAt).events.find((e) => e.kind === 'rate-down')
        ?.delta,
    ).toBe(-0.25);
    second.offers[0].stages = first.offers[0].stages;
    second.offers[0].name = 'Renamed public package';
    second.offers[0].terms += ' Additional eligibility rule.';
    expect(analyze(records(first, second), 'SG', importedAt).events.map((e) => e.kind)).toEqual([
      'initial',
      'terms-change',
    ]);
    expect(analyze(records(first, second), 'SG', importedAt).index.products).toHaveLength(1);
  });
  it('retains all-failure diagnostics without renewing retained observation times', () => {
    const first = feed(),
      failure = feed(day2);
    failure.offers = first.offers;
    failure.sources[0] = {
      ...failure.sources[0],
      status: 'error',
      successAt: day1,
      message: 'HTTP 403',
      failureKind: 'http',
      httpStatus: 403,
    };
    const result = analyze(records(first, failure), 'SG', importedAt);
    expect(result.index.products[0].observations).toBe(1);
    expect(result.index.sources[0]).toMatchObject({
      attempts: 2,
      successes: 1,
      successRate: 0.5,
      lastSuccess: day1,
    });
    failure.offers = [{ ...first.offers[0], observedAt: day2, method: 'collector' }];
    expect(
      normalize(failure, 'SG', provenance(day2), sgUrls).filter((r) => r.type === 'observation'),
    ).toHaveLength(0);
  });
  it('accepts reviewed evidence independently of a scheduled collector failure', () => {
    const f = feed();
    f.sources[0].status = 'error';
    f.offers[0].method = 'browser';
    expect(
      normalize(f, 'SG', provenance(), sgUrls).filter((r) => r.type === 'observation'),
    ).toHaveLength(1);
  });
  it('records removal and resumed tracking without asserting lender withdrawal', () => {
    const removed = feed(day2);
    removed.offers = [];
    const resumed = feed('2026-11-03T01:00:00.000Z');
    const result = analyze(records(feed(), removed, resumed), 'SG', importedAt);
    expect(result.events.map((e) => e.kind)).toEqual([
      'initial',
      'not-tracked',
      'tracking-resumed',
    ]);
    expect(result.index.products[0].tracked).toBe(true);
  });
  it('rejects ambiguous observations and broken schema/version references', async () => {
    const f = feed(),
      other = feed();
    other.offers[0].terms += ' Conflicting same timestamp';
    expect(() => analyze(records(f, other), 'SG', importedAt)).toThrow('Conflicting observation');
    expect(() =>
      analyze(
        records(f).filter((r) => r.type !== 'product-version'),
        'SG',
        importedAt,
      ),
    ).toThrow('Broken product version');
    const ledger = await Ledger.open(await temp());
    await expect(
      ledger.append([{ ...records(f)[0], schemaVersion: 2 } as unknown as HistoryRecord]),
    ).rejects.toThrow();
  });
  it('uses historical evidence URLs and keeps all five timestamp concepts distinct', () => {
    const f = feed();
    f.offers[0].effectiveFrom = '2026-10-01';
    f.offers[0].effectiveUntil = '2026-12-31';
    const o = normalize(f, 'SG', provenance(), {
      'dbs-hdb': 'https://example.com/historical-bank-page',
    }).find((r) => r.type === 'observation')!;
    expect(o).toMatchObject({
      observedAt: day1,
      effectiveFrom: '2026-10-01',
      effectiveUntil: '2026-12-31',
      evidenceUrl: 'https://example.com/historical-bank-page',
      provenance: { feedGeneratedAt: day1, importedAt, committedAt: importedAt },
    });
  });
});

describe('Git replay and static analytics integration', () => {
  it('replays only mainline snapshots, is byte-idempotent, and reports malformed revisions', async () => {
    const repo = await temp(),
      root = join(repo, 'ledger');
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.email', 'tests@example.com');
    git(repo, 'config', 'user.name', 'Tests');
    await mkdir(join(repo, 'src/lib'), { recursive: true });
    await mkdir(join(repo, 'public/data'), { recursive: true });
    await writeFile(join(repo, 'src/lib/schema.ts'), await readFile('src/lib/schema.ts', 'utf8'));
    const commit = async (value: unknown) => {
      await writeFile(join(repo, 'public/data/rates.json'), JSON.stringify(value) + '\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '-m', 'fixture');
    };
    await commit(feed());
    await commit(feed(day2));
    const ledger = await Ledger.open(root),
      first = await backfill(repo, ledger, 'main', importedAt);
    expect(first.snapshots).toBe(2);
    expect(first.rejected).toEqual([]);
    const before = await Promise.all((await files(root)).map((p) => readFile(p, 'utf8')));
    expect((await backfill(repo, ledger, 'main', importedAt)).added).toBe(0);
    expect(await Promise.all((await files(root)).map((p) => readFile(p, 'utf8')))).toEqual(before);
    const obs = ledger.records().filter((r) => r.type === 'observation');
    expect(obs.map((o) => o.observedAt)).toEqual([day1, day2]);
    expect(obs[0].provenance.feedSha256).toBe(bytesDigest(JSON.stringify(feed()) + '\n'));
    expect(obs[0].provenance.commit).not.toBe(obs[1].provenance.commit);
    const out = join(repo, 'analytics');
    await generateAnalytics(ledger.records(), out, importedAt);
    const generated = await Promise.all((await files(out)).map((p) => readFile(p, 'utf8')));
    await generateAnalytics(ledger.records(), out, '2027-01-01T00:00:00.000Z');
    expect(await Promise.all((await files(out)).map((p) => readFile(p, 'utf8')))).toEqual(
      generated,
    );
    await commit({ version: 999 });
    expect((await backfill(repo, ledger, 'main', importedAt)).rejected).toHaveLength(1);
  });
  it('separates markets, SORA spread, JP applied/standard/reference rates and unknown effective dates', () => {
    const all = [
      ...normalize(sgRaw, 'SG', provenance(sgRaw.generatedAt), sgUrls),
      ...normalize(jpRaw, 'JP', provenance(jpRaw.generatedAt), jpUrls),
    ];
    const sgResult = analyze(all, 'SG', importedAt),
      jpResult = analyze(all, 'JP', importedAt);
    expect(sgResult.index.products.every((p) => !p.productId.startsWith('jp-'))).toBe(true);
    expect(jpResult.index.products.every((p) => p.productId.startsWith('jp-'))).toBe(true);
    const sora = all.find((r) => r.type === 'observation' && r.pricing.spread !== null);
    expect(sora?.type === 'observation' && sora.pricing.annualRate).toBeNull();
    const applied = jpResult.index.products.find((p) => p.basis === 'applied-rate')!,
      standard = jpResult.index.products.find((p) => p.basis === 'standard-rate')!;
    expect(comparable(applied, standard)).toBe(false);
    expect(
      [...jpResult.groups.values()]
        .flat()
        .every((o) => o.effectiveFrom === null && o.effectiveUntil === null),
    ).toBe(true);
    expect([...jpResult.groups.values()].flat().some((o) => o.pricing.referenceRate !== null)).toBe(
      true,
    );
  });
  it('orders offset timestamps by instant and deduplicates logical attempt instants', () => {
    const first = feed('2026-11-01T09:00:00+08:00');
    const later = feed('2026-11-01T02:00:00.000Z');
    const sameAttempt = feed('2026-11-01T01:00:00.000Z');
    sameAttempt.offers = [];
    const result = analyze(records(first, later, sameAttempt), 'SG', importedAt);
    expect(result.index.products[0].lastObservedAt).toBe(later.generatedAt);
    expect(result.index.sources[0]).toMatchObject({ attempts: 2, successes: 2 });
    expect(result.index.products[0].tracked).toBe(true);
    expect(result.index.lastSuccessfulCollection).toBe(later.generatedAt);
  });
  it('source collection replaces complete groups and preserves unrelated sources', async () => {
    const prior = feed();
    prior.offers = [
      { ...prior.offers[0], id: 'dbs-hdb-old-name' },
      sg.offers.find((o) => o.sourceId === 'hdb')!,
    ];
    const html = await readFile('tests/fixtures/dbs-hdb.html', 'utf8');
    const result = await collect(
      prior,
      async () => new Response(html),
      day2,
      ['dbs-hdb'],
      async () => {},
    );
    expect(result.sources[0].status).toBe('ok');
    expect(result.offers.some((o) => o.id === 'dbs-hdb-old-name')).toBe(false);
    expect(result.offers.some((o) => o.sourceId === 'hdb')).toBe(true);
  });
});

describe('chart windows and gaps', () => {
  const point = (at: string, value: number | null): TrendPoint => ({
    id: 'a'.repeat(64),
    observedAt: at,
    value,
    referenceRate: null,
    evidenceUrl: 'https://example.com',
    method: 'collector',
    effectiveFrom: null,
    effectiveUntil: null,
    publicationMonth: null,
    productVersionId: 'b'.repeat(64),
    comparisonKey: 'SG|published',
    provenance: provenance(at),
  });
  it('clamps calendar months and excludes future and outside-window points', () => {
    const now = Date.parse('2026-03-31T01:00:00.000Z');
    expect(new Date(rangeStart('1M', now)).toISOString()).toBe('2026-02-28T01:00:00.000Z');
    expect(
      filterPoints(
        [
          point('2026-02-27T00:00:00Z', 1),
          point('2026-03-01T00:00:00Z', 2),
          point('2026-04-01T00:00:00Z', 3),
        ],
        '1M',
        now,
      ).map((p) => p.value),
    ).toEqual([2]);
    expect(filterPoints([], 'All', now)).toEqual([]);
  });
  it('does not interpolate null values, missed dates or expired periods; zero is a real value', () => {
    const points = [
      point(day1, 0),
      point(day2, null),
      point('2026-11-03T01:00:00Z', 2),
      point('2026-11-06T01:00:00Z', 2),
    ];
    expect(chartSegments(points).map((s) => s.length)).toEqual([1, 1, 1]);
    expect(chartSegments([])).toEqual([]);
    expect(
      chartSegments([{ ...point(day1, 2), effectiveUntil: '2026-11-01' }, point(day2, 2)]),
    ).toHaveLength(2);
  });
});
