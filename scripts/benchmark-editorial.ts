import { execFileSync, spawn } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { readArticles } from './build-editorial';
import { syntheticCorpus, writeCorpus } from '../tests/helpers/editorial-corpus';
// Pinned audited main: reproducible before/after, never changes the user's checkout.
const BASELINE = '28fbb1a68db9255986b0c63c0520946ad9d9e31a';
const root = process.cwd(),
  temp = mkdtempSync(join(tmpdir(), 'ratepro-benchmark-'));
const output = resolve('test-results/editorial');
mkdirSync(output, { recursive: true });
const seed = readArticles(),
  stress = syntheticCorpus(seed);
const measurements: Record<string, unknown> = {
  baseline: BASELINE,
  articleCounts: [seed.length, 1000],
  notes:
    'Uncompressed bytes and reproducible gzip estimates are separate from JS heap and Chrome process RAM.',
};
const builds: Record<string, string> = {};
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: ReturnType<typeof spawn> | undefined;
try {
  for (const version of ['before', 'after'])
    for (const count of [seed.length, 1000]) {
      const name = `${version}-${count}`,
        dir = join(temp, name);
      mkdirSync(dir);
      if (version === 'before') {
        const tar = execFileSync('git', ['archive', BASELINE], { maxBuffer: 100 * 1024 * 1024 });
        execFileSync('tar', ['-x', '-C', dir], { input: tar });
      } else {
        for (const path of [
          'src',
          'config',
          'scripts',
          'tests',
          'public',
          'content',
          'package.json',
          'package-lock.json',
          'index.html',
          'vite.config.ts',
          'tsconfig.json',
        ])
          cpSync(join(root, path), join(dir, path), { recursive: true });
        rmSync(join(dir, 'public/data/editorial'), { recursive: true, force: true });
      }
      symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
      if (count === 1000) {
        rmSync(join(dir, 'content'), { recursive: true });
        writeCorpus(join(dir, 'content'), stress);
      }
      execFileSync('npm', ['run', 'build'], { cwd: dir, stdio: 'inherit' });
      const dist = join(dir, 'dist');
      builds[name] = dist;
      const html = readFileSync(join(dist, 'index.html'), 'utf8');
      const entry = html.match(/type="module"[^>]*src="([^"]+)"/)![1];
      const js = readFileSync(join(dist, entry));
      measurements[name] = {
        entry: entry.split('/').pop(),
        initialJsBytes: js.length,
        initialJsGzipBytes: gzipSync(js).length,
        totalJsBytes: readdirSync(join(dist, 'assets'))
          .filter((n) => n.endsWith('.js'))
          .reduce((n, f) => n + readFileSync(join(dist, 'assets', f)).length, 0),
      };
      if (version === 'after')
        assert.ok(
          !js.includes(Buffer.from('UNOPENED_BODY_SENTINEL')),
          'No unopened article bodies in application JS',
        );
    }
  const m = measurements as Record<string, { initialJsBytes: number }>;
  assert.equal(
    m['after-1000'].initialJsBytes,
    m[`after-${seed.length}`].initialJsBytes,
    'Initial JS independent of total body volume',
  );
  assert.ok(m['before-1000'].initialJsBytes > m[`before-${seed.length}`].initialJsBytes * 10);
  writeFileSync(join(output, 'measurements.json'), JSON.stringify(measurements, null, 2));
  if (!process.argv.includes('--build-only')) {
    browser = await chromium.launch();
    // Real-corpus network evidence for both audited baseline and normal production build.
    for (const version of ['before', 'after']) {
      const origin = 'http://127.0.0.1:4174';
      server = spawn(
        process.execPath,
        [
          'node_modules/vite/bin/vite.js',
          'preview',
          '--host',
          '127.0.0.1',
          '--port',
          '4174',
          '--strictPort',
          '--outDir',
          builds[`${version}-${seed.length}`],
        ],
        { stdio: 'inherit' },
      );
      for (let i = 0; i < 60; i++) {
        if (
          await fetch(origin)
            .then((r) => r.ok)
            .catch(() => false)
        )
          break;
        await new Promise((r) => setTimeout(r, 250));
      }
      const c = await browser.newContext();
      await c.route('**/*', (route) =>
        route.request().url().startsWith(origin) ? route.continue() : route.abort(),
      );
      const p = await c.newPage();
      const requests: string[] = [];
      const responses: { path: string; bytes: number }[] = [];
      const pending: Promise<unknown>[] = [];
      p.on('request', (r) => requests.push(new URL(r.url()).pathname));
      p.on('response', (r) => {
        if (r.url().includes('/data/editorial/'))
          pending.push(
            r
              .body()
              .then((b) => responses.push({ path: new URL(r.url()).pathname, bytes: b.length }))
              .catch(() => {}),
          );
      });
      await p.goto(`${origin}/?market=SG#/home`);
      await p.locator('.story-list').waitFor();
      await Promise.all(pending);
      const initial = {
        requests: [...requests],
        editorialDecodedBytes: responses.reduce((n, r) => n + r.bytes, 0),
        responses: [...responses],
      };
      let start = requests.length;
      await p.getByLabel('Country / market').selectOption('JP');
      await p.getByText('THE JAPAN HOME LOAN JOURNAL', { exact: true }).waitFor();
      const switchJP = { requests: requests.slice(start) };
      start = requests.length;
      await p.getByRole('link', { name: 'Read the briefing', exact: true }).click();
      await p.locator('.reader').waitFor();
      measurements[`${version}-real-network`] = {
        initial,
        switchJP,
        openArticle: { requests: requests.slice(start) },
      };
      await c.close();
      await new Promise<void>((r) => {
        server!.once('exit', () => r());
        server!.kill();
      });
      server = undefined;
    }
    // Only stress browser diagnostics use this extra production mode; byte comparisons above are ordinary releases.
    execFileSync(
      'node',
      [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'editorial-test'],
      { cwd: join(temp, 'after-1000'), stdio: 'inherit' },
    );
    const base = 'http://127.0.0.1:4175';
    server = spawn(
      process.execPath,
      [
        'node_modules/vite/bin/vite.js',
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        '4175',
        '--strictPort',
        '--outDir',
        builds['after-1000'],
      ],
      { stdio: 'inherit' },
    );
    for (let i = 0; i < 60; i++) {
      if (
        await fetch(base)
          .then((r) => r.ok)
          .catch(() => false)
      )
        break;
      if (i === 59) throw Error('Preview did not start');
      await new Promise((r) => setTimeout(r, 250));
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', (route) =>
      route.request().url().startsWith(base) ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const requests: string[] = [];
    page.on('request', (r) => requests.push(new URL(r.url()).pathname));
    const responses: { path: string; bytes: number }[] = [];
    const pending: Promise<unknown>[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/data/editorial/'))
        pending.push(
          r
            .body()
            .then((b) => responses.push({ path: new URL(r.url()).pathname, bytes: b.length }))
            .catch(() => {}),
        );
    });
    const ready = (market = 'SG', category = 'all') =>
      page.locator(`.story-list[data-market="${market}"][data-category="${category}"]`).waitFor();
    const navigate = async (slug: string, market = 'SG') => {
      await page.evaluate(
        ({ slug, market }) => {
          history.pushState(null, '', `?market=${market}#/read/${slug}`);
          dispatchEvent(new PopStateEvent('popstate'));
        },
        { slug, market },
      );
    };
    const stats = () =>
      page.evaluate(() =>
        (
          window as unknown as {
            __editorialCacheStats: () => Record<
              string,
              { entries: number; bytes: number; maxEntries: number; maxBytes: number }
            >;
          }
        ).__editorialCacheStats(),
      );
    const bounds = async () => {
      for (const value of Object.values(await stats())) {
        assert.ok(value.entries <= value.maxEntries);
        assert.ok(value.bytes <= value.maxBytes);
      }
    };
    const fit = async () =>
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        'No mobile horizontal overflow',
      );
    await page.goto(`${base}/?market=SG#/home`);
    await ready();
    await Promise.all(pending);
    measurements.initialSG = {
      requests: [...requests],
      editorialDecodedBytes: responses.reduce((n, r) => n + r.bytes, 0),
      responses: [...responses],
    };
    assert.equal(await page.locator('.story-row').count(), 20);
    assert.ok(!requests.some((p) => p.includes('/articles/') || p.includes('/JP/')));
    assert.ok(
      !(await page
        .locator('.journal')
        .innerText()
        .then((t) => t.includes('UNOPENED_BODY_SENTINEL'))),
    );
    const startJP = requests.length;
    await page.getByLabel('Country / market').selectOption('JP');
    await ready('JP');
    measurements.switchJP = { requests: requests.slice(startJP) };
    assert.ok(!requests.slice(startJP).some((p) => p.includes('/articles/') || p.includes('/SG/')));
    await page.getByLabel('Country / market').selectOption('SG');
    await ready();
    for (let n = 2; n <= 9; n++) {
      await page.getByRole('button', { name: 'Next page', exact: true }).click();
      await page
        .getByRole('status')
        .filter({ hasText: `Page ${n} of` })
        .waitFor();
      assert.equal(await page.locator('.story-row').count(), 20);
      await bounds();
    }
    await page.getByRole('button', { name: 'Buying & refinancing guides', exact: true }).click();
    await ready('SG', 'guide');
    assert.equal(await page.locator('.story-row').count(), 20);
    assert.ok(
      (await page.locator('.story-row h3').allTextContents()).some((t) =>
        t.startsWith('Historical fixture'),
      ),
      'Filter spans full history',
    );
    await page.screenshot({ path: join(output, 'desktop-pagination.png'), fullPage: true });
    await page.setViewportSize({ width: 320, height: 740 });
    await fit();
    await page.getByRole('button', { name: 'Use dark theme', exact: true }).click();
    await page.screenshot({ path: join(output, 'mobile-dark-pagination.png'), fullPage: true });
    const selected = stress.filter((a) => a.market === 'SG').slice(0, 8);
    const beforeBody = requests.length;
    await navigate(selected[0].slug);
    await page.getByRole('heading', { name: selected[0].title, exact: true }).waitFor();
    measurements.openArticle = { requests: requests.slice(beforeBody), slug: selected[0].slug };
    assert.equal(requests.slice(beforeBody).filter((p) => p.includes('/articles/')).length, 1);
    for (const article of selected.slice(1)) {
      await navigate(article.slug);
      await page.getByRole('heading', { name: article.title, exact: true }).waitFor();
      await bounds();
    }
    assert.equal((await stats()).bodies.entries, 5);
    const evicted = requests.length;
    await navigate(selected[0].slug);
    await page.getByRole('heading', { name: selected[0].title, exact: true }).waitFor();
    assert.ok(
      requests.slice(evicted).some((p) => p.endsWith(`/articles/${selected[0].slug}.json`)),
      'Oldest body is fetched after eviction',
    );
    // A slow old response cannot replace the current reader.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow = stress.find((a) => a.slug === 'stress-report-999')!;
    await page.route(`**/articles/${slow.slug}.json`, async (route) => {
      await gate;
      await route.continue().catch(() => {});
    });
    await navigate(slow.slug);
    await page.getByRole('status').filter({ hasText: 'Loading editorial content' }).waitFor();
    await navigate(selected[1].slug);
    await page.getByRole('heading', { name: selected[1].title, exact: true }).waitFor();
    release();
    await page.unroute(`**/articles/${slow.slug}.json`);
    assert.equal(await page.locator('.reader h1').innerText(), selected[1].title);
    // A failed body can be retried without stale content.
    const failure = stress.find((a) => a.slug === 'stress-report-997')!;
    let fail = true;
    await page.route(`**/articles/${failure.slug}.json`, (route) =>
      fail ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue(),
    );
    await navigate(failure.slug);
    await page.getByRole('heading', { name: 'Editorial content is unavailable.' }).waitFor();
    assert.equal(await page.locator('.reader').count(), 0);
    fail = false;
    await page.getByRole('button', { name: 'Retry content' }).click();
    await page.getByRole('heading', { name: failure.title, exact: true }).waitFor();
    // Old hash links resolve the correct market even with the other preference saved.
    await page.goto(`${base}/#/read/jp-mortgage-first-look`);
    await page.locator('.reader').waitFor();
    assert.equal(await page.locator('.brand-sg').innerText(), 'JP');
    await page.goto(`${base}/?market=SG#/read/does-not-exist`);
    await page.getByRole('heading', { name: 'We couldn’t find that report.' }).waitFor();
    await page.goto(`${base}/?market=SG#/read/2026-11-bto-launch-application-deadline`);
    await page.locator('.reader').waitFor();
    assert.equal(await page.locator('.reader-header .story-status').innerText(), 'Period ended');
    await fit();
    await page.screenshot({ path: join(output, 'mobile-historical-reader.png'), fullPage: true });
    measurements.finalCache = await stats();
    assert.deepEqual(errors, []);
    await Promise.all(pending);
    measurements.browser = {
      passed: true,
      totalEditorialResponses: responses.length,
      maxReadingRoomCards: 20,
      heap: 'Not measured; no claim about Chrome process RAM or immediate OS memory release.',
    };
    writeFileSync(join(output, 'measurements.json'), JSON.stringify(measurements, null, 2));
  }
  console.log(JSON.stringify(measurements, null, 2));
} finally {
  await browser?.close();
  server?.kill();
  rmSync(temp, { recursive: true, force: true });
}
