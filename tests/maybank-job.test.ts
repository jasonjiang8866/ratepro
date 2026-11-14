import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import {
  prepareMaybankJob,
  submitMaybankJob,
  githubApi,
  REPO,
  type Api,
} from '../scripts/maybank-job';
import { validateMaybankCandidate } from '../scripts/maybank-diagnostics';
import { digest } from '../scripts/capture-maybank';
import { sourceFor } from '../src/lib/schema';
import type { requestMaybank } from '../scripts/maybank-transport';

const HEAD = 'a'.repeat(40),
  TREE = 'b'.repeat(40),
  COMMIT = 'c'.repeat(40);
const body = readFileSync(new URL('fixtures/maybank.html', import.meta.url));
const fixture = JSON.parse(readFileSync(new URL('fixtures/feed.json', import.meta.url), 'utf8'));
const base = Buffer.from(
  JSON.stringify({
    ...fixture,
    offers: [...fixture.offers, ...validateMaybankCandidate(body, 200, '2026-11-01T00:00:00Z')],
  }),
);
function capture(): Awaited<ReturnType<typeof requestMaybank>> {
  const at = new Date().toISOString();
  return {
    body,
    report: {
      url: sourceFor('maybank').url,
      mode: 'default',
      arguments: ['--http1.1'],
      startedAt: at,
      finishedAt: at,
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
      offers: validateMaybankCandidate(body, 200, at),
      parseError: undefined,
      policy: 'test fixture',
    },
  };
}
function harness() {
  const api = vi.fn<Api>(async (method, path) => {
    if (method === 'GET' && path.startsWith('/pulls?')) return [];
    if (path === '/git/ref/heads/main') return { object: { sha: HEAD } };
    if (method === 'GET' && path.startsWith('/git/commits/')) return { tree: { sha: TREE } };
    if (path.startsWith('/contents/'))
      return { encoding: 'base64', content: base.toString('base64') };
    if (path === '/git/trees') return { sha: TREE };
    if (path === '/git/commits') return { sha: COMMIT };
    if (path === '/git/refs') return {};
    if (path === '/pulls') return { number: 25 };
    throw Error('Unexpected API call');
  });
  const read = vi.fn(async () => capture());
  return { api, read };
}
it('prepares from immutable main, saves original bytes, and performs no writes in dry run', async () => {
  const { api, read } = harness();
  const result = await prepareMaybankJob(api, read);
  expect(result.kind).toBe('prepared');
  if (result.kind !== 'prepared') throw Error('Expected candidate');
  expect(api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  expect(api).toHaveBeenCalledWith('GET', `/contents/public/data/rates.json?ref=${HEAD}`);
  expect(result.files).toHaveLength(3);
  expect(result.files[2].content).toBe(body.toString('utf8'));
  expect(JSON.parse(result.files[0].content).sources).toEqual(fixture.sources);
  expect(result.evidence.baseCommit).toBe(HEAD);
});
it('skips a pending same-repository data PR before contacting Maybank', async () => {
  const { api, read } = harness();
  api.mockResolvedValueOnce([
    { number: 42, head: { ref: 'data/maybank-old', repo: { full_name: REPO } } },
  ]);
  expect(await prepareMaybankJob(api, read)).toEqual({ kind: 'pending', number: 42 });
  expect(read).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledTimes(1);
});
it('does not let a similarly named fork PR suppress a fresh capture', async () => {
  const { api, read } = harness();
  api.mockResolvedValueOnce([
    { number: 42, head: { ref: 'data/maybank-old', repo: { full_name: 'someone/ratepro' } } },
  ]);
  expect((await prepareMaybankJob(api, read)).kind).toBe('prepared');
  expect(read).toHaveBeenCalledTimes(1);
});
it('fails without writes when collection fails or main changes during capture', async () => {
  const { api, read } = harness();
  const failed = capture();
  failed.report.exitCode = 28;
  failed.report.outcome = 'failed';
  failed.body = undefined;
  read.mockResolvedValueOnce(failed);
  await expect(prepareMaybankJob(api, read)).rejects.toThrow('No validated');
  expect(api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  read.mockImplementationOnce(async () => {
    api.mockResolvedValueOnce({ object: { sha: COMMIT } });
    return capture();
  });
  await expect(prepareMaybankJob(api, read)).rejects.toThrow('Main changed');
  expect(api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
});
it('creates only a data branch and draft PR, never updates main or merges', async () => {
  const { api, read } = harness();
  const plan = await prepareMaybankJob(api, read);
  if (plan.kind !== 'prepared') throw Error('Expected candidate');
  const beforeWrites = vi.fn(async () => {});
  expect(await submitMaybankJob(api, plan, beforeWrites)).toMatchObject({
    number: 25,
    commitSha: COMMIT,
  });
  expect(beforeWrites).toHaveBeenCalledTimes(1);
  expect(api.mock.calls.filter(([method]) => method === 'POST').map(([, path]) => path)).toEqual([
    '/git/trees',
    '/git/commits',
    '/git/refs',
    '/pulls',
  ]);
  expect(api).toHaveBeenCalledWith('POST', '/git/refs', {
    ref: `refs/heads/${plan.branch}`,
    sha: COMMIT,
  });
  expect(api).toHaveBeenCalledWith(
    'POST',
    '/pulls',
    expect.objectContaining({ head: plan.branch, base: 'main', draft: true }),
  );
});
it('blocks a stale or changed-base plan before beginning publication', async () => {
  const { api, read } = harness();
  const plan = await prepareMaybankJob(api, read);
  if (plan.kind !== 'prepared') throw Error('Expected candidate');
  const beforeWrites = vi.fn(async () => {});
  api.mockResolvedValueOnce({ object: { sha: COMMIT } });
  await expect(submitMaybankJob(api, plan, beforeWrites)).rejects.toThrow('Main changed');
  plan.observedAt = '2026-01-01T00:00:00Z';
  await expect(submitMaybankJob(api, plan, beforeWrites)).rejects.toThrow('stale');
  expect(beforeWrites).not.toHaveBeenCalled();
  expect(api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
});
it('does not retry a failed PR creation or attempt other writes afterward', async () => {
  const { api, read } = harness();
  const plan = await prepareMaybankJob(api, read);
  if (plan.kind !== 'prepared') throw Error('Expected candidate');
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (method, path, data) => {
    if (path === '/pulls') throw Error('ambiguous network failure');
    return original(method, path, data);
  });
  await expect(submitMaybankJob(api, plan)).rejects.toThrow('ambiguous');
  expect(api.mock.calls.filter(([, path]) => path === '/pulls')).toHaveLength(1);
});
it('keeps credentials on the fixed API origin, rejects redirects and sanitizes errors', async () => {
  const secret = 'TEST_TOKEN_DO_NOT_LOG';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('private failure text', { status: 403 }));
  await expect(githubApi(secret, fetcher)('POST', '/git/trees', {})).rejects.toThrow('HTTP 403');
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe(`https://api.github.com/repos/${REPO}/git/trees`);
  expect(init).toMatchObject({ redirect: 'error', headers: { Authorization: `Bearer ${secret}` } });
  await expect(githubApi(secret, fetcher)('GET', '/https://example.com')).rejects.toThrow(
    'Invalid API path',
  );
  await expect(githubApi(undefined, fetcher)('POST', '/pulls', {})).rejects.toThrow('token');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
