import { HDB_FALLBACK, OfferSchema, singaporeDay, type Offer } from '../src/lib/schema';
import { parseHdb, type Page } from '../src/lib/parsers';

const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
function calendarDate(value: string) {
  const match = value.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/);
  if (!match) throw Error('Missing AskGov quarter date');
  const month = months.indexOf(match[2]);
  const day = Number(match[1]),
    year = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (
    month < 0 ||
    year < 2000 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  )
    throw Error('Invalid AskGov quarter date');
  return date;
}
function oneRow(table: string[][], label: string) {
  const rows = table.filter((row) => row[0] === label);
  if (rows.length !== 1 || rows[0].length !== 2)
    throw Error('AskGov rate row changed or ambiguous');
  return rows[0][1];
}
function rate(value: string, suffix: RegExp) {
  const match = value.match(suffix);
  if (!match) throw Error('AskGov rate format changed');
  return Number(match[1]);
}

// Only factual table cells are consumed. Relative "Updated ... ago" text is never a date.
export function parseHdbAskGov(page: Page, at: string): Offer[] {
  const text = page.text.replace(/\s+/g, ' ').trim();
  if (!text.includes('How are CPF interest rates determined?') || !/Updated by\s+CPF/.test(text))
    throw Error('AskGov CPF publication identity missing');
  const periods = [
    ...text.matchAll(
      /Computation of CPF OA Interest Rate and HDB Mortgage Rate for (\d{1,2} [A-Za-z]+ \d{4}) to (\d{1,2} [A-Za-z]+ \d{4})/g,
    ),
  ];
  if (periods.length !== 1) throw Error('Expected one explicit AskGov HDB quarter');
  const start = calendarDate(periods[0][1]),
    end = calendarDate(periods[0][2]);
  const expectedEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0));
  if (start.getUTCDate() !== 1 || start.getUTCMonth() % 3 !== 0 || +end !== +expectedEnd)
    throw Error('AskGov period is not one complete quarter');
  const from = start.toISOString().slice(0, 10),
    until = end.toISOString().slice(0, 10);
  const today = singaporeDay(Date.parse(at));
  if (today < from || today > until)
    throw Error('AskGov HDB quarter does not cover observation date');

  const tables = page.tables.filter((table) =>
    table.some((row) => /^HDB mortgage rate for /.test(row[0] ?? '')),
  );
  if (tables.length !== 1) throw Error('Expected one AskGov HDB mortgage table');
  const period = `${months[start.getUTCMonth()]} ${start.getUTCFullYear()} to ${months[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
  const hdb = rate(
    oneRow(tables[0], `HDB mortgage rate for ${period}`),
    /^(\d+(?:\.\d+)?)% per annum$/,
  );
  const oa = rate(
    oneRow(tables[0], `CPF OA interest rate for ${period}`),
    /^(\d+(?:\.\d+)?)% per annum(?:\s*\(legislated minimum rate\))?$/,
  );
  const fee = rate(
    oneRow(tables[0], 'Plus: Fee to cover Cost of Loan Administration'),
    /^(\d+(?:\.\d+)?)%$/,
  );
  // Validate the published numbers; never derive an absent HDB rate from OA.
  if (fee !== 0.1 || Math.abs(oa + fee - hdb) > 0.000001)
    throw Error('AskGov HDB/OA relationship changed or inconsistent');

  const [offer] = parseHdb(
    { text: 'HDB concessionary', tables: [[[`${periods[0][1]} to ${periods[0][2]}`, `${hdb}%`]]] },
    at,
    'collector',
  );
  return [OfferSchema.parse({ ...offer, evidenceSourceId: HDB_FALLBACK.id })];
}
