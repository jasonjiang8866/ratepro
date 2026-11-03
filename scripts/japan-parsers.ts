import { load } from 'cheerio';
import { JpObservationSchema, type JpObservation } from '../src/lib/japan-rates';
const clean = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
const compact = (s: string) => clean(s).replace(/\s/g, '');
function fail(message: string): never {
  throw new Error(`Japan source format: ${message}`);
}
export function parseJapan(
  sourceId: 'jp-mufg' | 'jp-smbc',
  bytes: Uint8Array,
  observedAt: string,
): JpObservation {
  const $ = load(
    new TextDecoder(sourceId === 'jp-smbc' ? 'shift_jis' : 'utf-8', { fatal: true }).decode(bytes),
  );
  $('script,style,noscript').remove();
  const text = clean($('body').text());
  let purpose: 'Purchase' | 'Refinance' | undefined;
  const rates: JpObservation['rates'] = [];
  const months = new Set<string>();
  const counts = { Purchase: 0, Refinance: 0 };
  const month = (year: string, mon: string) => `${year}-${mon.padStart(2, '0')}`;
  if (sourceId === 'jp-smbc') {
    const date = text.match(/\((20\d{2})年\s*(\d{1,2})月\s*\d{1,2}日現在\)/);
    if (!date) fail('missing SMBC publication date');
    months.add(month(date[1], date[2]));
  }
  $('h2,table,img').each((_, element) => {
    const node = $(element);
    if (element.tagName === 'h2') {
      const heading = compact(node.text());
      purpose =
        sourceId === 'jp-mufg'
          ? heading === '新規お借り入れの金利'
            ? 'Purchase'
            : heading === 'お借り換えの金利'
              ? 'Refinance'
              : undefined
          : heading === 'WEB申込専用住宅ローン、WEB申込専用住み替えローン'
            ? 'Purchase'
            : heading === 'WEB申込専用借り換えローン'
              ? 'Refinance'
              : undefined;
      return;
    }
    if (!purpose) return;
    if (element.tagName === 'img' && sourceId === 'jp-mufg') {
      const date = (node.attr('alt') ?? '').match(/(20\d{2})年(\d{1,2})月にお借り入れの場合/);
      if (date) months.add(month(date[1], date[2]));
      return;
    }
    if (element.tagName !== 'table') return;
    const header = compact(node.find('tr').first().text());
    if (
      sourceId === 'jp-mufg' &&
      !/^【(ずーっと一律優遇|最初に大きな優遇|全期間固定)コース】適用金利$/.test(header)
    )
      fail('unknown MUFG table heading');
    if (sourceId === 'jp-smbc' && header !== '金利タイプご融資期間ご融資利率(保証料内枠方式)')
      fail('unknown SMBC table heading');
    let category = '';
    node.find('tr').each((__, row) => {
      const cells = $(row)
        .children('th,td')
        .map((___, c) => compact($(c).text()))
        .get();
      if (!$(row).find('td').length) return;
      let label: string, term: string, cell: string, kind: JpObservation['rates'][number]['kind'];
      if (sourceId === 'jp-mufg') {
        if (cells.length !== 2) fail('MUFG cell count');
        [label, cell] = cells;
        kind =
          label === '変動金利'
            ? 'Variable'
            : /^固定(3|10|20)年$/.test(label)
              ? 'Initial fixed'
              : /^全期間固定\d+[~〜～]\d+年$/.test(label)
                ? 'Full-term fixed'
                : fail('unknown MUFG product');
        term = kind === 'Variable' ? 'Variable' : label.replace(/全期間固定|固定/, '');
      } else {
        if (cells.length === 3) category = cells.shift()!;
        if (cells.length !== 2) fail('SMBC cell count');
        [term, cell] = cells;
        kind =
          category === '変動金利型'
            ? 'Variable'
            : category === '固定金利特約型'
              ? 'Initial fixed'
              : category === '超長期固定金利型'
                ? 'Full-term fixed'
                : fail('unknown SMBC product');
        if (kind === 'Variable' ? term !== '-' : !/^[\d年超以内ヵ月]+$/.test(term))
          fail('unknown SMBC tenor');
        label = category + (term === '-' ? '' : term);
        if (term === '-') term = 'Variable';
      }
      const value = cell.match(/^年(\d+(?:\.\d+)?)%(?:\(店頭表示金利年(\d+(?:\.\d+)?)%\))?$/);
      if (!value) fail('ambiguous or missing percentage');
      if (sourceId === 'jp-mufg' && (kind !== 'Full-term fixed') !== Boolean(value[2]))
        fail('missing reference rate');
      const key = `${kind}-${term}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-$/, '');
      rates.push({
        id: `${sourceId}-${purpose!.toLowerCase()}-${key}`,
        purpose: purpose!,
        kind,
        term,
        label,
        annualRate: Number(value[1]),
        referenceRate: value[2] ? Number(value[2]) : null,
      });
      counts[purpose!]++;
    });
  });
  if (months.size !== 1) fail('missing or conflicting publication months');
  if (
    sourceId === 'jp-mufg'
      ? counts.Purchase !== 8 || counts.Refinance !== 8
      : counts.Purchase !== 11 || counts.Refinance !== 12
  )
    fail('incomplete rate tables');
  let conditions: string;
  if (sourceId === 'jp-mufg') {
    const start = text.indexOf('金利コースのご利用条件');
    const end = text.indexOf('住宅ローンシミュレーション', start);
    if (start < 0 || end < start) fail('missing MUFG conditions');
    conditions = text.slice(start, end).trim();
    if (!conditions.includes('日本国籍') || !conditions.includes('諸費用'))
      fail('missing eligibility / fees');
    // Include the actual post-fixed-period rules from the rate sections.
    const resets = [...text.matchAll(/当初固定期間終了後は、[^。]+。/g)].map((m) => m[0]);
    if (resets.length !== 2) fail('missing fixed-period reset terms');
    conditions = 'Purchase: ' + resets[0] + ' Refinance: ' + resets[1] + ' ' + conditions;
  } else {
    if (!text.includes('保証料内枠方式') || !text.includes('審査')) fail('missing SMBC conditions');
    conditions =
      'Standard schedule (保証料内枠方式). Individual discount plans, fees, insurance and borrower eligibility must be confirmed with SMBC. These are not discounted offers. ' +
      (text.match(/当行および当行の指定する保証会社の審査[^。]+。/)?.[0] ??
        fail('missing underwriting statement'));
  }
  return JpObservationSchema.parse({
    sourceId,
    observedAt,
    publicationMonth: [...months][0],
    conditions,
    rates,
  });
}
