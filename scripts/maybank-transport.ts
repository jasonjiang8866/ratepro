import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sourceFor } from '../src/lib/schema';
import { MAX_BYTES } from '../src/lib/data';
import { validateMaybankCandidate, timingEvidence } from './maybank-diagnostics';

export function transportArguments(mode: string) {
  if (mode === 'default') return ['--http1.1'];
  // Modern TLS 1.2 compatibility test; certificate/hostname checks stay enabled.
  if (mode === 'tls12') return ['--http1.1', '--tlsv1.2', '--tls-max', '1.2'];
  if (mode === 'identified')
    return [
      '--http1.1',
      '--user-agent',
      'RatePro/1.0 (+https://github.com/jasonjiang8866/ratepro)',
      '--header',
      'Accept: text/html',
    ];
  throw Error('Unknown Maybank transport mode');
}
export async function probeTransport(mode: string) {
  const args = transportArguments(mode);
  const path = await mkdtemp(join(tmpdir(), 'ratepro-maybank-'));
  const before = await readFile('public/data/rates.json');
  const url = sourceFor('maybank').url;
  const startedAt = new Date().toISOString();
  let report;
  try {
    const response = await new Promise<{ code: string | number; output: string }>((done) => {
      execFile(
        'curl',
        [
          ...args,
          '--silent',
          '--show-error',
          '--max-time',
          '30',
          '--max-filesize',
          String(MAX_BYTES),
          '--proto',
          '=https',
          '--output',
          join(path, 'body'),
          '--write-out',
          '%{json}',
          url,
        ],
        { encoding: 'utf8', maxBuffer: 65536, timeout: 35000 },
        (error, stdout) => done({ code: error ? (error.code ?? 'terminated') : 0, output: stdout }),
      );
    });
    let timing;
    try {
      timing = timingEvidence(JSON.parse(response.output));
    } catch {
      /* Never expose raw curl metadata. */
    }
    const finishedAt = new Date().toISOString();
    let offers: ReturnType<typeof validateMaybankCandidate> | undefined;
    let sha256: string | undefined;
    let bytes: number | undefined;
    let parseError: string | undefined;
    if (response.code === 0 && timing?.http_code === 200) {
      try {
        const body = await readFile(join(path, 'body'));
        offers = validateMaybankCandidate(body, timing.http_code, finishedAt);
        bytes = body.length;
        sha256 = createHash('sha256').update(body).digest('hex');
      } catch (error) {
        parseError = error instanceof Error ? error.message : 'Parse failed';
      }
    }
    const snapshotUnchanged = before.equals(await readFile('public/data/rates.json'));
    report = {
      url,
      mode,
      arguments: args,
      startedAt,
      finishedAt,
      platform: process.platform,
      architecture: process.arch,
      exitCode: response.code,
      timing,
      bytes,
      sha256,
      outcome: offers?.length === 4 && snapshotUnchanged ? 'validated' : 'failed',
      offers,
      parseError,
      snapshotUnchanged,
      policy:
        'One public GET; identified mode declares RatePro truthfully. No credentials, browser impersonation, proxy override, redirect following or certificate bypass. Full four-product parsing required.',
    };
  } finally {
    await rm(path, { recursive: true, force: true });
  }
  await mkdir('research-output/maybank-transport', { recursive: true });
  await writeFile(
    'research-output/maybank-transport/report.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(`MAYBANK_TRANSPORT_JSON=${JSON.stringify(report)}`);
  if (report.outcome !== 'validated') process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await probeTransport(process.argv[2] ?? 'default');
