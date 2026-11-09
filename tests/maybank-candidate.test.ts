import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_BYTES } from '../src/lib/data';
import { validateMaybankCandidate } from '../scripts/maybank-diagnostics';

const html = readFileSync(new URL('fixtures/maybank.html', import.meta.url), 'utf8');
const at = '2026-11-09T17:00:00Z';
const bytes = (text: string) => new TextEncoder().encode(text);

describe('Maybank public country-page candidate', () => {
  it('requires all four schedules and preserves fixed rates, tenor, spreads and eligibility', () => {
    const offers = validateMaybankCandidate(bytes(html), 200, at);
    expect(offers).toHaveLength(4);
    expect(offers[0]).toMatchObject({ kind: 'Fixed', minLoan: 100000, construction: 'Completed' });
    expect(offers[0].stages.at(-1)).toMatchObject({
      rate: null,
      benchmark: { tenor: '1M', spread: 1 },
    });
    expect(offers[3].stages[0]).toMatchObject({
      rate: null,
      benchmark: { tenor: '3M', spread: 0.7 },
    });
    expect(offers.every((o) => o.observedAt === at)).toBe(true);
  });
  it.each([0, 301, 403, 429, 500])(
    'rejects HTTP %s even when a cached-looking table is present',
    (status) => {
      expect(() => validateMaybankCandidate(bytes(html), status, at)).toThrow('no extraction');
    },
  );
  it.each([
    '<body><div id="app"></div></body>',
    '<body>Contact our mortgage specialist for rates</body>',
    html.replace('2-year Fixed Rate', 'Special offer'),
    html.replaceAll('Minimum', 'Unavailable').replaceAll('minimum', 'unavailable'),
    html + html,
  ])('does not turn HTTP 200 into a complete quote when fields are missing', (page) => {
    expect(() => validateMaybankCandidate(bytes(page), 200, at)).toThrow();
  });
  it('bounds the candidate document', () => {
    expect(() => validateMaybankCandidate(new Uint8Array(), 200, at)).toThrow();
    expect(() => validateMaybankCandidate(new Uint8Array(MAX_BYTES + 1), 200, at)).toThrow();
  });
});
