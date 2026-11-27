import { readFile, writeFile, mkdir, mkdtemp, rm, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { FeedSchema, sourceFor } from '../src/lib/schema';
import { validateMaybankCandidate } from './maybank-diagnostics';
import { requestMaybank } from './maybank-transport';
import { matchesMaybankGroup, validateCollectedGroup } from './source-health';

export const digest = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
type Capture = Awaited<ReturnType<typeof requestMaybank>>;

// Only an actual bounded live read can create this candidate. No saved-file date override.
export function buildMaybankCandidate(base: Buffer, capture: Capture, now = Date.now()) {
  const { report, body } = capture;
  if (
    report.outcome !== 'validated' ||
    report.exitCode !== 0 ||
    report.timing?.http_code !== 200 ||
    report.url !== sourceFor('maybank').url ||
    report.mode !== 'default' ||
    !body ||
    digest(body) !== report.sha256 ||
    body.length !== report.bytes
  )
    throw Error('No validated ordinary Maybank live capture');
  const observed = Date.parse(report.finishedAt);
  const started = Date.parse(report.startedAt);
  if (
    !Number.isFinite(observed) ||
    !Number.isFinite(started) ||
    started > observed ||
    observed > now ||
    now - started > 10 * 60_000
  )
    throw Error('Capture is stale or has invalid timing');
  const previous = FeedSchema.parse(JSON.parse(base.toString('utf8')));
  const parsed = validateMaybankCandidate(body, 200, report.finishedAt);
  validateCollectedGroup('maybank', parsed, previous);
  const old = previous.offers.filter((offer) => offer.sourceId === 'maybank');
  if (!matchesMaybankGroup(old, 1) && !matchesMaybankGroup(old, 2))
    throw Error('Supported Maybank product IDs changed');
  if (old.some((offer) => Date.parse(offer.observedAt) >= observed))
    throw Error('Capture is not newer than retained observations');
  // Preserve scheduled collector health. A local read does not repair GitHub access.
  const offers = new Map(previous.offers.map((offer) => [offer.id, offer]));
  for (const offer of parsed) offers.set(offer.id, offer);
  const feed = FeedSchema.parse({
    ...previous,
    generatedAt: new Date(Math.max(now, Date.parse(previous.generatedAt))).toISOString(),
    offers: [...offers.values()],
  });
  const candidate = JSON.stringify(feed, null, 2) + '\n';
  return {
    candidate,
    evidence: {
      version: 2,
      sourceId: 'maybank',
      url: report.url,
      observedAt: report.finishedAt,
      baseSha256: digest(base),
      bodySha256: digest(body),
      candidateSha256: digest(candidate),
      bytes: body.length,
      platform: report.platform,
      architecture: report.architecture,
      transport: 'Ordinary curl HTTP/1.1; one public GET; no custom identity or proxy override',
      scheduledHealthPreserved: true,
      changes: parsed.map((after) => ({
        before: old.find((before) => before.id === after.id) ?? null,
        after,
      })),
    },
  };
}

export async function captureMaybank(apply = false) {
  const snapshotPath = 'public/data/rates.json';
  const base = await readFile(snapshotPath);
  const capture = await requestMaybank('default');
  if (capture.report.outcome !== 'validated') {
    console.error(`MAYBANK_CAPTURE_FAILED=${JSON.stringify(capture.report)}`);
    throw Error('Maybank live capture failed; no candidate created');
  }
  const { candidate, evidence } = buildMaybankCandidate(base, capture);
  if (!base.equals(await readFile(snapshotPath))) throw Error('Snapshot changed during capture');
  const root = 'research-output';
  await mkdir(root, { recursive: true });
  const out = await mkdtemp(join(root, 'maybank-capture-'));
  try {
    await writeFile(join(out, 'official.html'), capture.body!);
    await writeFile(join(out, 'rates.json'), candidate);
    await writeFile(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    await writeFile(join(out, 'transport.json'), JSON.stringify(capture.report, null, 2) + '\n');
    if (!base.equals(await readFile(snapshotPath))) throw Error('Snapshot changed during capture');
    if (apply) {
      const staging = await mkdtemp('public/data/.maybank-');
      try {
        await writeFile(join(staging, 'rates.json'), candidate);
        if (!base.equals(await readFile(snapshotPath)))
          throw Error('Snapshot changed during capture');
        await rename(join(staging, 'rates.json'), snapshotPath);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    }
  } catch (error) {
    await rm(out, { recursive: true, force: true });
    throw error;
  }
  console.log(`MAYBANK_CAPTURE=${JSON.stringify({ out, ...evidence, changes: undefined })}`);
  console.log(
    apply
      ? `${evidence.changes.length} complete products applied locally. Scheduled health unchanged; no commit, push or deploy.`
      : `${evidence.changes.length} complete products staged. Published snapshot and scheduled health unchanged.`,
  );
  return out;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--apply'))
    throw Error('Only --apply is supported; no URL, file or time overrides');
  await captureMaybank(args[0] === '--apply');
}
