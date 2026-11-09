import { readFileSync } from 'node:fs';
import { chromium, type BrowserContext } from 'playwright';
import { describe, expect, it } from 'vitest';
import { nodePage } from '../scripts/collect';
import {
  inspectMaybankBrowser,
  browserNetworkError,
  MAYBANK_URL,
  parseMaybankBrowser,
} from '../scripts/maybank-browser';

const fixture = readFileSync(new URL('fixtures/maybank.html', import.meta.url), 'utf8');
const at = '2026-11-09T17:00:00.000Z';

describe('Maybank browser research validation', () => {
  it('preserves digits in protocol error codes without exporting raw browser logs', () => {
    expect(
      browserNetworkError(
        'page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://example.com?token=private',
      ),
    ).toBe('net::ERR_HTTP2_PROTOCOL_ERROR');
    expect(browserNetworkError('Timeout 30000ms exceeded.')).toBeUndefined();
  });
  it('retains four complete schedules with browser provenance and no invented dates', () => {
    const offers = parseMaybankBrowser(nodePage(fixture), MAYBANK_URL, 200, at);
    expect(offers).toHaveLength(4);
    expect(offers.every((o) => o.method === 'browser' && o.observedAt === at)).toBe(true);
    expect(offers.every((o) => !o.documentDate && !o.effectiveFrom && !o.effectiveUntil)).toBe(
      true,
    );
    expect(offers[3].stages[0]).toMatchObject({
      rate: null,
      benchmark: { tenor: '3M', spread: 0.7 },
    });
  });
  it('rejects denial/challenge content and changed URLs even with complete rate-looking tables', () => {
    expect(() => parseMaybankBrowser(nodePage(fixture), MAYBANK_URL, 403, at)).toThrow('HTTP');
    expect(() =>
      parseMaybankBrowser(nodePage(fixture), MAYBANK_URL + '?changed=1', 200, at),
    ).toThrow('URL');
    expect(() =>
      parseMaybankBrowser(nodePage('Verify you are human' + fixture), MAYBANK_URL, 200, at),
    ).toThrow('challenge');
    expect(() =>
      parseMaybankBrowser(
        nodePage(fixture.replace('Year 1 to Year 3', 'Call us')),
        MAYBANK_URL,
        200,
        at,
      ),
    ).toThrow();
  });
});

describe.skipIf(process.env.RUN_BROWSER_TESTS !== '1')(
  'Maybank isolated Chromium integration',
  () => {
    // Every network request is intercepted: these tests never contact a bank.
    async function run(setup: (context: BrowserContext) => Promise<void>) {
      const browser = await chromium.launch();
      try {
        const context = await browser.newContext();
        await context.route('**/*', (route) => route.abort());
        await setup(context);
        return await inspectMaybankBrowser(await context.newPage(), {
          navigationTimeout: 1000,
          renderTimeout: 700,
        });
      } finally {
        await browser.close();
      }
    }
    it('waits for JS-rendered tables, ignores hidden stale tables, and preserves the field mapping', async () => {
      const result = await run(async (context) => {
        await context.route(MAYBANK_URL, (route) =>
          route.fulfill({
            contentType: 'text/html',
            body: `<div hidden>${fixture}</div><main></main><script>setTimeout(() => { document.querySelector('main').innerHTML = ${JSON.stringify(fixture)}; }, 100)</script>`,
          }),
        );
      });
      expect(result.report.status).toBe('validated-candidate');
      expect(result.report.offers).toHaveLength(4);
      expect(result.evidence?.tables).toHaveLength(4);
    });
    it.each([
      [403, {}, fixture],
      [429, {}, fixture],
      [200, { 'cf-mitigated': 'challenge' }, fixture],
      [200, {}, 'Verify you are human' + fixture],
      [302, { location: 'https://example.com/login' }, ''],
    ])(
      'stops on denial/challenge/redirect (%s), without a retry or extracted offers',
      async (status, headers, body) => {
        let requests = 0;
        const result = await run(async (context) => {
          await context.route(MAYBANK_URL, (route) => {
            requests++;
            return route.fulfill({ status, headers, contentType: 'text/html', body });
          });
        });
        expect(requests).toBe(1);
        expect(result.report.status).toBe('failed');
        expect(result.report.offers).toBeUndefined();
        expect(result.report.observedAt).toBeUndefined();
        expect(result.evidence).toBeUndefined();
      },
    );
    it.each([
      '<main id="app"></main>',
      'Contact our mortgage specialist for rates',
      fixture.replace('3.30% p.a.', '<span hidden>3.30% p.a.</span>'),
    ])('does not treat HTTP 200 or hidden/missing fields as collection success', async (body) => {
      const result = await run(async (context) => {
        await context.route(MAYBANK_URL, (route) =>
          route.fulfill({ contentType: 'text/html', body }),
        );
      });
      expect(result.report.mainStatus).toBe(200);
      expect(result.report.status).toBe('failed');
      expect(result.report.offers).toBeUndefined();
      expect(result.report.validationError).toBeTruthy();
    });
    it('reports a network failure separately from a received page that cannot be parsed', async () => {
      const result = await run(async (context) => {
        await context.route(MAYBANK_URL, (route) => route.abort('timedout'));
      });
      expect(result.report).toMatchObject({
        status: 'failed',
        phase: 'navigation',
        networkError: 'net::ERR_TIMED_OUT',
      });
      expect(result.report.mainStatus).toBeUndefined();
      expect(result.report.validationError).toBeUndefined();
    });
  },
);
