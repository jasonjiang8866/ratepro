import { execFile } from 'node:child_process';
import { mkdir, writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BYTES } from '../src/lib/data';
import { sourceFor } from '../src/lib/schema';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { nodePage } from './collect';
import { parseMaybank } from '../src/lib/parsers';

// Publicly indexed country-specific page; not an invented query or internal API.
export const MAYBANK_COUNTRY_URL =
  'https://www.maybank2u.com.sg/en/rates/rates-sora.page?country=en-sg';
export function validateMaybankCandidate(bytes: Uint8Array, status: number, at: string) {
  if (status !== 200) throw Error(`Candidate HTTP ${status}; no extraction`);
  if (!bytes.length || bytes.length > MAX_BYTES) throw Error('Candidate body size rejected');
  return parseMaybank(nodePage(new TextDecoder().decode(bytes)), at, 'collector');
}

export function timingEvidence(raw: Record<string, unknown>) {
  const keys = [
    'time_namelookup',
    'time_connect',
    'time_appconnect',
    'time_starttransfer',
    'time_total',
    'size_download',
    'http_code',
  ] as const;
  const values = Object.fromEntries(
    keys.map((key) => {
      const value = Number(raw[key]);
      if (!Number.isFinite(value) || value < 0) throw Error('Missing or invalid curl timing');
      return [key, value];
    }),
  ) as Record<(typeof keys)[number], number>;
  const lastMilestone =
    values.time_starttransfer > 0
      ? 'first response byte received'
      : values.time_appconnect > 0
        ? 'TLS completed; no first response byte recorded'
        : values.time_connect > 0
          ? 'connection completed; TLS completion not recorded'
          : values.time_namelookup > 0
            ? 'name lookup completed; connection completion not recorded'
            : 'no completed milestone recorded';
  return { ...values, lastMilestone };
}

export async function probeMaybank(out = 'research-output/maybank', countryCandidate = false) {
  const url = countryCandidate ? MAYBANK_COUNTRY_URL : sourceFor('maybank').url;
  const temporary = await mkdtemp(join(tmpdir(), 'ratepro-maybank-'));
  const bodyPath = join(temporary, 'response');
  const snapshotBefore = await readFile('public/data/rates.json');
  const startedAt = new Date().toISOString();
  const result = await new Promise<{ exitCode: number | string; stdout: string }>((done) => {
    execFile(
      'curl',
      [
        '--http1.1',
        '--silent',
        '--show-error',
        '--max-time',
        '30',
        '--max-filesize',
        String(MAX_BYTES),
        '--proto',
        '=https',
        '--output',
        bodyPath,
        '--write-out',
        '%{json}',
        url,
      ],
      { encoding: 'utf8', maxBuffer: 65536, timeout: 35000 },
      (error, stdout) => {
        done({ exitCode: error ? (error.code ?? 'terminated') : 0, stdout });
      },
    );
  });
  let timing;
  try {
    timing = timingEvidence(JSON.parse(result.stdout));
  } catch {
    /* No raw diagnostics, IPs or headers. */
  }
  let candidate;
  if (countryCandidate) {
    try {
      if (result.exitCode !== 0) throw Error('Transport did not complete; no extraction');
      const bytes = await readFile(bodyPath);
      const observedAt = new Date().toISOString();
      candidate = {
        status: 'validated-candidate',
        observedAt,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
        offers: validateMaybankCandidate(bytes, timing?.http_code ?? 0, observedAt),
        note: 'Research only, not an enabled collector or published observation',
      };
    } catch (error) {
      candidate = {
        status: 'rejected',
        reason: error instanceof Error ? error.message : 'Unknown failure',
      };
    }
  }
  await rm(temporary, { recursive: true, force: true });
  const snapshotUnchanged = snapshotBefore.equals(await readFile('public/data/rates.json'));
  const report = {
    url,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: result.exitCode,
    snapshotUnchanged,
    candidate,
    timing,
    policy:
      'One ordinary curl HTTP/1.1 request matching the existing collector. No retry, redirect, custom UA, proxy or TLS changes.',
    note: countryCandidate
      ? 'Read-only candidate validation; no production source switch or snapshot write.'
      : 'Milestones locate the observed stall, not its cause. No rate extraction or snapshot write.',
  };
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`MAYBANK_TIMING_REPORT=${JSON.stringify(report)}`);
  if (
    result.exitCode !== 0 ||
    timing?.http_code !== 200 ||
    !snapshotUnchanged ||
    (countryCandidate && candidate?.status !== 'validated-candidate')
  )
    process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await probeMaybank(
    process.argv.includes('--country-candidate') ? 'research-output/maybank-country' : undefined,
    process.argv.includes('--country-candidate'),
  );
