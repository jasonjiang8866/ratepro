import { useState } from 'react';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import { articles } from '../lib/content';
import { articleHref, marketMoney } from '../lib/markets';
import { editorialStatus } from '../lib/editorial';
import { payment } from '../lib/data';
import { Input } from './ui/input';

export function JapanTools({ tab, now }: { tab: string; now: Date }) {
  const records = articles.filter((a) => a.market === 'JP');
  const packages = records.filter(
    (a) => a.category === 'package' && !records.some((b) => b.supersedes === a.slug),
  );
  const [principal, setPrincipal] = useState('30000000');
  const [years, setYears] = useState('35');
  const [rate, setRate] = useState('');
  const valid =
    principal.trim() !== '' &&
    rate.trim() !== '' &&
    years.trim() !== '' &&
    [principal, rate, years].every((v) => Number.isFinite(Number(v))) &&
    Number(principal) > 0 &&
    Number(principal) <= 1000000000 &&
    Number(years) >= 1 &&
    Number(years) <= 50 &&
    Number(rate) >= 0 &&
    Number(rate) <= 30;
  const monthly = valid ? payment(Number(principal), Number(rate), Number(years)) : null;
  if (tab === 'Sources') {
    const sources = [...new Map(records.flatMap((a) => a.sources).map((s) => [s.url, s])).values()];
    return (
      <section className="jp-tools">
        <div className="eyebrow">JAPAN · OFFICIAL PUBLICATIONS</div>
        <h1>Follow Japan’s sources.</h1>
        <p className="reader-deck">
          Original Japanese publications, with dated English reading notes.
        </p>
        <p className="market-coverage">
          These are editorial source checks. No automated Japanese bank-rate collector is connected,
          and no Singapore observations are used here.
        </p>
        <div className="jp-source-grid">
          {sources.map((s) => (
            <article className="watch-card" key={s.url}>
              <h2>{s.publisher}</h2>
              <p>{s.title}</p>
              <p>
                Checked{' '}
                {new Intl.DateTimeFormat('en-JP', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Asia/Tokyo',
                }).format(new Date(s.checkedAt))}{' '}
                JST
              </p>
              <a className="text-link" href={s.url} target="_blank" rel="noreferrer">
                Read official source <ArrowUpRight size={16} />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </article>
          ))}
        </div>
      </section>
    );
  }
  if (tab === 'History')
    return (
      <section className="journal-empty">
        <h1>Japan’s observation history starts here.</h1>
        <p>
          Japan does not yet have an automated rate feed or browser rate history. Dated research
          remains in the journal.
        </p>
        <a className="text-link" href="#/home">
          Read the Japan journal <ArrowRight size={16} />
        </a>
      </section>
    );
  return (
    <section className="jp-tools">
      <div className="eyebrow">JAPAN / 日本 · JPY</div>
      <h1>
        Explore the structure.
        <br />
        <em>Then compare the terms.</em>
      </h1>
      <p className="reader-deck">Start with reviewed publications and a yen repayment scenario.</p>
      <p className="market-coverage">
        <strong>Research edition.</strong> The reports below are selected observations, not an
        exhaustive live rate ranking or a personalised quote. Automated Japanese bank-rate
        collection is not connected yet.
      </p>
      <div className="jp-layout">
        <div>
          <h2>Reviewed package observations</h2>
          {packages.map((a) => (
            <article className="watch-card" key={a.slug}>
              <span className="eyebrow">{a.package!.lender}</span>
              <span className="story-status">{editorialStatus(a, now)}</span>
              <h3>
                <a href={articleHref(a)}>{a.title}</a>
              </h3>
              <p>{a.summary}</p>
              <p>
                <strong>Who it covers:</strong> {a.package!.eligibility}
              </p>
              <a className="text-link" href={articleHref(a)}>
                Read terms & evidence <ArrowRight size={16} />
              </a>
            </article>
          ))}
          {!packages.length && <p>No reviewed Japanese package records yet.</p>}
          <div className="jp-reading">
            <h2>Before you choose</h2>
            {records
              .filter((a) => a.category === 'guide')
              .map((a) => (
                <a className="text-link" key={a.slug} href={articleHref(a)}>
                  {a.title}
                  <ArrowRight size={16} />
                </a>
              ))}
          </div>
        </div>
        <aside className="watch-card jp-calculator">
          <div className="eyebrow">YOUR SCENARIO · JPY</div>
          <h2>Make the numbers real.</h2>
          <label htmlFor="jp-principal" className="field-label">
            Loan amount (JPY)
          </label>
          <Input
            id="jp-principal"
            type="number"
            min="1"
            max="1000000000"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
          />
          <label htmlFor="jp-years" className="field-label">
            Tenure (years)
          </label>
          <Input
            id="jp-years"
            type="number"
            min="1"
            max="50"
            value={years}
            onChange={(e) => setYears(e.target.value)}
          />
          <label htmlFor="jp-rate" className="field-label">
            Your assumed annual rate (%)
          </label>
          <Input
            id="jp-rate"
            type="number"
            min="0"
            max="30"
            step="0.01"
            placeholder="Enter a scenario rate"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <div className="payment" aria-live="polite">
            <span>Estimated monthly payment · JPY</span>
            <strong>{monthly !== null ? marketMoney(monthly, 'JP') : '—'}</strong>
          </div>
          <p className="calc-footnote">
            A constant-rate, equal-payment illustration only. Excludes fees, insurance, tax relief,
            bonus repayments and rate resets. It does not model staged Flat35 discounts or any
            five-year / 125% payment rule. Tenure and borrowing eligibility depend on the lender.
          </p>
          {!valid && (
            <p className="text-sm">
              Enter a loan up to ¥1 billion, 1–50 years and an assumed rate of 0–30%.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
