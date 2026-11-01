import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { nodePage } from '../scripts/collect';
import { CPF_URL, parseCpfBoard, renderedPage } from '../scripts/cpf-browser';
import { timingEvidence } from '../scripts/maybank-diagnostics';

// Synthetic CPF rendering fixture reusing known quarterly facts, not live CPF evidence.
const fixture = readFileSync(new URL('fixtures/cpf-askgov.html', import.meta.url), 'utf8').replace(
  'Updated by CPF',
  'A Singapore Government Agency Website CPF Board',
);
const at = '2026-11-01T04:00:00.000Z';

describe('read-only research', () => {
  it('validates CPF identity separately and still requires the published full quarter', () => {
    expect(parseCpfBoard(nodePage(fixture), CPF_URL, at).stages[0].rate).toBe(2.6);
    expect(() => parseCpfBoard(nodePage(fixture), 'https://example.com', at)).toThrow('identity');
    expect(() =>
      parseCpfBoard(
        nodePage(fixture.replace('A Singapore Government Agency Website CPF Board', 'other')),
        CPF_URL,
        at,
      ),
    ).toThrow('identity');
    expect(() => parseCpfBoard(nodePage(fixture.replace('2.60%', '2.70%')), CPF_URL, at)).toThrow(
      'inconsistent',
    );
    expect(() => parseCpfBoard(nodePage(fixture), CPF_URL, '2027-01-01T00:00:00Z')).toThrow(
      'cover',
    );
  });
  it('validates reduced evidence actually rendered on GitHub, including its real CPF Board branding', () => {
    const page = JSON.parse(readFileSync(new URL('fixtures/cpf-board-rendered.json', import.meta.url), 'utf8'));
    const offer = parseCpfBoard(page, CPF_URL, at);
    expect(offer).toMatchObject({ evidenceSourceId: 'cpf-board', method: 'browser',
      effectiveFrom: '2026-10-01', effectiveUntil: '2026-12-31', observedAt: at });
    expect(offer.stages[0].rate).toBe(2.6);
    expect(() => parseCpfBoard({ ...page, text: page.text.replace('A Singapore Government Agency Website', '') }, CPF_URL, at)).toThrow('identity');
  });
  it('reports the last recorded milestone without claiming a root cause or exporting raw curl metadata', () => {
    const raw = {
      time_namelookup: 0.01,
      time_connect: 0.02,
      time_appconnect: 0.05,
      time_starttransfer: 0,
      time_total: 30,
      size_download: 0,
      http_code: 0,
      remote_ip: 'private diagnostic',
      url_effective: 'https://example.com?secret=1',
    };
    expect(timingEvidence(raw)).toEqual({
      time_namelookup: 0.01,
      time_connect: 0.02,
      time_appconnect: 0.05,
      time_starttransfer: 0,
      time_total: 30,
      size_download: 0,
      http_code: 0,
      lastMilestone: 'TLS completed; no first response byte recorded',
    });
    expect(() => timingEvidence({})).toThrow();
    expect(timingEvidence({ ...raw, time_appconnect: 0 }).lastMilestone).toContain(
      'TLS completion not recorded',
    );
    expect(timingEvidence({ ...raw, time_starttransfer: 1 }).lastMilestone).toBe(
      'first response byte received',
    );
  });
  it.skipIf(process.env.RUN_BROWSER_TESTS !== '1')(
    'extracts JavaScript-rendered open shadow DOM and ignores hidden stale tables',
    async () => {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.setContent('<main id="host"></main><section hidden>Old quarter</section>');
        await page.evaluate(
          (html) => {
            document.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML = html;
          },
          fixture + '<div style="display:none">' + fixture + '</div>',
        );
        const result = await renderedPage(page);
        expect(result.tables).toHaveLength(1);
        expect(result.text).not.toContain('Old quarter');
        expect(parseCpfBoard(result, CPF_URL, at).effectiveUntil).toBe('2026-12-31');
      } finally {
        await browser.close();
      }
    },
  );
});
