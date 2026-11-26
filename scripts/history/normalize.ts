import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateMaybankCandidate } from '../maybank-diagnostics';
import { FeedSchema, type Feed } from '../../src/lib/schema';
import { JpFeedSchema } from '../../src/lib/japan-rates';
import {
  HistoryRecordSchema,
  type HistoryRecord,
  type Market,
  type Provenance,
  type ProductVersion,
  type Observation,
} from '../../src/lib/history';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
export const bytesDigest = (text: string) => createHash('sha256').update(text).digest('hex');

// Extract only literal allowlisted source metadata, never execute historical repository code.
export function sourceUrls(schemaText: string): Record<string, string> {
  return Object.fromEntries(
    [...schemaText.matchAll(/id:\s*'([^']+)'[\s\S]*?url:\s*'([^']+)'/g)]
      .filter(([, id, url]) => /^[a-z0-9-]+$/.test(id) && url.startsWith('https://'))
      .map(([, id, url]) => [id, url]),
  );
}
// A standalone capture keeps the scheduled failure. Verify the four offers against
// the official response archived in the same Git revision as the snapshot.
type ReadBlob = (path: string) => Buffer;
function verifiedMaybankTime(feed: Feed, url: string, readBlob: ReadBlob) {
  const status = feed.sources.find((s) => s.sourceId === 'maybank');
  const offers = feed.offers.filter((o) => o.sourceId === 'maybank');
  const at = offers[0]?.observedAt;
  if (!at || status?.status !== 'error' || Date.parse(at) < Date.parse(status.attemptedAt)) return;
  const stamp = new Date(at).toISOString().replace(/[-:.]/g, '');
  const dir = `docs/captures/maybank/${stamp}`;
  try {
    const evidence = JSON.parse(readBlob(`${dir}/evidence.json`).toString('utf8'));
    if (
      evidence.version !== 1 ||
      evidence.sourceId !== 'maybank' ||
      evidence.url !== url ||
      evidence.observedAt !== at
    )
      return;
    const body = readBlob(`${dir}/official.html`);
    if (
      evidence.bytes !== body.length ||
      evidence.bodySha256 !== createHash('sha256').update(body).digest('hex')
    )
      return;
    const parsed = validateMaybankCandidate(body, 200, at);
    const byId = new Map(offers.map((offer) => [offer.id, offer]));
    if (
      byId.size === parsed.length &&
      parsed.every((offer) => isDeepStrictEqual(offer, byId.get(offer.id)))
    )
      return at;
  } catch {
    // Missing or unverifiable evidence leaves the ordinary failed-attempt rule in force.
  }
}
export function normalize(
  raw: unknown,
  market: Market,
  provenance: Provenance,
  urls: Record<string, string>,
  readBlob?: ReadBlob,
): HistoryRecord[] {
  const feed = market === 'SG' ? FeedSchema.parse(raw) : JpFeedSchema.parse(raw);
  const verifiedAt =
    market === 'SG' && provenance.mode !== 'collection' && provenance.commit && readBlob
      ? verifiedMaybankTime(feed as Feed, urls.maybank, readBlob)
      : undefined;
  const records: HistoryRecord[] = [];
  const url = (sourceId: string) => {
    if (!urls[sourceId]) throw Error(`Missing historical evidence URL: ${sourceId}`);
    return urls[sourceId];
  };
  for (const status of feed.sources) {
    const content = {
      market,
      sourceId: status.sourceId,
      attemptedAt: status.attemptedAt,
      status: status.status,
      details: status,
    };
    records.push({
      schemaVersion: 1,
      type: 'attempt',
      id: digest(content),
      ...content,
      evidenceUrl: url(status.sourceId),
      provenance,
    });
  }
  function add(
    version: Omit<ProductVersion, 'schemaVersion' | 'type' | 'id'>,
    observation: Omit<
      Observation,
      | 'schemaVersion'
      | 'type'
      | 'id'
      | 'market'
      | 'productId'
      | 'sourceId'
      | 'productVersionId'
      | 'status'
      | 'provenance'
    >,
  ) {
    if (Date.parse(observation.observedAt) > Date.parse(feed.generatedAt))
      throw Error('Observation newer than feed');
    const status = feed.sources.find((s) => s.sourceId === version.sourceId);
    // Retained older evidence is legitimate, but a failed run cannot mint a fresh collector observation.
    if (
      status?.status === 'error' &&
      (observation.method === 'collector' || market === 'JP') &&
      Date.parse(observation.observedAt) >= Date.parse(status.attemptedAt) &&
      !(version.sourceId === 'maybank' && observation.observedAt === verifiedAt)
    )
      return;
    const productVersionId = digest(version);
    records.push({ schemaVersion: 1, type: 'product-version', id: productVersionId, ...version });
    const content = {
      market,
      productId: version.productId,
      sourceId: version.sourceId,
      productVersionId,
      ...observation,
    };
    records.push({
      schemaVersion: 1,
      type: 'observation',
      id: digest(content),
      ...content,
      status: 'observed',
      provenance,
    });
  }
  let productIds: string[];
  if (market === 'SG') {
    const sg = feed as Feed;
    productIds = sg.offers.map((o) => o.id);
    for (const o of sg.offers) {
      const {
        observedAt,
        method,
        stages,
        evidenceSourceId,
        id,
        sourceId,
        bank,
        name,
        kind,
        ...terms
      } = o;
      const first = stages[0];
      const basis = first.benchmark ? 'sora-spread' : 'published-rate';
      add(
        {
          market,
          productId: id,
          sourceId,
          bank,
          name,
          rateType: kind,
          basis,
          comparisonKey: [
            market,
            basis,
            kind,
            first.benchmark?.tenor ?? '',
            first.label,
            o.purpose.slice().sort().join('/'),
            o.property,
            o.construction,
          ].join('|'),
          terms: { name, ...terms, stageLabels: stages.map((s) => s.label) },
        },
        {
          observedAt,
          method,
          evidenceUrl: url(evidenceSourceId ?? sourceId),
          effectiveFrom: o.effectiveFrom ?? null,
          effectiveUntil: o.effectiveUntil ?? null,
          publicationMonth: null,
          pricing: {
            annualRate: first.rate,
            spread: first.benchmark?.spread ?? null,
            benchmark: first.benchmark ? `${first.benchmark.tenor} SORA` : null,
            referenceRate: null,
            schedule: stages,
          },
        },
      );
    }
  } else {
    const jp = JpFeedSchema.parse(feed);
    productIds = jp.observations.flatMap((o) => o.rates.map((r) => r.id));
    for (const o of jp.observations)
      for (const r of o.rates) {
        const basis = o.sourceId === 'jp-mufg' ? 'applied-rate' : 'standard-rate';
        add(
          {
            market,
            productId: r.id,
            sourceId: o.sourceId,
            bank: o.sourceId === 'jp-mufg' ? 'MUFG Bank' : 'SMBC',
            name: `${r.label} · ${r.purpose}`,
            rateType: r.kind,
            basis,
            comparisonKey: [market, basis, r.kind, r.term, r.purpose].join('|'),
            terms: { name: r.label, purpose: r.purpose, term: r.term, conditions: o.conditions },
          },
          {
            observedAt: o.observedAt,
            method: 'unspecified',
            effectiveFrom: null,
            effectiveUntil: null,
            publicationMonth: o.publicationMonth,
            evidenceUrl: url(o.sourceId),
            pricing: {
              annualRate: r.annualRate,
              referenceRate: r.referenceRate,
              spread: null,
              benchmark: null,
              schedule: [r],
            },
          },
        );
      }
  }
  // Inventory records describe RatePro tracking, never assert bank withdrawal.
  const catalog = { market, generatedAt: feed.generatedAt, productIds: productIds.sort() };
  records.push({ schemaVersion: 1, type: 'catalog', id: digest(catalog), ...catalog, provenance });
  return records.map((r) => HistoryRecordSchema.parse(r));
}

export function recordId(record: HistoryRecord) {
  const { schemaVersion: _version, type, id: _id, ...body } = record;
  if (type === 'product-version') return digest(body);
  const { provenance: _provenance, ...content } = body as Exclude<HistoryRecord, ProductVersion>;
  if (type === 'observation') {
    const { status: _status, ...observation } = content as Observation;
    return digest(observation);
  }
  if (type === 'attempt') {
    const { evidenceUrl: _url, ...attempt } = content as import('../../src/lib/history').Attempt;
    return digest(attempt);
  }
  return digest(content);
}
