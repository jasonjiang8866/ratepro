import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { prepareReview, stageReview, reviewMarkdown } from '../scripts/review-file';
import { sha256 } from '../scripts/cpf-browser';
import { FeedSchema, evidenceFor, CPF_BOARD } from '../src/lib/schema';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const base = readFileSync(new URL('fixtures/feed.json', import.meta.url), 'utf8');
const document = readFileSync(new URL('fixtures/cpf-askgov.html', import.meta.url));
const observedAt = '2026-11-01T04:00:00.000Z';
const now = '2026-11-01T05:00:00.000Z';
const input = { source: 'cpf-askgov', format: 'html', base, document, observedAt, now } as const;
async function ready() {
  const candidate = await prepareReview(input);
  const candidateText = JSON.stringify(candidate);
  return {
    candidateText,
    approvedSha256: sha256(candidateText),
    document,
    base,
    reviewer: 'Test reviewer',
    now: '2026-11-01T06:00:00.000Z',
  };
}

it('prepares an exact review diff and stages only the selected source, preserving collector failures and actual observation time', async () => {
  const prepared = await prepareReview(input);
  const old = FeedSchema.parse(JSON.parse(base));
  expect(prepared.offers[0]).toMatchObject({
    method: 'reviewed',
    observedAt,
    evidenceSourceId: 'cpf-askgov',
  });
  expect(reviewMarkdown(prepared, old, sha256(JSON.stringify(prepared)))).toContain('Before:');
  const { feed, review } = await stageReview(await ready());
  expect(feed.offers.filter((o) => o.sourceId !== 'hdb')).toEqual(
    old.offers.filter((o) => o.sourceId !== 'hdb'),
  );
  expect(feed.sources).toEqual(old.sources);
  expect(feed.offers[0].observedAt).toBe(observedAt);
  expect(feed.generatedAt).toBe(review.reviewedAt);
  expect(review.reviewedAt).not.toBe(observedAt);
});

it('rejects changed evidence, changed base, an unapproved candidate, and candidate edits even if rehashed', async () => {
  const valid = await ready();
  await expect(stageReview({ ...valid, document: Buffer.from('different') })).rejects.toThrow(
    'Evidence file changed',
  );
  await expect(stageReview({ ...valid, base: base + '\n' })).rejects.toThrow(
    'Base snapshot changed',
  );
  await expect(stageReview({ ...valid, approvedSha256: '0'.repeat(64) })).rejects.toThrow(
    'approval hash',
  );
  const altered = JSON.parse(valid.candidateText);
  altered.offers[0].stages[0].rate = 3.99;
  const candidateText = JSON.stringify(altered);
  await expect(
    stageReview({ ...valid, candidateText, approvedSha256: sha256(candidateText) }),
  ).rejects.toThrow('strict evidence');
  altered.offers = JSON.parse(valid.candidateText).offers;
  altered.sourceUrl = 'https://example.com';
  const other = JSON.stringify(altered);
  await expect(
    stageReview({ ...valid, candidateText: other, approvedSha256: sha256(other) }),
  ).rejects.toThrow('strict evidence');
});

it('rejects future, stale, non-newer and quarter-expired observations at prepare and review time', async () => {
  await expect(prepareReview({ ...input, observedAt: '2026-11-02T00:00:00Z' })).rejects.toThrow(
    'future',
  );
  await expect(prepareReview({ ...input, observedAt: '2026-10-20T00:00:00Z' })).rejects.toThrow(
    'seven days',
  );
  await expect(prepareReview({ ...input, observedAt: '2026-10-30T01:50:00.000Z' })).rejects.toThrow(
    'newer',
  );
  await expect(stageReview({ ...(await ready()), now: '2026-11-09T00:00:00Z' })).rejects.toThrow(
    'seven days',
  );
  const late = await prepareReview({
    ...input,
    observedAt: '2026-12-31T14:00:00Z',
    now: '2026-12-31T15:00:00Z',
  });
  const candidateText = JSON.stringify(late);
  await expect(
    stageReview({
      ...(await ready()),
      candidateText,
      approvedSha256: sha256(candidateText),
      now: '2026-12-31T16:00:00Z',
    }),
  ).rejects.toThrow('expired');
});

it('rejects incomplete HTML, unsupported PDFs and accidental source/product changes', async () => {
  await expect(
    prepareReview({ ...input, document: Buffer.from('<body>Service unavailable</body>') }),
  ).rejects.toThrow();
  await expect(prepareReview({ ...input, format: 'pdf' })).rejects.toThrow('Unsupported');
  await expect(prepareReview({ ...input, source: 'citi', format: 'html' })).rejects.toThrow(
    'original official PDF',
  );
  await expect(prepareReview({ ...input, source: 'citi', format: 'pdf' })).rejects.toThrow(
    'Expected a PDF',
  );
  const changed = JSON.parse(base);
  changed.offers[0].id = 'hdb-old-id';
  await expect(prepareReview({ ...input, base: JSON.stringify(changed) })).rejects.toThrow(
    'Product IDs changed',
  );
});

it('keeps independent CPF Board provenance without relabelling it as AskGov', async () => {
  const cpfDocument = Buffer.from(
    document
      .toString()
      .replace('Updated by CPF', 'A Singapore Government Agency Website CPF Board'),
  );
  const candidate = await prepareReview({ ...input, source: 'cpf-board', document: cpfDocument });
  expect(candidate.offers[0].evidenceSourceId).toBe('cpf-board');
  expect(evidenceFor(candidate.offers[0])).toEqual(CPF_BOARD);
  expect(candidate.sourceUrl).toBe(CPF_BOARD.url);
});

it('extracts all four Maybank products atomically as reviewed, without inventing a SORA fixing', async () => {
  const document = readFileSync(new URL('fixtures/maybank.html', import.meta.url));
  const candidate = await prepareReview({ ...input, source: 'maybank', document });
  expect(candidate.offers).toHaveLength(4);
  expect(
    candidate.offers.every((o) => o.method === 'reviewed' && o.observedAt === observedAt),
  ).toBe(true);
  for (const offer of candidate.offers.filter((o) => o.kind === 'Floating')) {
    expect(offer.stages.every((stage) => stage.rate === null)).toBe(true);
  }
});

it('runs the real CLI prepare/stage path in isolation and refuses production output paths', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ratepro-review-'));
  const run = (args: string[]) =>
    promisify(execFile)(
      process.execPath,
      [
        '--import',
        createRequire(import.meta.url).resolve('tsx'),
        fileURLToPath(new URL('../scripts/review-file.ts', import.meta.url)),
        ...args,
      ],
      { cwd },
    );
  try {
    await mkdir(join(cwd, 'public/data'), { recursive: true });
    const empty = JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      offers: [],
      sources: [],
    });
    await writeFile(join(cwd, 'public/data/rates.json'), empty);
    await writeFile(
      join(cwd, 'official.html'),
      readFileSync(new URL('fixtures/maybank.html', import.meta.url)),
    );
    const options = [
      '--source',
      'maybank',
      '--format',
      'html',
      '--file',
      'official.html',
      '--observed-at',
      new Date(Date.now() - 60000).toISOString(),
    ];
    await expect(run(['prepare', ...options, '--out', 'public/data'])).rejects.toThrow(
      'inside review-output',
    );
    await run(['prepare', ...options, '--out', 'review-output/candidate']);
    const candidateText = await readFile(
      join(cwd, 'review-output/candidate/candidate.json'),
      'utf8',
    );
    await run([
      'stage',
      '--file',
      'official.html',
      '--candidate',
      'review-output/candidate/candidate.json',
      '--approve-sha',
      sha256(candidateText),
      '--reviewer',
      'Synthetic test',
      '--out',
      'review-output/staged',
    ]);
    expect(await readFile(join(cwd, 'public/data/rates.json'), 'utf8')).toBe(empty);
    const staged = JSON.parse(await readFile(join(cwd, 'review-output/staged/rates.json'), 'utf8'));
    expect(staged.offers).toHaveLength(4);
    expect(staged.sources).toEqual([]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
