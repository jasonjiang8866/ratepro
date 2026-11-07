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
  await page.getByLabel('A clearer path to your next home').waitFor();
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
    corpus.filter((a) => (a.market ?? 'SG') === 'SG' && a.category === 'guide').length,
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
  // SG uses the same scenario card and ring as JP, with its own currency and limits.
  const sgCalculator = page.getByRole('region', { name: 'SGD repayment calculator' });
  const sgRing = sgCalculator.getByRole('img', { name: /Constant-rate illustration/ });
  assert.equal(await page.getByLabel('Loan amount (S$)', { exact: true }).inputValue(), '500,000');
  assert.match(await sgCalculator.locator('.payment strong').innerText(), /2,268/);
  assert.match(
    await sgRing.getAttribute('aria-label'),
    /principal \$500,000, total interest \$180,504/,
  );
  assert.equal(await sgRing.locator('span').innerText(), '25\nyears');
  assert.match(await sgCalculator.locator('.payment').innerText(), /SGD/);
  await sgCalculator.locator('summary').click();
  assert.match(await sgCalculator.locator('details').innerText(), /CPF effects/);
  assert.doesNotMatch(await sgCalculator.locator('details').innerText(), /Flat35/);
  await sgCalculator.locator('summary').click();
  await sgCalculator.screenshot({ path: 'test-results/homepage/sg-calculator-desktop-light.png' });
  await page.setViewportSize({ width: 320, height: 740 });
  await fits();
  await sgCalculator.screenshot({ path: 'test-results/homepage/sg-calculator-mobile-light.png' });
  await page.getByRole('button', { name: 'Use dark theme', exact: true }).click();
  await sgCalculator.screenshot({ path: 'test-results/homepage/sg-calculator-mobile-dark.png' });
  await fits();
  await page.getByRole('button', { name: 'Use light theme', exact: true }).click();
  await page.getByLabel('Your assumed annual rate (%)').fill('0');
  assert.match(await sgCalculator.locator('.payment strong').innerText(), /1,667/);
  assert.match(await sgRing.getAttribute('aria-label'), /total interest \$0$/);
  assert.match(await sgRing.getAttribute('style'), /100%/);
  for (const [label, invalid, restore] of [
    ['Your assumed annual rate (%)', '', '2.6'],
    ['Tenure (years)', '36', '25'],
    ['Loan amount (S$)', '0', '500000'],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(invalid);
    assert.equal(await sgRing.count(), 0, 'Invalid scenarios must not retain a stale ring');
    assert.equal(await sgCalculator.locator('.payment strong').innerText(), '—');
    await page.getByLabel(label, { exact: true }).fill(restore);
    await sgRing.waitFor();
  }
  await page.getByLabel('Loan amount (S$)', { exact: true }).fill('750000');
  assert.match(await sgRing.getAttribute('aria-label'), /principal \$750,000/);
  await page.getByLabel('Loan amount (S$)', { exact: true }).fill('500000');
  await page.setViewportSize({ width: 1440, height: 1000 });
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
  // Countries must isolate content, data retrieval, currency and shared links.
  const jpRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/data/rates.json')) jpRequests.push(request.url());
  });
  await page.getByLabel('Country / market').selectOption('JP');
  await page.getByText('THE JAPAN HOME LOAN JOURNAL', { exact: true }).waitFor();
  assert.equal(await page.locator('.brand-sg').innerText(), 'JP');
  assert.equal(
    await page.locator('.story-row').count(),
    corpus.filter((a) => a.market === 'JP').length,
  );
  assert.equal(
    await page
      .locator('.journal')
      .innerText()
      .then((t) => /UOB|SORA|HDB/.test(t)),
    false,
  );
  await fits();
  await page.screenshot({ path: 'test-results/homepage/japan-mobile-light.png', fullPage: true });
  await page.reload();
  await page.getByText('THE JAPAN HOME LOAN JOURNAL', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Loan explorer', exact: true }).click();
  await page.getByRole('heading', { name: 'Published bank rates', exact: true }).waitFor();
  assert.equal(await page.locator('.jp-bank-card').count(), 2);
  const jpFeed = JSON.parse(readFileSync('public/data/rates-jp.json', 'utf8'));
  const expectedRate = (purpose) =>
    jpFeed.observations
      .find((o) => o.sourceId === 'jp-mufg')
      .rates.find((r) => r.kind === 'Variable' && r.purpose === purpose)
      .annualRate.toFixed(3) + '%';
  assert.match(
    await page.locator('.jp-bank-card').first().innerText(),
    new RegExp(expectedRate('Purchase').replace('.', '\\.')),
  );
  await page.getByLabel('Japan borrowing purpose').selectOption('Refinance');
  await page.getByRole('button', { name: 'Variable rates', exact: true }).click();
  assert.equal(await page.locator('.jp-bank-card').first().getByRole('checkbox').count(), 1);
  await page.locator('.jp-bank-card').first().getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.getByRole('region', { name: 'MUFG Bank rate table', exact: true }).waitFor();
  assert.equal(
    await page.locator('.jp-bank-card input:checked').count(),
    1,
    'View changes preserve selection',
  );
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  assert.equal(await page.locator('.jp-bank-card input:checked').count(), 1);
  await page.getByRole('button', { name: 'Show all types', exact: true }).click();
  assert.equal(
    await page.locator('.jp-bank-card input:checked').count(),
    0,
    'Rate-type filters clear selection',
  );
  assert.ok(
    (await page.locator('.jp-bank-card').first().innerText()).includes(expectedRate('Refinance')),
  );
  assert.equal(await page.getByLabel('Loan amount (JPY)').inputValue(), '30,000,000');
  await fits();
  await page.screenshot({ path: 'test-results/homepage/japan-rates-mobile.png', fullPage: true });
  // Compare terms without silently ranking different rate bases or purposes.
  const jpChecks = page.locator('.jp-bank-card').first().getByRole('checkbox');
  await jpChecks.nth(0).check();
  assert.equal(
    await page.getByRole('button', { name: 'Compare terms', exact: true }).isEnabled(),
    false,
  );
  await jpChecks.nth(1).check();
  await page.locator('.jp-bank-card').nth(1).locator('summary').first().click();
  await page.locator('.jp-bank-card').nth(1).getByRole('checkbox').first().check();
  assert.equal(await jpChecks.nth(2).isEnabled(), false, 'Selection capped at three');
  await fits();
  await page.getByRole('button', { name: 'Compare terms', exact: true }).click();
  const jpDialog = page.getByRole('dialog', { name: 'Compare Japan loan terms' });
  await jpDialog.waitFor();
  assert.equal(await jpDialog.locator('.comparison-visual-card').count(), 3);
  assert.equal(
    await jpDialog.getByRole('link', { name: /official rates/ }).count(),
    0,
    'Full terms start collapsed',
  );
  await page.screenshot({ path: 'test-results/homepage/japan-comparison-cards-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/homepage/japan-comparison-cards-desktop.png' });
  await page.setViewportSize({ width: 320, height: 740 });
  await jpDialog.getByText('Full terms, fees & sources', { exact: true }).click();
  assert.match(await jpDialog.innerText(), /Different rate bases/);
  assert.match(await jpDialog.innerText(), /Different rate types or fixed periods/);
  assert.match(await jpDialog.innerText(), /To verify/);
  assert.equal(await jpDialog.getByRole('link', { name: /official rates/ }).count(), 3);
  assert.equal(
    await jpDialog
      .getByRole('row', { name: /Borrowing purpose/ })
      .innerText()
      .then((t) => (t.match(/Refinance/g) ?? []).length),
    3,
  );
  assert.ok(
    await jpDialog
      .getByRole('row', { name: /Published annual rate/ })
      .innerText()
      .then((t) => t.includes(expectedRate('Refinance'))),
  );
  await page.screenshot({ path: 'test-results/homepage/japan-comparison-mobile.png' });
  const jpMobileGeometry = await jpDialog.evaluate((el) => ({
    dialog: { clientWidth: el.clientWidth, scrollWidth: el.scrollWidth },
    children: [...el.children].map((child) => ({
      tag: child.tagName,
      class: child.className,
      clientWidth: child.clientWidth,
      scrollWidth: child.scrollWidth,
    })),
  }));
  assert.equal(
    jpMobileGeometry.dialog.scrollWidth <= jpMobileGeometry.dialog.clientWidth,
    true,
    `Mobile dialog contains the table overflow: ${JSON.stringify(jpMobileGeometry)}`,
  );
  await fits();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/homepage/japan-comparison-desktop.png' });
  await jpDialog
    .getByRole('button', { name: /^Remove / })
    .last()
    .click();
  assert.equal(
    await jpDialog
      .getByRole('note', { name: 'Comparison differences' })
      .innerText()
      .then((t) => t.includes('Different rate bases')),
    false,
  );
  await page.keyboard.press('Escape');
  await jpDialog.waitFor({ state: 'hidden' });
  assert.equal(await jpDialog.count(), 0);
  assert.equal(
    await page
      .getByRole('button', { name: 'Compare terms', exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(await jpChecks.nth(2).isEnabled(), true);
  await page.getByLabel('Japan borrowing purpose').selectOption('Purchase');
  assert.equal(await page.getByLabel('Japan comparison selection').count(), 0);
  assert.equal(await page.locator('.jp-bank-card input:checked').count(), 0);
  await jpChecks.nth(0).check();
  await jpChecks.nth(1).check();
  await page.getByRole('button', { name: 'Compare terms', exact: true }).click();
  await jpDialog
    .getByRole('button', { name: /^Remove / })
    .first()
    .click();
  await jpDialog.waitFor({ state: 'hidden' });
  assert.equal(await jpDialog.count(), 0, 'Removing down to one closes comparison');
  await page.getByRole('button', { name: 'Clear Japan comparison', exact: true }).click();
  assert.equal(await page.locator('.jp-bank-card input:checked').count(), 0);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByLabel('Your assumed annual rate (%)').fill('2');
  await page.getByRole('img', { name: /Constant-rate illustration: principal/ }).waitFor();
  await page.screenshot({
    path: 'test-results/homepage/japan-repayment-ring-mobile.png',
    fullPage: true,
  });
  assert.match(await page.locator('.payment strong').innerText(), /[¥￥]/);
  assert.equal(await page.locator('.offer-card').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Refresh rates', exact: true }).count(), 0);
  await page.getByLabel('Your assumed annual rate (%)').fill('');
  assert.equal(
    await page.getByRole('img', { name: /Constant-rate illustration: principal/ }).count(),
    0,
  );
  assert.equal(await page.locator('.payment strong').innerText(), '—');
  await page.getByLabel('Your assumed annual rate (%)').fill('0');
  assert.match(await page.locator('.payment strong').innerText(), /71,429/);
  await fits();
  await page.getByRole('link', { name: 'Our sources', exact: true }).click();
  await page.getByRole('heading', { name: 'Follow Japan’s sources.' }).waitFor();
  assert.equal(await page.locator('.jp-tools a[href*=".sg"]').count(), 0);
  assert.deepEqual(jpRequests, [], 'Japan must not request the Singapore rate feed');
  const offline = await context.newPage();
  await offline.route('**/data/rates-jp.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ market: 'SG' }),
    }),
  );
  await offline.goto(`${base}/?market=JP#/rates`);
  await offline.getByRole('status').filter({ hasText: 'Published feed unavailable' }).waitFor();
  assert.equal(await offline.locator('.jp-bank-card').count(), 2);
  assert.ok(
    (await offline.locator('.jp-bank-card').first().innerText()).includes(expectedRate('Purchase')),
  );
  await offline.close();

  await page.getByRole('link', { name: 'RatePro home', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/homepage/japan-desktop-light.png', fullPage: true });
  await page.getByRole('button', { name: 'Use dark theme', exact: true }).click();
  await page.screenshot({ path: 'test-results/homepage/japan-desktop-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/homepage/japan-mobile-dark.png', fullPage: true });
  await page.getByRole('link', { name: 'Read terms & evidence', exact: true }).first().click();
  await page.getByRole('heading', { name: 'The eligibility & conditions' }).waitFor();
  assert.match(await page.locator('.reader-sources').innerText(), /JST/);
  await page.reload();
  await page.getByRole('heading', { name: 'The eligibility & conditions' }).waitFor();
  await page.getByLabel('Country / market').selectOption('SG');
  await page.getByText('THE SINGAPORE HOME LOAN JOURNAL', { exact: true }).waitFor();
  await page.goBack();
  await page.getByRole('heading', { name: 'The eligibility & conditions' }).waitFor();
  assert.equal(await page.locator('.brand-sg').innerText(), 'JP');
  await page.goForward();
  await page.getByText('THE SINGAPORE HOME LOAN JOURNAL', { exact: true }).waitFor();
  // Saved JP never changes the meaning of an old Singapore hash link.
  await page.getByLabel('Country / market').selectOption('JP');
  await page.goto(`${base}/#/read/2026-11-hdb-quarter`);
  await page.getByRole('heading', { name: 'At a glance', exact: true }).waitFor();
  assert.equal(await page.locator('.brand-sg').innerText(), 'SG');
  await page.goto(`${base}/?market=JP#/read/2026-11-hdb-quarter`);
  await page.getByRole('heading', { name: 'We couldn’t find that report.' }).waitFor();
  await page.goto(`${base}/?market=UNKNOWN#/home`);
  await page.getByText('THE SINGAPORE HOME LOAN JOURNAL', { exact: true }).waitFor();
  assert.deepEqual(errors, [], 'No runtime errors');
  console.log(
    'Homepage UI checks passed: navigation, filters, deep links, directory, sources, mobile, themes and overflow.',
  );
} finally {
  await browser?.close();
  server.kill();
}
