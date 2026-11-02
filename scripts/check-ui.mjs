import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const corpus = ['insights', 'promotions'].flatMap((folder) =>
  readdirSync(`content/${folder}`)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(`content/${folder}/${file}`, 'utf8'))),
);
const base = 'http://127.0.0.1:4173';
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4173',
    '--strictPort',
  ],
  { stdio: 'inherit' },
);
let browser;
try {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Preview server exited');
    if (
      await fetch(base)
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    if (i === 59) throw new Error('Preview not ready');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  mkdirSync('test-results/homepage', { recursive: true });
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
  });
  // This suite tests the built UI, not external lender retrieval.
  await context.route('**/*', (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const fits = async () =>
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      'No horizontal overflow',
    );
  await page.goto(base);
  await page.getByRole('heading', { name: /A little context/ }).waitFor();
  await fits();
  assert.equal(await page.locator('h1').count(), 1);
  await page.screenshot({
    path: 'test-results/homepage/desktop-light.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Buying & refinancing guides', exact: true }).click();
  assert.equal(
    await page.locator('.story-row').count(),
    corpus.filter((a) => a.category === 'guide').length,
  );
  await page.getByRole('button', { name: 'All stories', exact: true }).click();
  assert.ok((await page.locator('.story-row').count()) >= 3);
  await page.getByRole('link', { name: 'Read the briefing', exact: true }).click();
  await page.getByRole('heading', { name: 'At a glance', exact: true }).waitFor();
  assert.match(page.url(), /#\/read\//);
  assert.equal(await page.locator('h1').count(), 1);
  assert.ok((await page.locator('.reader-sources a[href^="https://"]').count()) >= 1);
  await fits();
  await page.screenshot({
    path: 'test-results/homepage/article-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.reload();
  await page.getByRole('heading', { name: 'At a glance', exact: true }).waitFor();
  await page.goBack();
  await page.getByRole('heading', { name: /A little context/ }).waitFor();
  await page.getByRole('link', { name: 'Compare home loans', exact: true }).click();
  await page.getByRole('heading', { name: 'Find your starting point' }).waitFor();
  // The skip link must not overwrite the hash route or send readers home.
  await page.getByRole('link', { name: 'Skip to content', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.match(page.url(), /#\/rates$/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'main');
  await page.locator('.offer-card').first().waitFor();
  assert.equal(
    await page.locator('.offer-card').count(),
    JSON.parse(readFileSync('public/data/rates.json', 'utf8')).offers.length,
  );
  await page.getByRole('heading', { name: 'Make the numbers real.' }).waitFor();
  await page.getByRole('link', { name: 'Our sources', exact: true }).click();
  await page.getByRole('heading', { name: 'Follow the information back.' }).waitFor();
  await page.getByRole('link', { name: 'RatePro home', exact: true }).click();
  await page.getByRole('heading', { name: /A little context/ }).waitFor();
  await page.getByRole('button', { name: 'Use dark theme', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('class'), 'dark');
  await page.screenshot({
    path: 'test-results/homepage/desktop-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await fits();
  await page.screenshot({
    path: 'test-results/homepage/mobile-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Use light theme', exact: true }).click();
  await page.screenshot({
    path: 'test-results/homepage/mobile-light.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('link', { name: 'Read terms & evidence', exact: true }).first().click();
  await page.getByRole('heading', { name: 'The eligibility & conditions' }).waitFor();
  await fits();
  await page.screenshot({
    path: 'test-results/homepage/article-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.goto(`${base}/#/read/does-not-exist`);
  await page.getByRole('heading', { name: 'We couldn’t find that report.' }).waitFor();
  await page.getByRole('link', { name: 'Back to the journal', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  await fits();
  await page.keyboard.press('Tab');
  assert.deepEqual(errors, [], 'No runtime errors');
  console.log(
    'Homepage UI checks passed: navigation, filters, deep links, directory, sources, mobile, themes and overflow.',
  );
} finally {
  await browser?.close();
  server.kill();
}
