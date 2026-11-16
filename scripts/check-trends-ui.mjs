import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:4174';
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4174',
    '--strictPort',
  ],
  { stdio: 'inherit' },
);
let browser;
try {
  for (let i = 0; i < 60; i++) {
    if (
      await fetch(base)
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    if (server.exitCode !== null || i === 59) throw Error('Preview unavailable');
    await new Promise((r) => setTimeout(r, 250));
  }
  mkdirSync('test-results/trends', { recursive: true });
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    colorScheme: 'light',
  });
  await context.route('**/*', (r) =>
    r.request().url().startsWith(base) ? r.continue() : r.abort(),
  );
  const page = await context.newPage(),
    requests = [],
    errors = [];
  page.on('request', (r) => {
    if (r.url().includes('/data/analytics/')) requests.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const fits = async () =>
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'No viewport overflow',
    );
  await page.goto(base + '/?market=SG#/trends');
  await page.getByRole('heading', { name: 'Mortgage rate trends.' }).waitFor();
  await page.getByRole('group', { name: 'Mortgage rate trend chart' }).waitFor();
  assert.equal(requests.filter((u) => u.endsWith('/index.json')).length, 1);
  assert.equal(
    requests.filter((u) => /\/\d{4}\.json$/.test(u)).length,
    1,
    'Only selected product is loaded',
  );
  await page.getByLabel('Trend bank', { exact: true }).selectOption('Maybank');
  await page.getByLabel('Trend product', { exact: true }).selectOption('maybank-fixed-2y');
  await page.getByLabel('Compare matching basis').selectOption('sbi-fixed-2y');
  await page.locator('.trend-legend span').nth(1).waitFor();
  assert.match(await page.locator('.trend-legend').innerText(), /Maybank/);
  assert.match(await page.locator('.trend-legend').innerText(), /SBI/);
  const circles = page.locator('.trend-chart circle');
  await circles.first().focus();
  await page.keyboard.press('Enter');
  assert.match(await page.locator('.trend-point').innerText(), /Observed 2026/);
  await page.getByRole('link', { name: 'Published terms ↗', exact: true }).waitFor();
  for (const range of ['1M', '3M', '6M', '1Y', 'All']) {
    await page.getByRole('button', { name: range, exact: true }).click();
    await page.getByRole('group', { name: 'Mortgage rate trend chart' }).waitFor();
  }
  await fits();
  await page.screenshot({ path: 'test-results/trends/sg-desktop.png', fullPage: true });
  await page.getByLabel('Trend product', { exact: true }).selectOption('maybank-sora-1m');
  await page.getByText(/Spread only: this excludes/).waitFor();
  await page.getByRole('group', { name: 'Mortgage rate trend chart' }).waitFor();
  assert.equal(await page.getByLabel('Compare matching basis').inputValue(), '');
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    await fits();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Use dark theme', exact: true }).click();
  assert.equal(await page.locator('.trend-chart').getAttribute('viewBox'), '0 0 400 300');
  await page.screenshot({ path: 'test-results/trends/sg-mobile-dark.png', fullPage: true });
  await page.getByLabel('Trend market', { exact: true }).selectOption('JP');
  assert.match(page.url(), /market=JP#\/trends/);
  await page.getByRole('group', { name: 'Mortgage rate trend chart' }).waitFor();
  const jpIndex = JSON.parse(readFileSync('public/data/analytics/v1/JP/index.json', 'utf8'));
  const primary = await page.getByLabel('Trend product', { exact: true }).inputValue();
  const primaryMeta = jpIndex.products.find((p) => p.productId === primary);
  const options = await page
    .getByLabel('Compare matching basis')
    .locator('option')
    .evaluateAll((options) => options.map((o) => o.value).filter(Boolean));
  assert.ok(
    options.every(
      (id) =>
        jpIndex.products.find((p) => p.productId === id).comparisonKey ===
        primaryMeta.comparisonKey,
    ),
    'JP pricing bases cannot mix',
  );
  await page.getByText(/Applied and standard rates are kept separate/).waitFor();
  await fits();
  await page.screenshot({ path: 'test-results/trends/jp-mobile-dark.png', fullPage: true });
  await page.reload();
  await page.getByRole('group', { name: 'Mortgage rate trend chart' }).waitFor();
  assert.equal(await page.getByLabel('Trend market', { exact: true }).inputValue(), 'JP');
  // Deterministic failure, loading and empty states against real built components.
  const empty = await context.newPage();
  await empty.route('**/data/analytics/v1/SG/index.json', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...JSON.parse(readFileSync('public/data/analytics/v1/SG/index.json', 'utf8')),
        products: [],
        sources: [],
        recentEvents: [],
        firstObservedAt: null,
        lastSuccessfulCollection: null,
      }),
    }),
  );
  await empty.goto(base + '/?market=SG#/trends');
  await empty.getByText('No historical products yet.').waitFor();
  await empty.close();
  const failure = await context.newPage();
  await failure.route('**/data/analytics/v1/SG/index.json', (r) => r.fulfill({ status: 503 }));
  await failure.goto(base + '/?market=SG#/trends');
  await failure.getByRole('alert').waitFor();
  await failure.unroute('**/data/analytics/v1/SG/index.json');
  await failure.getByRole('button', { name: 'Retry historical data' }).click();
  await failure.getByRole('group', { name: 'Mortgage rate trend chart' }).waitFor();
  await failure.close();
  const missing = await context.newPage();
  await missing.route('**/data/analytics/v1/SG/*/2026.json', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        market: 'SG',
        productId: r.request().url().split('/').at(-2),
        year: 2026,
        points: [],
      }),
    }),
  );
  await missing.goto(base + '/?market=SG#/trends');
  await missing.getByText(/No numeric observations in this window/).waitFor();
  await missing.close();
  assert.deepEqual(errors, []);
  console.log(
    'Trend UI checks passed: lazy series loading, bank comparison, pricing isolation, ranges, keyboard evidence, SG/JP navigation, mobile/dark, empty/error/retry.',
  );
} finally {
  await browser?.close();
  server.kill();
}
