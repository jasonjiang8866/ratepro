import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BYTES } from '../src/lib/data';
import { sourceFor } from '../src/lib/schema';

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

export async function probeMaybank(out = 'research-output/maybank') {
  const url = sourceFor('maybank').url;
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
        '/dev/null',
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
  const report = {
    url,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: result.exitCode,
    timing,
    policy:
      'One ordinary curl HTTP/1.1 request matching the existing collector. No retry, redirect, custom UA, proxy or TLS changes.',
    note: 'Milestones locate the observed stall, not its cause. No rate extraction or snapshot write.',
  };
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`MAYBANK_TIMING_REPORT=${JSON.stringify(report)}`);
  if (result.exitCode !== 0 || timing?.http_code !== 200) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await probeMaybank();
