import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { validateMaybankCandidate } from '../scripts/maybank-diagnostics';
import { FeedSchema } from '../src/lib/schema';

const run = promisify(execFile);
const body = readFileSync(new URL('fixtures/maybank.html', import.meta.url));
const original = FeedSchema.parse(
  JSON.parse(readFileSync(new URL('fixtures/feed.json', import.meta.url), 'utf8')),
);
const baseline = JSON.stringify({
  ...original,
  offers: [...original.offers, ...validateMaybankCandidate(body, 200, '2026-11-01T00:00:00Z', 1)],
});
const script = fileURLToPath(new URL('../scripts/capture-maybank.ts', import.meta.url));

it.each(['success', 'timeout', 'race'])(
  'real --apply CLI handles %s without damaging unrelated data',
  async (mode) => {
    const dir = await mkdtemp(join(tmpdir(), 'maybank-cli-'));
    try {
      await mkdir(join(dir, 'public/data'), { recursive: true });
      const snapshot = join(dir, 'public/data/rates.json');
      await writeFile(snapshot, baseline);
      // Controlled transport double: this test never requests a bank URL.
      const stub = `import fs from 'node:fs';
globalThis.fetch = async (input, init) => {
  if (String(input) !== 'https://www.maybank2u.com.sg/en/rates/rates-sora.page')
    throw Error('Unexpected URL');
  const headers = new Headers(init?.headers);
  if (headers.get('accept-language') !== 'en-SG,en;q=0.9')
    throw Error('Missing Accept-Language');
  if (init?.redirect !== 'error' || init?.credentials !== 'omit')
    throw Error('Unexpected fetch policy');
  if ('${mode}' === 'timeout') throw new DOMException('timed out', 'TimeoutError');
  if ('${mode}' === 'race') fs.appendFileSync('public/data/rates.json', '\\n');
  return new Response(Buffer.from('${body.toString('base64')}', 'base64'), { status: 200 });
};
`;
      const preload = join(dir, 'fetch-stub.mjs');
      await writeFile(preload, stub);
      const invocation = run(
        process.execPath,
        [
          '--import',
          preload,
          '--import',
          createRequire(import.meta.url).resolve('tsx'),
          script,
          '--apply',
        ],
        {
          cwd: dir,
          env: process.env,
          timeout: 15000,
        },
      );
      if (mode === 'success') {
        await invocation;
        const next = JSON.parse(await readFile(snapshot, 'utf8'));
        expect(next.sources).toEqual(original.sources);
        expect(next.offers.filter((o: { sourceId: string }) => o.sourceId !== 'maybank')).toEqual(
          original.offers,
        );
        expect(
          next.offers.filter((o: { sourceId: string }) => o.sourceId === 'maybank'),
        ).toHaveLength(6);
        const bundles = await readdir(join(dir, 'research-output'));
        expect(bundles).toHaveLength(1);
        expect(await readFile(join(dir, 'research-output', bundles[0], 'rates.json'), 'utf8')).toBe(
          await readFile(snapshot, 'utf8'),
        );
      } else {
        await expect(invocation).rejects.toThrow();
        expect(await readFile(snapshot, 'utf8')).toBe(baseline + (mode === 'race' ? '\n' : ''));
        await expect(readdir(join(dir, 'research-output'))).rejects.toThrow();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  20000,
);
