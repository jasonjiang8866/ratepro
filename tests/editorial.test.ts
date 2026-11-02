import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { validateArticles, editorialStatus, singaporeDay } from '../src/lib/editorial';
import baseline from '../content/insights/2026-11-hdb-quarter.json';
import promotion from '../content/promotions/2026-11-uob-sora-baseline.json';
const now = new Date('2026-11-03T00:00:00Z');
const copy = () => structuredClone(baseline);
describe('editorial publication contract', () => {
  it('validates the checked-in corpus, separately from rate observations', () => {
    const records = ['insights', 'promotions'].flatMap((folder) =>
      readdirSync(`content/${folder}`)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(`content/${folder}/${f}`, 'utf8'))),
    );
    expect(validateArticles(records)).toHaveLength(records.length);
  });
  it('rejects duplicate slugs and duplicate underlying events', () => {
    expect(() => validateArticles([baseline, baseline], now)).toThrow('Duplicate');
    expect(() => validateArticles([baseline, { ...baseline, slug: 'another-title' }], now)).toThrow(
      'Duplicate',
    );
  });
  it('rejects missing or dangling evidence for takeaways, facts and interpretation', () => {
    const a = copy();
    a.takeaways[0].sourceIds = [];
    expect(() => validateArticles([a], now)).toThrow();
    a.takeaways[0].sourceIds = ['missing'];
    expect(() => validateArticles([a], now)).toThrow('Unknown evidence');
    a.takeaways[0].sourceIds = ['cpf'];
    a.sections[2].sourceIds = ['missing'];
    expect(() => validateArticles([a], now)).toThrow('Unknown evidence');
  });
  it('rejects unsafe links and duplicate evidence IDs', () => {
    const a = copy();
    a.sources[0].url = 'javascript:alert(1)';
    expect(() => validateArticles([a], now)).toThrow();
    a.sources[0].url = 'https://user:password@cpf.gov.sg/';
    expect(() => validateArticles([a], now)).toThrow();
    a.sources[0] = a.sources[1];
    expect(() => validateArticles([a], now)).toThrow('Duplicate source');
  });
  it('rejects impossible, future and inconsistent dates', () => {
    expect(() => validateArticles([{ ...baseline, reportDate: '2026-02-30' }], now)).toThrow();
    expect(() => validateArticles([{ ...baseline, reportDate: '2026-11-04' }], now)).toThrow(
      'Future report',
    );
    const a = copy();
    a.sources[0].checkedAt = '2026-11-04T00:00:00Z';
    expect(() => validateArticles([a], now)).toThrow('Future check');
    a.sources[0].checkedAt = '2026-11-03T00:00:00Z';
    expect(() => validateArticles([a], now)).toThrow('Future check');
    a.sources[0] = { ...baseline.sources[0], documentDate: '2026-11-03' };
    expect(() => validateArticles([a], now)).toThrow('Future source document');
    expect(() => validateArticles([{ ...baseline, effectiveUntil: '2026-09-30' }], now)).toThrow(
      'Inverted',
    );
  });
  it('requires package-specific eligibility and conditions', () => {
    expect(() => validateArticles([{ ...promotion, package: null }], now)).toThrow('mismatch');
    expect(() =>
      validateArticles([{ ...promotion, package: { ...promotion.package, eligibility: '' } }], now),
    ).toThrow();
    expect(() =>
      validateArticles(
        [{ ...promotion, package: { ...promotion.package, sourceIds: ['missing'] } }],
        now,
      ),
    ).toThrow('Unknown evidence');
  });
  it('keeps an unknown offer deadline unknown', () => {
    const [a] = validateArticles([promotion], now);
    expect(a.package?.expiry).toBeNull();
    expect(editorialStatus(a, now)).toBe('Baseline · not a new launch');
    expect(editorialStatus(a, new Date('2026-11-10T00:00:00Z'))).toBe('Recheck needed');
  });
  it('expires at Singapore midnight without altering source checks', () => {
    const [a] = validateArticles([baseline], now);
    const before = JSON.stringify(a);
    expect(editorialStatus(a, new Date('2026-12-31T15:59:59Z'))).toBe('Recheck needed');
    expect(editorialStatus(a, new Date('2026-12-31T16:00:00Z'))).toBe('Period ended');
    expect(JSON.stringify(a)).toBe(before);
    expect(singaporeDay(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
  });
  it('recognises future effective periods but allows confirmed advance announcements', () => {
    const [a] = validateArticles([{ ...baseline, effectiveFrom: '2026-12-01' }], now);
    expect(editorialStatus(a, now)).toBe('Upcoming period');
  });
  it('requires corrections to reference a real earlier report', () => {
    expect(() => validateArticles([{ ...baseline, supersedes: 'missing' }], now)).toThrow(
      'Invalid supersedes',
    );
    expect(() => validateArticles([{ ...baseline, supersedes: baseline.slug }], now)).toThrow(
      'Invalid supersedes',
    );
    expect(
      validateArticles(
        [
          baseline,
          {
            ...baseline,
            slug: 'correction',
            eventKey: 'correction-event',
            reportDate: '2026-11-03',
            supersedes: baseline.slug,
          },
        ],
        now,
      ),
    ).toHaveLength(2);
  });
});
