import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Article } from '../../src/lib/editorial';
/** Test-only fixture. Never written into the repository's published content directory. */
export function syntheticCorpus(seed: Article[], count = 1000): Article[] {
  const records = [...seed];
  for (let i = seed.length; i < count; i++) {
    const category = (['guide', 'market', 'package'] as const)[i % 3];
    const source = {
      ...seed[0].sources[0],
      id: 'fixture',
      checkedAt: '2026-01-01T00:00:00Z',
      documentDate: null,
    };
    const text = Array.from({ length: 30 }, (_, j) =>
      createHash('sha256').update(`${i}-${j}`).digest('hex'),
    ).join(' ');
    records.push({
      ...seed[0],
      market: i % 2 ? 'SG' : 'JP',
      slug: `stress-report-${i}`,
      eventKey: `stress-event-${i}`,
      title: `Historical fixture ${i}`,
      summary: `Test-only summary ${i}`,
      category,
      edition: 'guide',
      reportDate: '2026-01-01',
      supersedes: null,
      effectiveFrom: null,
      effectiveUntil: null,
      sources: [source],
      takeaways: [{ text: 'A bounded takeaway.', sourceIds: ['fixture'] }],
      sections: Array.from({ length: 6 }, (_, j) => ({
        heading: `Evidence ${j}`,
        kind: 'analysis' as const,
        text: `UNOPENED_BODY_SENTINEL_${i} ${j} ${text}`,
        sourceIds: ['fixture'],
      })),
      package:
        category === 'package'
          ? {
              lender: 'Fixture lender',
              eligibility: 'Fixture eligibility',
              conditions: `DETAILED_TERMS_${i}`,
              expiry: null,
              sourceIds: ['fixture'],
            }
          : null,
    });
  }
  return records;
}
export function writeCorpus(root: string, records: Article[]) {
  for (const folder of ['insights', 'promotions'])
    mkdirSync(join(root, folder), { recursive: true });
  for (const article of records)
    writeFileSync(
      join(
        root,
        article.category === 'package' ? 'promotions' : 'insights',
        `${article.slug}.json`,
      ),
      JSON.stringify(article),
    );
}
