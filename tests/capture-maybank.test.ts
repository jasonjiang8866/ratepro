import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildMaybankCandidate, digest } from '../scripts/capture-maybank';
import { validateMaybankCandidate } from '../scripts/maybank-diagnostics';
import { FeedSchema, sourceFor } from '../src/lib/schema';
import { MAYBANK_ACCEPT_LANGUAGE, requestMaybank } from '../scripts/maybank-transport';
import { MAX_BYTES } from '../src/lib/data';

const body = readFileSync(new URL('fixtures/maybank.html', import.meta.url));
const fixture = FeedSchema.parse(
  JSON.parse(readFileSync(new URL('fixtures/feed.json', import.meta.url), 'utf8')),
);
const previousAt = '2026-11-01T00:00:00.000Z';
const observedAt = '2026-11-14T12:00:20.000Z';
const now = Date.parse('2026-11-14T12:01:00.000Z');
const previous = FeedSchema.parse({
  ...fixture,
  offers: [...fixture.offers, ...validateMaybankCandidate(body, 200, previousAt)],
  sources: [
    ...fixture.sources,
    {
      sourceId: 'maybank',
      status: 'error',
      attemptedAt: previousAt,
      message: 'GitHub timeout; prior observations retained',
      failureKind: 'timeout',
      attempts: 2,
    },
  ],
});
const base = Buffer.from(JSON.stringify(previous));
function capture(): Awaited<ReturnType<typeof requestMaybank>> {
  return {
    body,
    report: {
      url: sourceFor('maybank').url,
      mode: 'default',
      arguments: ['--http1.1'],
      startedAt: '2026-11-14T12:00:00.000Z',
      finishedAt: observedAt,
      platform: 'linux',
      architecture: 'x64',
      exitCode: 0,
      timing: {
        time_namelookup: 0.01,
        time_connect: 0.02,
        time_appconnect: 0.03,
        time_starttransfer: 0.04,
        time_total: 0.05,
        size_download: body.length,
        http_code: 200,
        lastMilestone: 'first response byte received',
      },
      bytes: body.length,
      sha256: digest(body),
      outcome: 'validated',
      offers: validateMaybankCandidate(body, 200, observedAt),
      parseError: undefined,
      policy: 'test fixture',
    },
  };
}
describe('live Maybank candidate', () => {
  it('updates exactly four observations and preserves other offers and all scheduled health', () => {
    const { candidate, evidence } = buildMaybankCandidate(base, capture(), now);
    const next = JSON.parse(candidate);
    expect(next.offers.filter((o: { sourceId: string }) => o.sourceId !== 'maybank')).toEqual(
      fixture.offers,
    );
    expect(next.sources).toEqual(previous.sources);
    expect(next.offers.filter((o: { sourceId: string }) => o.sourceId === 'maybank')).toEqual(
      validateMaybankCandidate(body, 200, observedAt),
    );
    expect(evidence).toMatchObject({
      baseSha256: digest(base),
      bodySha256: digest(body),
      candidateSha256: digest(candidate),
      scheduledHealthPreserved: true,
    });
    expect(evidence.changes).toHaveLength(4);
  });
  it.each(['denial', 'timeout', 'tamper', 'wrong-url', 'experimental'])(
    'rejects %s before creating a candidate',
    (kind) => {
      const input = capture();
      if (kind === 'denial') input.report.timing!.http_code = 403;
      if (kind === 'timeout') input.report.exitCode = 28;
      if (kind === 'tamper') input.body = Buffer.from('tampered');
      if (kind === 'wrong-url') input.report.url = sourceFor('hdb').url;
      if (kind === 'experimental') input.report.mode = 'tls12';
      expect(() => buildMaybankCandidate(base, input, now)).toThrow('No validated');
    },
  );
  it('reparses the original body instead of trusting stored offers', () => {
    const input = capture();
    input.body = Buffer.from('<body>Contact us for rates</body>');
    input.report.sha256 = digest(input.body);
    input.report.bytes = input.body.length;
    expect(() => buildMaybankCandidate(base, input, now)).toThrow('eligibility');
  });
  it.each([now + 600_001, now - 120_000])('rejects stale or future capture times', (clock) => {
    expect(() => buildMaybankCandidate(base, capture(), clock)).toThrow('timing');
  });
  it('refuses old observations and changed product IDs', () => {
    const newer = structuredClone(previous);
    newer.offers
      .filter((o) => o.sourceId === 'maybank')
      .forEach((o) => {
        o.observedAt = observedAt;
      });
    expect(() => buildMaybankCandidate(Buffer.from(JSON.stringify(newer)), capture(), now)).toThrow(
      'not newer',
    );
    const missing = {
      ...previous,
      offers: previous.offers.filter((o) => o.id !== 'maybank-fixed-2y'),
    };
    expect(() =>
      buildMaybankCandidate(Buffer.from(JSON.stringify(missing)), capture(), now),
    ).toThrow('IDs changed');
  });
});

describe('Maybank Node fetch transport', () => {
  it('sends Accept-Language: en-SG,en;q=0.9 with strict fetch options and validates 4 offers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const result = await requestMaybank('default', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(sourceFor('maybank').url);
    expect(new Headers(init?.headers).get('accept-language')).toBe(MAYBANK_ACCEPT_LANGUAGE);
    expect(new Headers(init?.headers).has('user-agent')).toBe(false);
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-cache', redirect: 'error' });
    expect(result.report.outcome).toBe('validated');
    expect(result.report.exitCode).toBe(0);
    expect(result.report.timing?.http_code).toBe(200);
    expect(result.report.bytes).toBe(body.length);
    expect(result.report.sha256).toBe(digest(body));
    expect(result.report.offers).toHaveLength(4);
    expect(result.body?.equals(body)).toBe(true);
  });

  it('rejects HTTP errors, timeouts, and oversized bodies without returning a body', async () => {
    const denied = await requestMaybank(
      'default',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('error', { status: 500 })),
    );
    expect(denied.report.outcome).toBe('failed');
    expect(denied.report.timing?.http_code).toBe(500);
    expect(denied.body).toBeUndefined();

    const timedOut = await requestMaybank(
      'default',
      vi.fn<typeof fetch>().mockRejectedValue(new DOMException('slow', 'TimeoutError')),
    );
    expect(timedOut.report.outcome).toBe('failed');
    expect(timedOut.report.exitCode).toBe(28);
    expect(timedOut.body).toBeUndefined();

    const oversized = await requestMaybank(
      'default',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(new Uint8Array(MAX_BYTES + 1), { status: 200 })),
    );
    expect(oversized.report.outcome).toBe('failed');
    expect(oversized.report.parseError).toContain('too large');
    expect(oversized.body).toBeUndefined();
  });
});
