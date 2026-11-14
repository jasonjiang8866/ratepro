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
  offers: [...original.offers, ...validateMaybankCandidate(body, 200, '2026-11-01T00:00:00Z')],
});
const script = fileURLToPath(new URL('../scripts/capture-maybank.ts', import.meta.url));

it.each(['success', 'timeout', 'race'])(
  'real --apply CLI handles %s without damaging unrelated data',
  async (mode) => {
    const dir = await mkdtemp(join(tmpdir(), 'maybank-cli-'));
    try {
      await mkdir(join(dir, 'public/data'), { recursive: true });
      await mkdir(join(dir, 'bin'));
      const snapshot = join(dir, 'public/data/rates.json');
      await writeFile(snapshot, baseline);
      // Controlled transport double: this test never requests a bank URL.
      const stub = `#!${process.execPath}\nconst fs = require('node:fs');
const args = process.argv.slice(2);
if (args.at(-1) !== 'https://www.maybank2u.com.sg/en/rates/rates-sora.page') process.exit(99);
fs.writeFileSync(args[args.indexOf('--output') + 1], Buffer.from('${body.toString('base64')}', 'base64'));
if ('${mode}' === 'race') fs.appendFileSync('public/data/rates.json', '\\n');
process.stdout.write(JSON.stringify({time_namelookup:0.01,time_connect:0.02,time_appconnect:0.03,time_starttransfer:0.04,time_total:0.05,size_download:${body.length},http_code:200}));
if ('${mode}' === 'timeout') process.exitCode = 28;
`;
      await writeFile(join(dir, 'bin/curl'), stub, { mode: 0o755 });
      const invocation = run(
        process.execPath,
        ['--import', createRequire(import.meta.url).resolve('tsx'), script, '--apply'],
        {
          cwd: dir,
          env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
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
        ).toHaveLength(4);
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
