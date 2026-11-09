import { load } from 'cheerio';
import { CPF_RELEASE, OfferSchema, singaporeDay } from '../src/lib/schema';
import { parseHdbQuarter } from './hdb-askgov';

// A dated public announcement, not a rolling API. Expiry is checked before GET.
export function cpfReleaseCurrent(at: string) {
  const day = singaporeDay(Date.parse(at));
  return day >= CPF_RELEASE.effectiveFrom && day <= CPF_RELEASE.effectiveUntil;
}

export function parseCpfRelease(html: string, at: string) {
  const $ = load(html);
  $('script,style,noscript').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  if (
    $('h1').length !== 1 ||
    $('h1').text().trim() !== CPF_RELEASE.title ||
    !text.includes('A Singapore Government Agency Website') ||
    !/\bCPF Board\b/.test(text)
  )
    throw Error('CPF release publication identity changed');
  const dates = $('.cmp-text > p')
    .toArray()
    .map((p) => $(p).text().trim())
    .filter((t) => /^\d{1,2} [A-Za-z]+ \d{4}$/.test(t));
  if (dates.length !== 1 || dates[0] !== '22 September 2026')
    throw Error('CPF release publication date changed');
  if (!cpfReleaseCurrent(at)) throw Error('CPF release quarter does not cover observation date');
  const period = '(\\d{1,2} [A-Za-z]+) to (\\d{1,2} [A-Za-z]+) (\\d{4})';
  const oa = [
    ...text.matchAll(
      new RegExp(
        'The Ordinary Account \\(OA\\) interest rate will remain unchanged at the floor rate of (\\d+(?:\\.\\d+)?)% per annum from ' +
          period,
        'g',
      ),
    ),
  ];
  const hdb = [
    ...text.matchAll(
      new RegExp(
        'the concessionary interest rate for HDB housing loans, which is pegged at (\\d+(?:\\.\\d+)?)% above the OA interest rate, will remain unchanged at (\\d+(?:\\.\\d+)?)% per annum from ' +
          period,
        'g',
      ),
    ),
  ];
  const summary = [
    ...text.matchAll(
      new RegExp(
        'HDB Concessionary Interest Rate from ' +
          period +
          ' Remains unchanged at (\\d+(?:\\.\\d+)?)%',
        'g',
      ),
    ),
  ];
  if (oa.length !== 1 || hdb.length !== 1 || summary.length !== 1)
    throw Error('CPF release explicit OA/HDB rates missing or ambiguous');
  const o = oa[0],
    h = hdb[0],
    s = summary[0];
  if (
    o.slice(2).join('|') !== h.slice(3).join('|') ||
    s.slice(1, 4).join('|') !== h.slice(3).join('|') ||
    Number(s[4]) !== Number(h[2])
  )
    throw Error('CPF release rate or period conflicts');
  const from = `${h[3]} ${h[5]}`,
    until = `${h[4]} ${h[5]}`;
  const label = `${h[3].replace(/^\d+ /, '')} ${h[5]} to ${h[4].replace(/^\d+ /, '')} ${h[5]}`;
  // Normalize explicit prose fields to the existing strict quarter validator.
  // Neither HDB rate nor OA rate is inferred from the other.
  const offer = parseHdbQuarter(
    {
      text: `Computation of CPF OA Interest Rate and HDB Mortgage Rate for ${from} to ${until}`,
      tables: [
        [
          [`HDB mortgage rate for ${label}`, `${h[2]}% per annum`],
          [`CPF OA interest rate for ${label}`, `${o[1]}% per annum`],
          ['Plus: Fee to cover Cost of Loan Administration', `${h[1]}%`],
        ],
      ],
    },
    at,
  );
  if (
    offer.effectiveFrom !== CPF_RELEASE.effectiveFrom ||
    offer.effectiveUntil !== CPF_RELEASE.effectiveUntil
  )
    throw Error('CPF release configured quarter mismatch');
  return [
    OfferSchema.parse({
      ...offer,
      documentDate: CPF_RELEASE.documentDate,
      evidenceSourceId: CPF_RELEASE.id,
    }),
  ];
}
