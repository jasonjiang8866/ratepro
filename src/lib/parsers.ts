import { OfferSchema, type Offer } from './schema';
export interface Page {
  text: string;
  tables: string[][][];
}
export function browserPage(html: string): Page {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript').forEach((e) => e.remove());
  return {
    text: doc.body.textContent ?? '',
    tables: Array.from(doc.querySelectorAll('table')).map((t) =>
      Array.from(t.querySelectorAll('tr')).map((r) =>
        Array.from(r.querySelectorAll('th,td')).map((c) =>
          (c.textContent ?? '').replace(/\s+/g, ' ').trim(),
        ),
      ),
    ),
  };
}
function row(table: string[][], label: RegExp) {
  const found = table.find((r) => label.test(r[0] ?? ''));
  if (!found || found.length !== 2)
    throw Error('Expected rate table changed; retained previous data');
  return found[1];
}
function percent(s: string) {
  const n = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!n) throw Error('Missing advertised rate');
  return Number(n[1]);
}
function amount(s: string) {
  const n = s.match(/S\$\s*([\d,]+)/);
  if (!n) throw Error('Missing minimum loan');
  return Number(n[1].replaceAll(',', ''));
}
export function parseDbsHdb(page: Page, at: string, method: Offer['method']): Offer[] {
  const table = page.tables.find((t) =>
    t.some((r) => /^Reference rate$/i.test(r[0]) && /CPF-OA/i.test(r[1])),
  );
  if (!table) throw Error('CPF-OA package table not found');
  const stages = [/^Year 1 to Year 3$/i, /^Year 4 to Year 5$/i, /^Thereafter$/i].map((label, i) => {
    const value = row(table, label);
    const m = value.match(/Pegged at\s+(\d+(?:\.\d+)?)%\s*p\.a\.\s*below CPF-OA rate/i);
    if (!m) throw Error('CPF-OA formula changed');
    return {
      label: ['Years 1–3', 'Years 4–5', 'Thereafter'][i],
      rate: percent(value),
      formula: `CPF-OA − ${m[1]}%`,
    };
  });
  const lock = row(table, /^Commitment period$/i).match(/^(\d+) years?$/i);
  if (!lock) throw Error('Commitment period changed');
  const terms = row(table, /^Maximum loan tenure$/i);
  return [
    OfferSchema.parse({
      id: 'dbs-hdb-cpf-oa',
      sourceId: 'dbs-hdb',
      bank: 'DBS',
      name: '3-Year CPF-OA HDB Loan',
      property: 'HDB',
      purpose: ['Purchase', 'Refinance'],
      construction: 'Completed',
      kind: 'Floating',
      stages,
      lockYears: Number(lock[1]),
      minLoan: amount(row(table, /^Minimum loan amount$/i)),
      terms: `CPF-OA-linked variable rate, not a fixed rate. ${terms}. Confirm eligibility, fees and available package with DBS.`,
      observedAt: at,
      method,
    }),
  ];
}
export function parseDbsGreen(page: Page, at: string, method: Offer['method']): Offer[] {
  const table = page.tables.find((t) =>
    t.some((r) => /^Year 1\s*[–-]\s*4$/i.test(r[0]) && /FHR6/i.test(r[1])),
  );
  if (!table) throw Error('Green FHR6 package table not found');
  const stages = [/^Year 1\s*[–-]\s*4$/i, /^Thereafter$/i].map((label, i) => {
    const value = row(table, label);
    const m = value.match(/FHR6\s*\+\s*(\d+(?:\.\d+)?)%.*?All-in rate:\s*(\d+(?:\.\d+)?)%/i);
    if (!m) throw Error('Green package formula changed');
    return {
      label: i ? 'Thereafter' : 'Years 1–4',
      rate: Number(m[2]),
      formula: `FHR6 + ${m[1]}%`,
    };
  });
  return [
    OfferSchema.parse({
      id: 'dbs-green-fhr6',
      sourceId: 'dbs-green',
      bank: 'DBS',
      name: 'Green Home Loan · FHR6',
      property: 'Private',
      purpose: ['Purchase'],
      construction: 'Under construction',
      kind: 'Floating',
      stages,
      lockYears: null,
      minLoan: amount(row(table, /^Minimum Loan Size$/i)),
      terms:
        'For eligible green properties under construction. FHR6 is a bank reference rate and may change. Conversion features, green certification, fees and eligibility require confirmation with DBS. Lock-in not extracted.',
      observedAt: at,
      method,
    }),
  ];
}
export function parseHdb(page: Page, at: string, method: Offer['method']): Offer[] {
  const today = at.slice(0, 10);
  const candidates: { end: string; rate: number }[] = [];
  for (const table of page.tables)
    for (const r of table) {
      if (r.length !== 2) continue;
      const m = r[0].match(/^(\d{1,2} [A-Za-z]+ \d{4})\s+to\s+(\d{1,2} [A-Za-z]+ \d{4})$/);
      if (!m) continue;
      const start = new Date(m[1] + ' 00:00:00 UTC'),
        end = new Date(m[2] + ' 00:00:00 UTC');
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue;
      if (start.toISOString().slice(0, 10) <= today && end.toISOString().slice(0, 10) >= today)
        candidates.push({ end: end.toISOString().slice(0, 10), rate: percent(r[1]) });
    }
  if (candidates.length !== 1 || !/concessionary/i.test(page.text))
    throw Error('Current HDB concessionary quarter not found');
  return [
    OfferSchema.parse({
      id: 'hdb-concessionary',
      sourceId: 'hdb',
      bank: 'HDB',
      name: 'HDB concessionary loan',
      property: 'HDB',
      purpose: ['Purchase'],
      construction: 'Any',
      kind: 'Concessionary',
      stages: [{ label: 'Current quarter', rate: candidates[0].rate, formula: 'CPF-OA + 0.10%' }],
      lockYears: null,
      minLoan: null,
      terms:
        'For eligible HDB buyers. Rate is reviewed quarterly and is not fixed for the full tenure. Confirm HFE eligibility and terms with HDB.',
      observedAt: at,
      effectiveUntil: candidates[0].end,
      method,
    }),
  ];
}
export const parsers = { 'dbs-hdb': parseDbsHdb, 'dbs-green': parseDbsGreen, hdb: parseHdb };
