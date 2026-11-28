import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { matchesMaybankGroup } from './source-health';
import { sourceFor } from '../src/lib/schema';
import { MAX_BYTES } from '../src/lib/data';
import { validateMaybankCandidate, timingEvidence } from './maybank-diagnostics';

// OpenText/Interwoven LiveSite (.page) returns HTTP 500 on Undici's default `Accept-Language: *`.
// Sending a standard Singapore English locale header avoids the CMS error without spoofing a browser.
export const MAYBANK_ACCEPT_LANGUAGE = 'en-SG,en;q=0.9';

export function maybankFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has('accept-language')) headers.set('Accept-Language', MAYBANK_ACCEPT_LANGUAGE);
    return baseFetch(input, { ...init, headers });
  };
}

export function transportArguments(mode: string) {
  if (mode === 'default') return ['node-fetch', `Accept-Language: ${MAYBANK_ACCEPT_LANGUAGE}`];
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

async function readBoundedBody(res: Response): Promise<Buffer> {
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) {
    await res.body?.cancel().catch(() => {});
    throw Error('Response too large');
  }
  if (!res.body) throw Error('Empty response');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw Error('Response too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, size);
}

async function requestMaybankNodeFetch(baseFetch: typeof fetch = fetch) {
  const args = transportArguments('default');
  const url = sourceFor('maybank').url;
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  let exitCode: string | number = 0;
  let httpCode = 0;
  let tFirstByte = 0;
  let body: Buffer | undefined;
  let offers: ReturnType<typeof validateMaybankCandidate> | undefined;
  let sha256: string | undefined;
  let bytes: number | undefined;
  let parseError: string | undefined;
  let validatedBody: Buffer | undefined;

  try {
    const res = await maybankFetch(baseFetch)(url, {
      signal: AbortSignal.timeout(30_000),
      credentials: 'omit',
      cache: 'no-cache',
      redirect: 'error',
    });
    httpCode = res.status;
    tFirstByte = (performance.now() - t0) / 1000;
    if (httpCode === 200) {
      body = await readBoundedBody(res);
      bytes = body.length;
      sha256 = createHash('sha256').update(body).digest('hex');
    } else {
      await res.body?.cancel().catch(() => {});
      exitCode = 1;
    }
  } catch (error) {
    exitCode =
      error instanceof Error && /TimeoutError|AbortError/.test(error.name) ? 28 : 'fetch-error';
    if (error instanceof Error && /Response too large|Empty response/.test(error.message)) {
      parseError = error.message;
    }
  }

  const totalSec = Math.max(0, (performance.now() - t0) / 1000);
  const finishedAt = new Date().toISOString();
  const timing = timingEvidence({
    time_namelookup: 0,
    time_connect: 0,
    time_appconnect: 0,
    time_starttransfer: tFirstByte,
    time_total: totalSec,
    size_download: bytes ?? 0,
    http_code: httpCode,
  });

  if (exitCode === 0 && httpCode === 200 && body) {
    try {
      offers = validateMaybankCandidate(body, httpCode, finishedAt);
      validatedBody = body;
    } catch (error) {
      parseError = error instanceof Error ? error.message : 'Parse failed';
    }
  }

  const report = {
    url,
    mode: 'default',
    arguments: args,
    startedAt,
    finishedAt,
    platform: process.platform,
    architecture: process.arch,
    exitCode,
    timing,
    bytes,
    sha256,
    outcome:
      offers && matchesMaybankGroup(offers, 2) ? ('validated' as const) : ('failed' as const),
    offers,
    parseError,
    policy:
      'One ordinary Node fetch GET with Accept-Language: en-SG,en;q=0.9. No credentials, browser impersonation, proxy override, redirect following or certificate bypass. Full supported product group required.',
  };
  return { report, body: validatedBody };
}

export async function requestMaybank(mode: string, baseFetch: typeof fetch = fetch) {
  if (mode === 'default') return requestMaybankNodeFetch(baseFetch);
  const args = transportArguments(mode);
  const path = await mkdtemp(join(tmpdir(), 'ratepro-maybank-'));
  const url = sourceFor('maybank').url;
  const startedAt = new Date().toISOString();
  let report;
  let validatedBody: Buffer | undefined;
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
        validatedBody = body;
      } catch (error) {
        parseError = error instanceof Error ? error.message : 'Parse failed';
      }
    }
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
      outcome:
        offers && matchesMaybankGroup(offers, 2) ? ('validated' as const) : ('failed' as const),
      offers,
      parseError,
      policy:
        'One public GET; identified mode declares RatePro truthfully. No credentials, browser impersonation, proxy override, redirect following or certificate bypass. Full supported product group required.',
    };
  } finally {
    await rm(path, { recursive: true, force: true });
  }
  return { report, body: validatedBody };
}

export async function probeTransport(mode: string) {
  const before = await readFile('public/data/rates.json');
  const result = await requestMaybank(mode);
  const report = {
    ...result.report,
    snapshotUnchanged: before.equals(await readFile('public/data/rates.json')),
  };
  await mkdir('research-output/maybank-transport', { recursive: true });
  await writeFile(
    'research-output/maybank-transport/report.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(`MAYBANK_TRANSPORT_JSON=${JSON.stringify(report)}`);
  if (report.outcome !== 'validated' || !report.snapshotUnchanged) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await probeTransport(process.argv[2] ?? 'default');
