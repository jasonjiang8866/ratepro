import { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import { editorialClient } from '../lib/content';
import { type EditorialPage, type EditorialFilter } from '../lib/editorial-data';
import { articleHref } from '../lib/markets';
import { editorialStatus } from '../lib/editorial';
import { payment } from '../lib/data';
import { ScenarioCalculator } from './ScenarioCalculator';
import { JapanRates } from './JapanRates';

export function JapanTools({ tab, now }: { tab: string; now: Date }) {
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
    return (
      <section className="jp-tools">
        <div className="eyebrow">JAPAN · OFFICIAL PUBLICATIONS</div>
        <h1>Follow Japan’s sources.</h1>
        <p className="reader-deck">
          Original Japanese publications, with dated English reading notes.
        </p>
        <p className="market-coverage">
          Automated bank observations and editorial evidence have separate timestamps. Japan uses
          its own JPY snapshot; no Singapore observations are included.
        </p>
        <JapanRates now={now} sourcesOnly />
        <h2>Editorial evidence</h2>
        <EditorialLinks category="all" now={now} />
      </section>
    );
  }
  if (tab === 'History')
    return (
      <section className="journal-empty">
        <h1>Japan’s observation history starts here.</h1>
        <p>
          Japan’s daily snapshots are versioned in the repository. A browser change-history view is
          not available yet; dated research remains in the journal.
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
      <p className="reader-deck">
        Find your rate type. Compare the details. Try a yen repayment scenario.
      </p>
      <p className="market-coverage">
        <strong>Research edition.</strong> Selected official observations · not personalised quotes.
        Confirm eligibility and full terms with the lender.
      </p>
      <div className="jp-layout">
        <div>
          <JapanRates now={now} />
          <h2>Reviewed package observations</h2>
          <EditorialLinks category="package" now={now} />
          <div className="jp-reading">
            <h2>Before you choose</h2>
            <EditorialLinks category="guide" now={now} />
          </div>
        </div>
        <ScenarioCalculator
          market="JP"
          principal={principal}
          years={years}
          rate={rate}
          monthly={monthly}
          setPrincipal={setPrincipal}
          setYears={setYears}
          setRate={setRate}
        />
      </div>
    </section>
  );
}

function EditorialLinks({ category, now }: { category: EditorialFilter; now: Date }) {
  const [number, setNumber] = useState(1),
    [retry, setRetry] = useState(0);
  const [page, setPage] = useState<EditorialPage>(),
    [error, setError] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setPage(undefined);
    setError(false);
    editorialClient
      .page('JP', category, number, c.signal)
      .then((p) => {
        if (!c.signal.aborted) setPage(p);
      })
      .catch(() => {
        if (!c.signal.aborted) setError(true);
      });
    return () => c.abort();
  }, [category, number, retry]);
  if (error)
    return (
      <p role="alert">
        Editorial evidence is unavailable.{' '}
        <button
          onClick={() => {
            editorialClient.clear();
            setRetry((r) => r + 1);
          }}
        >
          Retry content
        </button>
      </p>
    );
  if (!page) return <p role="status">Loading editorial evidence…</p>;
  return (
    <div className="jp-editorial-links">
      {page.items.map((a) => (
        <article className="watch-card" key={a.slug}>
          <span className="story-status">
            {a.supersededBy ? 'Superseded report' : editorialStatus(a, now)}
          </span>
          <h3>
            <a href={articleHref(a)}>{a.title}</a>
          </h3>
          <p>{a.summary}</p>
          <a className="text-link" href={articleHref(a)}>
            Read terms & evidence <ArrowRight size={16} />
          </a>
        </article>
      ))}
      {!page.total && <p>No reviewed reports in this category yet.</p>}
      <nav className="journal-pagination" aria-label={`${category} report pages`}>
        <button disabled={page.page === 1} onClick={() => setNumber((n) => n - 1)}>
          Previous page
        </button>
        <span>
          Page {page.page} of {Math.max(1, Math.ceil(page.total / 20))}
        </span>
        <button disabled={page.page * 20 >= page.total} onClick={() => setNumber((n) => n + 1)}>
          Next page
        </button>
      </nav>
    </div>
  );
}
