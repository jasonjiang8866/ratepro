import { spawn } from 'node:child_process';
import { OfferSchema, singaporeDay, soraFormula, type Offer } from '../src/lib/schema';
import { MAX_BYTES } from '../src/lib/data';

// Poppler is a build-time dependency only; no PDF code is shipped to browsers.
export async function pdfText(bytes: Uint8Array): Promise<string> {
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
    throw Error('Expected a PDF document');
  return new Promise((resolve, reject) => {
    const child = spawn('pdftotext', ['-layout', '-', '-'], { timeout: 10000 });
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        child.kill();
        reject(Error('PDF text too large'));
      } else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on('error', () => reject(Error('PDF extraction unavailable; install poppler-utils')));
    child.stdin.on('error', () => reject(Error('PDF input rejected')));
    child.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks).toString('utf8'))
        : reject(Error('PDF extraction failed')),
    );
    child.stdin.end(bytes);
  });
}

export function parseCiti(text: string, at: string, method: Offer['method']): Offer[] {
  const pages = text
    .split('\f')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (pages.length !== 2) throw Error('Citi document page count changed');
  const all: Offer[] = [];
  let documentDate: string | undefined;
  for (const [index, page] of pages.entries()) {
    const tier = index === 0 ? 'Citigold' : 'Citibanking';
    if (!page.includes(`${tier} Interest Rate Packages (Limited Tranche for Fixed Rate Packages)`))
      throw Error('Citi customer tier changed');
    const dates = [...page.matchAll(/Printed on (\d{2})\/(\d{2})\/(\d{4})/g)];
    if (dates.length !== 1) throw Error('Citi document date missing or ambiguous');
    const [, dd, mm, yyyy] = dates[0];
    const day = `${yyyy}-${mm}-${dd}`;
    if (
      !Number.isFinite(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day ||
      day > singaporeDay(Date.parse(at)) ||
      (documentDate && documentDate !== day)
    )
      throw Error('Citi document date invalid or inconsistent');
    documentDate = day;
    const floors = [
      ...page.matchAll(
        /minimum Effective Interest Rate for Compounded SORA packages is (\d+(?:\.\d+)?)%/g,
      ),
    ];
    const aum = page.match(/maintain a Citigold banking relationship with AUM≥S\$([\d,]+)/);
    if (floors.length !== 1 || !aum) throw Error('Citi floor or relationship requirement missing');
    const blocks = page.split('Applicable to Minimum Loan Size of ').slice(1);
    if (
      blocks.length !== (index === 0 ? 5 : 4) ||
      (page.match(/Variable Interest Rate Package/g) ?? []).length !== 2
    )
      throw Error('Citi product layout changed');
    // Completed-variable schedules only. Fixed and BUC packages are intentionally excluded.
    for (let band = 0; band < 2; band++) {
      const block = blocks[band];
      const match = block.match(
        /^S\$([\d,]+)(?: \(less than S\$([\d,]+)\))? Variable Interest Rate Package Promotional Period Post-Promotional Period Completed Property \((\d+)-year Lock-in\) Year 1 Year 2 Year 3 Year 4 and onwards Compounded SORA \(where applicable\) 1M Compounded SORA 1M Compounded SORA Interest Rate Spread (.+)$/,
      );
      if (!match) throw Error('Citi variable schedule or tenor changed');
      const minLoan = Number(match[1].replaceAll(',', ''));
      const maxLoanExclusive = match[2] ? Number(match[2].replaceAll(',', '')) : undefined;
      if (
        (band === 0 && maxLoanExclusive !== undefined) ||
        (band === 1 && (!maxLoanExclusive || maxLoanExclusive <= minLoan))
      )
        throw Error('Citi loan bands changed');
      const rates = [...match[4].matchAll(/\+ (\d+(?:\.\d+)?)% p\.a\./g)];
      if (rates.length !== 4 || match[4].replace(/\+ \d+(?:\.\d+)?% p\.a\./g, '').trim())
        throw Error('Citi spread columns changed');
      const stages = rates.map((r, i) => ({
        label: i === 3 ? 'Year 4 onwards' : `Year ${i + 1}`,
        rate: null,
        formula: soraFormula('1M', Number(r[1])),
        benchmark: { name: 'SORA', tenor: '1M', spread: Number(r[1]) },
      }));
      all.push(
        OfferSchema.parse({
          id: `citi-${tier.toLowerCase()}-sora-${band === 0 ? 'large' : 'small'}`,
          sourceId: 'citi',
          bank: 'Citi',
          name: `${tier} · 1M SORA · ${band === 0 ? 'upper' : 'lower'} loan band`,
          property: 'Confirm with lender',
          purpose: ['Confirm with lender'],
          construction: 'Completed',
          kind: 'Floating',
          minLoan,
          maxLoanExclusive,
          customerTier: tier,
          minRelationshipBalance:
            tier === 'Citigold' ? Number(aum[1].replaceAll(',', '')) : undefined,
          lockYears: Number(match[3]),
          rateFloor: Number(floors[0][1]),
          stages,
          documentDate,
          terms:
            'Published new-home-loan PDF; completed-property variable schedule only. Confirm HDB/private eligibility, purchase/refinance purpose and availability with Citi. Tier and loan-band conditions apply. The document print date is not an observation or effective date. The SORA formula is subject to the stated minimum effective rate; no current fixing is collected.',
          observedAt: at,
          method,
        }),
      );
    }
    const [upper, lower] = all.slice(-2);
    if (lower.maxLoanExclusive !== upper.minLoan)
      throw Error('Citi loan bands overlap or have a gap');
  }
  return all;
}
