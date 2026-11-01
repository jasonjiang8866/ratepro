import { OfferSchema, soraFormula, singaporeDay, type Offer } from './schema';
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
  const matches = table.filter((r) => label.test(r[0] ?? ''));
  const found = matches[0];
  if (matches.length !== 1 || found.length !== 2)
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
  const today = singaporeDay(Date.parse(at));
  const candidates: { start: string; end: string; rate: number }[] = [];
  for (const table of page.tables)
    for (const r of table) {
      if (r.length !== 2) continue;
      const m = r[0].match(/^(\d{1,2} [A-Za-z]+ \d{4})\s+to\s+(\d{1,2} [A-Za-z]+ \d{4})$/);
      if (!m) continue;
      const start = new Date(m[1] + ' 00:00:00 UTC'),
        end = new Date(m[2] + ' 00:00:00 UTC');
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue;
      if (start.toISOString().slice(0, 10) <= today && end.toISOString().slice(0, 10) >= today)
        candidates.push({
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10),
          rate: percent(r[1]),
        });
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
      effectiveFrom: candidates[0].start,
      effectiveUntil: candidates[0].end,
      method,
    }),
  ];
}
function uniqueTable(page: Page, heading: RegExp) {
  const matches = page.tables.filter((t) => t[0]?.length === 1 && heading.test(t[0][0]));
  if (matches.length !== 1) throw Error('Expected one unambiguous package table');
  return matches[0];
}
function soraStage(label: string, value: string): Offer['stages'][number] {
  const m = value.match(/^([13])M Compounded SORA\s*\+\s*(\d+(?:\.\d+)?)%\s*p\.a\.$/i);
  if (!m) throw Error('Unrecognised SORA formula; retained previous data');
  const spread = Number(m[2]);
  const tenor = `${m[1]}M` as '1M' | '3M';
  return {
    label,
    rate: null,
    formula: soraFormula(tenor, spread),
    benchmark: { name: 'SORA', tenor, spread },
  };
}
function lockYears(table: string[][]) {
  const m = row(table, /^Lock-in period$/i).match(/^(\d+) years?$/i);
  if (!m) throw Error('Lock-in period changed');
  return Number(m[1]);
}
function checkStageLabels(table: string[][], labels: string[]) {
  const found = table.filter((r) => /^(Year|Thereafter)/i.test(r[0] ?? '')).map((r) => r[0]);
  if (JSON.stringify(found) !== JSON.stringify(labels)) throw Error('Rate schedule changed');
}

export function parseMaybank(page: Page, at: string, method: Offer['method']): Offer[] {
  const text = page.text.replace(/\s+/g, ' ');
  if (
    !/valid for completed residential properties in Singapore, for new purchase or refinancing from another financial institution/i.test(
      text,
    )
  )
    throw Error('Maybank eligibility text changed');
  const limits = [
    ...text.matchAll(/minimum loan size of S\$([\d,]+) and minimum loan tenure of (\d+) years/gi),
  ];
  if (!limits.length || limits.some((m) => m[1] !== limits[0][1] || m[2] !== limits[0][2]))
    throw Error('Maybank minimum loan conditions missing or ambiguous');
  const minLoan = Number(limits[0][1].replaceAll(',', ''));
  const base = {
    sourceId: 'maybank',
    bank: 'Maybank',
    property: 'HDB / Private',
    purpose: ['Purchase', 'Refinance'],
    construction: 'Completed',
    minLoan,
    terms: `Published indicative package for completed Singapore residential property; confirm property eligibility with Maybank. Minimum tenure ${limits[0][2]} years. SORA stages show the bank spread, not an all-in rate; the applicable fixing depends on drawdown or reset date. Fees, subsidies and approval require confirmation.`,
    observedAt: at,
    method,
  };
  const fixed = [2, 3].map((years) => {
    const table = uniqueTable(page, new RegExp(`^${years}-year Fixed Rate$`, 'i'));
    const labels = Array.from({ length: years }, (_, i) => `Year ${i + 1}`);
    checkStageLabels(table, [...labels, 'Thereafter']);
    const stages = labels.map((label) => {
      const value = row(table, new RegExp(`^${label}$`));
      const m = value.match(/^(\d+(?:\.\d+)?)%\s*p\.a\.$/i);
      if (!m) throw Error('Fixed rate missing or replaced by a formula');
      return { label, rate: Number(m[1]), formula: 'Fixed' };
    });
    return OfferSchema.parse({
      ...base,
      id: `maybank-fixed-${years}y`,
      name: `${years}-year fixed · completed property`,
      kind: 'Fixed',
      lockYears: lockYears(table),
      stages: [...stages, soraStage('Thereafter', row(table, /^Thereafter$/))],
    });
  });
  const floating = [1, 3].map((months) => {
    const heading =
      months === 1
        ? /^1-Month Compounded SORA \(For Completed properties\)$/i
        : /^3M Compounded SORA \(For completed properties\)$/i;
    const table = uniqueTable(page, heading);
    const labels =
      months === 1 ? ['Year 1', 'Year 2', 'Thereafter'] : ['Year 1 to Year 3', 'Thereafter'];
    checkStageLabels(table, labels);
    const stages = labels.map((label) => soraStage(label, row(table, new RegExp(`^${label}$`))));
    if (
      stages.some((s) => s.benchmark?.tenor !== `${months}M`) ||
      row(table, /^Rate refresh$/i) !== `Every ${months} month${months === 1 ? '' : 's'}`
    )
      throw Error('SORA tenor or refresh period changed');
    return OfferSchema.parse({
      ...base,
      id: `maybank-sora-${months}m`,
      name: `${months}M SORA · completed property`,
      kind: 'Floating',
      lockYears: lockYears(table),
      stages,
    });
  });
  // Parse the complete supported group before returning any observations.
  return [...fixed, ...floating];
}

export function parseScSora(page: Page, at: string, method: Offer['method']): Offer[] {
  const text = page.text.replace(/\s+/g, ' ');
  if (
    !/Only Private Residential and HDB flats \(completed or BUC\) are eligible for SORA package used for new purchase or refinancing\./i.test(
      text,
    )
  )
    throw Error('Standard Chartered eligibility changed');
  const dateMatch = text.match(
    /interest rate package stated in the table above is valid from (\d{1,2} [A-Za-z]+ \d{4})/i,
  );
  if (!dateMatch) throw Error('Published package effective date missing');
  const effective = new Date(`${dateMatch[1]} 00:00:00 UTC`);
  if (
    !Number.isFinite(effective.getTime()) ||
    effective.toISOString().slice(0, 10) > at.slice(0, 10)
  )
    throw Error('Invalid or future package effective date');
  const table = uniqueTable(page, /^3M Compounded SORA\*$/i);
  const labels = ['Year 1', 'Year 2', 'Year 3', 'Thereafter'];
  checkStageLabels(table, labels);
  const stages = labels.map((label) => soraStage(label, row(table, new RegExp(`^${label}$`))));
  if (stages.some((s) => s.benchmark?.tenor !== '3M')) throw Error('SC benchmark tenor changed');
  const minimum = row(table, /^Minimum Loan Amount$/i);
  if (!/^S\$[\d,]+$/.test(minimum)) throw Error('Minimum loan format changed');
  return [
    OfferSchema.parse({
      id: 'sc-sora-3m',
      sourceId: 'sc-sora',
      bank: 'Standard Chartered',
      name: '3M SORA · published package',
      property: 'HDB / Private',
      purpose: ['Purchase', 'Refinance'],
      construction: 'Any',
      kind: 'Floating',
      stages,
      lockYears: lockYears(table),
      minLoan: amount(minimum),
      effectiveFrom: effective.toISOString().slice(0, 10),
      terms: `The source states this schedule is valid from ${dateMatch[1]}; a recent observation does not mean a new promotion. Confirm current availability with Standard Chartered. Applies to completed or under-construction HDB/private homes for purchase or refinancing. SORA plus spread is a formula, not an all-in quote. Fees and subsidies are not extracted.`,
      observedAt: at,
      method,
    }),
  ];
}
export const parsers = {
  'dbs-hdb': parseDbsHdb,
  'dbs-green': parseDbsGreen,
  hdb: parseHdb,
  maybank: parseMaybank,
  'sc-sora': parseScSora,
  'uob-sora': parseUobSora,
};

export function parseUobSora(page: Page, at: string, method: Offer['method']): Offer[] {
  const tables = page.tables.filter(
    (t) =>
      t[0]?.length === 2 &&
      t[0][0] === '' &&
      /^SORA PROMOTIONAL Limited tranche for New Direct-to-Bank\* customers only$/.test(t[0][1]),
  );
  if (tables.length !== 1) throw Error('UOB promotional table missing or ambiguous');
  const table = tables[0];
  const text = table.flat().join(' ');
  if (
    !/valid for completed residential properties in Singapore, for new purchase or refinancing from another bank\/HDB\./.test(
      text,
    )
  )
    throw Error('UOB eligibility changed');
  const labels = ['Year 1', 'Year 2', 'Year 3', 'Year 4 and thereafter'];
  checkStageLabels(table, labels);
  const stages = labels.map((label) => soraStage(label, row(table, new RegExp(`^${label}$`))));
  if (stages.some((s) => s.benchmark?.tenor !== '3M')) throw Error('UOB tenor changed');
  const lock = row(table, /^Lock in Period$/).match(/^(\d+) years$/);
  const min = row(table, /^Min Loan Size$/);
  if (!lock || !/^S\$[\d,]+$/.test(min)) throw Error('UOB loan conditions changed');
  return [
    OfferSchema.parse({
      id: 'uob-sora-3m',
      sourceId: 'uob-sora',
      bank: 'UOB',
      name: '3M SORA · new direct-to-bank customers',
      property: 'HDB / Private',
      purpose: ['Purchase', 'Refinance'],
      construction: 'Completed',
      kind: 'Floating',
      stages,
      lockYears: Number(lock[1]),
      minLoan: amount(min),
      terms:
        'Limited promotional tranche for new direct-to-bank customers, completed residential property, purchase or refinancing from another bank/HDB. Fixed-rate packages require a separate quote. Confirm availability and eligibility in the Letter of Offer; prepayment, sale and conversion concessions have conditions. SORA fixing is not collected.',
      observedAt: at,
      method,
    }),
  ];
}
