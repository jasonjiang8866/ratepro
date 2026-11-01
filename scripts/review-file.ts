import { readFile, mkdir, writeFile, stat, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  FeedSchema,
  OfferSchema,
  sourceIds,
  sourceFor,
  HDB_FALLBACK,
  CPF_BOARD,
  singaporeDay,
  type Feed,
} from '../src/lib/schema';
import { MAX_BYTES } from '../src/lib/data';
import { parsers } from '../src/lib/parsers';
import { nodePage } from './collect';
import { parseCiti, pdfText } from './citi';
import { parseHdbAskGov } from './hdb-askgov';
import { CPF_URL, parseCpfBoard, sha256 } from './cpf-browser';

const ReviewSource = z.enum([...sourceIds, 'cpf-askgov', 'cpf-board']);
type ReviewSource = z.infer<typeof ReviewSource>;
const date = z.string().datetime({ offset: true });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const RenderedPage = z
  .object({
    text: z.string().max(MAX_BYTES),
    tables: z.array(z.array(z.array(z.string().max(20000)).max(30)).max(1000)).max(100),
  })
  .strict();
const Candidate = z
  .object({
    version: z.literal(1),
    source: ReviewSource,
    sourceUrl: z.string().url(),
    format: z.enum(['html', 'pdf', 'rendered-json']),
    documentSha256: hash,
    baseSha256: hash,
    observedAt: date,
    preparedAt: date,
    offers: z.array(OfferSchema).min(1).max(200),
  })
  .strict();
export type ReviewCandidate = z.infer<typeof Candidate>;

function sourceInfo(source: ReviewSource) {
  if (source === 'cpf-askgov') return { url: HDB_FALLBACK.url, sourceId: 'hdb' as const };
  if (source === 'cpf-board') return { url: CPF_BOARD.url, sourceId: 'hdb' as const };
  return { url: sourceFor(source).url, sourceId: source };
}
function validObservation(at: string, now: string) {
  date.parse(at);
  date.parse(now);
  if (Date.parse(at) > Date.parse(now)) throw Error('Observation cannot be in the future');
  // Review is a publication route for fresh evidence, not an archive importer.
  if (Date.parse(now) - Date.parse(at) > 7 * 86400000)
    throw Error('Evidence is older than seven days; obtain a new observation');
}
export async function prepareReview(input: {
  source: ReviewSource;
  format: ReviewCandidate['format'];
  document: Uint8Array;
  observedAt: string;
  base: string;
  now: string;
}): Promise<ReviewCandidate> {
  const source = ReviewSource.parse(input.source);
  validObservation(input.observedAt, input.now);
  if (!input.document.length || input.document.length > MAX_BYTES)
    throw Error('Document must be 1 byte to 2 MB');
  const previous = FeedSchema.parse(JSON.parse(input.base));
  const info = sourceInfo(source);
  let offers;
  if (source === 'citi') {
    if (input.format !== 'pdf') throw Error('Citi requires the original official PDF');
    offers = parseCiti(await pdfText(input.document), input.observedAt, 'reviewed');
  } else {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(input.document);
    if (input.format !== 'html' && !(source === 'cpf-board' && input.format === 'rendered-json'))
      throw Error('Unsupported source/document format');
    const page =
      input.format === 'rendered-json' ? RenderedPage.parse(JSON.parse(text)) : nodePage(text);
    if (source === 'cpf-board')
      offers = [
        { ...parseCpfBoard(page, CPF_URL, input.observedAt), evidenceSourceId: CPF_BOARD.id },
      ];
    else if (source === 'cpf-askgov') offers = parseHdbAskGov(page, input.observedAt);
    else offers = parsers[source](page, input.observedAt, 'reviewed');
  }
  offers = offers.map((offer) => OfferSchema.parse({ ...offer, method: 'reviewed' }));
  const old = previous.offers.filter((offer) => offer.sourceId === info.sourceId);
  if (offers.some((offer) => offer.sourceId !== info.sourceId)) throw Error('Wrong source group');
  if (
    old.length &&
    JSON.stringify(old.map((o) => o.id).sort()) !== JSON.stringify(offers.map((o) => o.id).sort())
  )
    throw Error('Product IDs changed; requires a separate parser/schema review');
  for (const offer of offers) {
    const retained = old.find((o) => o.id === offer.id);
    if (retained && Date.parse(offer.observedAt) <= Date.parse(retained.observedAt))
      throw Error('Observation must be newer than the retained source');
    if (offer.effectiveUntil && singaporeDay(Date.parse(input.now)) > offer.effectiveUntil)
      throw Error('Published period has expired before review');
  }
  return Candidate.parse({
    version: 1,
    source,
    sourceUrl: info.url,
    format: input.format,
    documentSha256: sha256(input.document),
    baseSha256: sha256(input.base),
    observedAt: input.observedAt,
    preparedAt: input.now,
    offers,
  });
}

// A review binds the exact candidate, source file and current base. It is an audit
// attestation, not a cryptographic authentication of a publisher or reviewer.
export async function stageReview(input: {
  candidateText: string;
  approvedSha256: string;
  document: Uint8Array;
  base: string;
  reviewer: string;
  now: string;
}) {
  if (sha256(input.candidateText) !== hash.parse(input.approvedSha256))
    throw Error('Candidate approval hash mismatch');
  const candidate = Candidate.parse(JSON.parse(input.candidateText));
  const reviewer = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[^\r\n]+$/)
    .parse(input.reviewer);
  if (Date.parse(candidate.preparedAt) > Date.parse(input.now))
    throw Error('Preparation time is in the future');
  if (candidate.baseSha256 !== sha256(input.base))
    throw Error('Base snapshot changed; prepare and review again');
  if (candidate.documentSha256 !== sha256(input.document)) throw Error('Evidence file changed');
  const reparsed = await prepareReview({
    source: candidate.source,
    format: candidate.format,
    document: input.document,
    observedAt: candidate.observedAt,
    base: input.base,
    now: input.now,
  });
  if (
    candidate.sourceUrl !== reparsed.sourceUrl ||
    JSON.stringify(candidate.offers) !== JSON.stringify(reparsed.offers)
  )
    throw Error('Candidate differs from strict evidence extraction');
  const previous = FeedSchema.parse(JSON.parse(input.base));
  const replacements = new Map(candidate.offers.map((offer) => [offer.id, offer]));
  const offers = previous.offers.map((offer) => {
    const next = replacements.get(offer.id);
    replacements.delete(offer.id);
    return next ?? offer;
  });
  offers.push(...replacements.values());
  const feed = FeedSchema.parse({ ...previous, generatedAt: input.now, offers });
  return {
    feed,
    review: {
      version: 1,
      reviewer,
      reviewedAt: input.now,
      candidateSha256: input.approvedSha256,
      documentSha256: candidate.documentSha256,
      baseSha256: candidate.baseSha256,
      sourceUrl: candidate.sourceUrl,
      observedAt: candidate.observedAt,
      note: 'Human attestation; not publisher authentication. Collector statuses remain unchanged.',
    },
  };
}

export function reviewMarkdown(candidate: ReviewCandidate, base: Feed, candidateHash: string) {
  return (
    `# Official-file review candidate\n\nPending human review; no production update.\n\n` +
    `Source: ${candidate.sourceUrl}\n\nObserved: ${candidate.observedAt}\n\nPrepared: ${candidate.preparedAt}\n\n` +
    `Evidence SHA-256: ${candidate.documentSha256}\n\nBase SHA-256: ${candidate.baseSha256}\n\nCandidate SHA-256: ${candidateHash}\n\n` +
    'Confirm the original official file, capture time, every rate, stage, eligibility, amount and effective period. A page update/print date is not an observation time. Local files do not prove publisher identity.\n\n' +
    candidate.offers
      .map(
        (offer) =>
          `## ${offer.id}\n\nBefore:\n\n\`\`\`json\n${JSON.stringify(base.offers.find((o) => o.id === offer.id) ?? null, null, 2)}\n\`\`\`\n\nAfter:\n\n\`\`\`json\n${JSON.stringify(offer, null, 2)}\n\`\`\`\n`,
      )
      .join('\n')
  );
}

async function boundedRead(path: string) {
  const size = (await stat(path)).size;
  if (size > MAX_BYTES) throw Error('Input exceeds 2 MB');
  const bytes = await readFile(path);
  if (bytes.length > MAX_BYTES) throw Error('Input exceeds 2 MB');
  return bytes;
}
async function outputDirectory(out: string) {
  // All output stays in an ignored staging directory, including through symlinks.
  const root = await realpath('.');
  await mkdir('review-output', { recursive: true });
  const allowed = await realpath('review-output');
  if (allowed !== resolve(root, 'review-output')) throw Error('Staging root cannot be a symlink');
  const target = resolve(out);
  const rel = relative(allowed, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw Error('Output must be inside review-output');
  await mkdir(target, { recursive: true });
  if ((await realpath(target)) !== target) throw Error('Output cannot use symlinks');
  return target;
}
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      source: { type: 'string' },
      format: { type: 'string' },
      file: { type: 'string' },
      'observed-at': { type: 'string' },
      out: { type: 'string' },
      candidate: { type: 'string' },
      'approve-sha': { type: 'string' },
      reviewer: { type: 'string' },
    },
  });
  const command = positionals[0];
  if (
    positionals.length !== 1 ||
    !['prepare', 'stage'].includes(command) ||
    !values.file ||
    !values.out
  )
    throw Error('Use prepare or stage with --file and --out; see docs/REVIEW.md');
  const document = await boundedRead(values.file);
  const base = (await boundedRead('public/data/rates.json')).toString('utf8');
  const now = new Date().toISOString();
  if (command === 'prepare') {
    const candidate = await prepareReview({
      source: ReviewSource.parse(values.source),
      format: Candidate.shape.format.parse(values.format),
      document,
      observedAt: date.parse(values['observed-at']),
      base,
      now,
    });
    const content = JSON.stringify(candidate, null, 2) + '\n';
    const out = await outputDirectory(values.out);
    await writeFile(resolve(out, 'candidate.json'), content, { flag: 'wx' });
    await writeFile(
      resolve(out, 'review.md'),
      reviewMarkdown(candidate, FeedSchema.parse(JSON.parse(base)), sha256(content)),
      { flag: 'wx' },
    );
    console.log(
      `Prepared candidate ${sha256(content)}; review ${out}/review.md. Production unchanged.`,
    );
  } else {
    if (!values.candidate || !values['approve-sha'] || !values.reviewer)
      throw Error('Stage requires --candidate, --approve-sha and --reviewer');
    const candidateText = (await boundedRead(values.candidate)).toString('utf8');
    const result = await stageReview({
      candidateText,
      approvedSha256: values['approve-sha'],
      document,
      base,
      reviewer: values.reviewer,
      now,
    });
    const out = await outputDirectory(values.out);
    await writeFile(resolve(out, 'rates.json'), JSON.stringify(result.feed, null, 2) + '\n', {
      flag: 'wx',
    });
    await writeFile(resolve(out, 'review.json'), JSON.stringify(result.review, null, 2) + '\n', {
      flag: 'wx',
    });
    console.log(
      `Staged ${out}/rates.json and review.json for a separate data PR. Production unchanged.`,
    );
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Review failed');
    process.exitCode = 1;
  });
