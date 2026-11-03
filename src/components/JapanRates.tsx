import { useEffect, useState } from 'react';
import published from '../../public/data/rates-jp.json';
import { JP_SOURCES, JpFeedSchema, jpFreshness, type JpFeed } from '../lib/japan-rates';
import { fetchText } from '../lib/sync';
import { JapanComparison, japanObservedDate } from './JapanComparison';
import { japanComparisonItems, JP_COMPARISON_LIMIT, type JpPurpose } from '../lib/japan-comparison';

export function JapanRates({ now, sourcesOnly = false }: { now: Date; sourcesOnly?: boolean }) {
  const [feed, setFeed] = useState<JpFeed>(() => JpFeedSchema.parse(published));
  const [error, setError] = useState(false);
  const [purpose, setPurpose] = useState<JpPurpose>('Purchase');
  const [selected, setSelected] = useState<string[]>([]);
  const comparison = japanComparisonItems(feed, selected, purpose);
  const selectedIds = comparison.map(({ rate }) => rate.id);
  useEffect(() => {
    let active = true;
    fetchText('/data/rates-jp.json')
      .then((text) => {
        const next = JpFeedSchema.parse(JSON.parse(text));
        if (active)
          setFeed((old) =>
            Date.parse(next.generatedAt) >= Date.parse(old.generatedAt) ? next : old,
          );
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const date = japanObservedDate;
  return (
    <section className="jp-bank-rates" aria-label="Automated Japan bank observations">
      <div className="eyebrow">OFFICIAL BANK OBSERVATIONS</div>
      <h2>{sourcesOnly ? 'Automated collection sources' : 'Published bank rates'}</h2>
      <p>
        Daily collection at 10:43 JST / 09:43 SGT. Each bank’s publication month and last successful
        observation are shown separately.
      </p>
      <p className="calc-footnote">
        Selected public schedules, not a whole-market ranking. Applied and standard rates have
        different conditions. Fixed-period rates may reset; annual rates are not total borrowing
        costs. Confirm fees and insurance separately.
      </p>
      {error && (
        <p role="status">
          Published feed unavailable. Showing the bundled snapshot from {date(feed.generatedAt)};
          observation dates have not been renewed.
        </p>
      )}
      {!sourcesOnly && (
        <label className="field-label">
          Borrowing purpose
          <select
            aria-label="Japan borrowing purpose"
            className="jp-purpose"
            value={purpose}
            onChange={(e) => {
              setPurpose(e.target.value as JpPurpose);
              setSelected([]);
            }}
          >
            <option>Purchase</option>
            <option>Refinance</option>
          </select>
        </label>
      )}
      {!sourcesOnly && (
        <p id="jp-comparison-help" className="calc-footnote">
          Select 2–3 rows to compare terms. Changing borrowing purpose clears the selection.
          {comparison.length === JP_COMPARISON_LIMIT &&
            ' Selection full: remove a row to choose another.'}
        </p>
      )}
      {JP_SOURCES.map((source) => {
        const observation = feed.observations.find((o) => o.sourceId === source.id);
        const status = feed.sources.find((s) => s.sourceId === source.id);
        return (
          <article className="watch-card jp-bank-card" key={source.id}>
            <div className="eyebrow">{source.name}</div>
            <h3>{source.basis}</h3>
            {observation ? (
              <>
                <span className="story-status">{jpFreshness(observation, now)}</span>
                <p>
                  Publication: {observation.publicationMonth} · Observed{' '}
                  {date(observation.observedAt)}
                </p>
              </>
            ) : (
              <p>No validated rates collected yet.</p>
            )}
            {status && (
              <p className="calc-footnote">
                Last attempt {date(status.attemptedAt)} ·{' '}
                {status.status === 'ok'
                  ? 'Source read successfully'
                  : 'Source unavailable — previous observation retained'}
              </p>
            )}
            {status?.status === 'error' && (
              <details>
                <summary>Collection details</summary>
                <p>{status.message}</p>
              </details>
            )}
            {observation && !sourcesOnly && (
              <details open={source.id === 'jp-mufg'}>
                <summary>
                  {purpose} · {observation.rates.filter((r) => r.purpose === purpose).length}{' '}
                  published rates
                </summary>
                <div
                  className="jp-rate-table"
                  role="region"
                  aria-label={`${source.name} rate table`}
                  tabIndex={0}
                >
                  <table>
                    <caption>
                      {source.name} · {purpose} · {source.basis}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Compare</th>
                        <th scope="col">Rate type / period</th>
                        <th scope="col">Annual rate</th>
                        {source.id === 'jp-mufg' && <th scope="col">Reference rate</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {observation.rates
                        .filter((r) => r.purpose === purpose)
                        .map((r) => (
                          <tr key={r.id}>
                            <td>
                              <label className="compare-check jp-compare-check">
                                <input
                                  type="checkbox"
                                  aria-label={`Compare ${source.name} ${r.label} ${r.purpose}`}
                                  aria-describedby="jp-comparison-help"
                                  checked={selectedIds.includes(r.id)}
                                  disabled={
                                    comparison.length >= JP_COMPARISON_LIMIT &&
                                    !selectedIds.includes(r.id)
                                  }
                                  onChange={(e) =>
                                    setSelected(
                                      e.target.checked
                                        ? [...selectedIds, r.id].slice(0, JP_COMPARISON_LIMIT)
                                        : selectedIds.filter((id) => id !== r.id),
                                    )
                                  }
                                />
                              </label>
                            </td>
                            <th scope="row">
                              {r.kind}
                              {r.kind !== 'Variable' && <> · {r.term}</>}
                              <small lang="ja">{r.label}</small>
                            </th>
                            <td>{r.annualRate.toFixed(3)}%</td>
                            {source.id === 'jp-mufg' && (
                              <td>
                                {r.referenceRate === null ? '—' : `${r.referenceRate.toFixed(3)}%`}
                              </td>
                            )}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
            {source.id === 'jp-mufg' && (
              <p className="calc-footnote">
                Discounted rates have borrower, account and insurance requirements. Initial fixed
                rates apply only for the stated period. Read the current reset rules, fees and
                eligibility below.
              </p>
            )}
            {source.id === 'jp-smbc' && (
              <p className="calc-footnote">
                Standard schedule with guarantee fee included in the rate (保証料内枠方式).
                Individual discount plans are not collected. Do not compare this directly with
                MUFG’s applied rates.
              </p>
            )}
            {observation && (
              <details>
                <summary>Published conditions / ご利用条件</summary>
                <p className="jp-conditions" lang={source.id === 'jp-mufg' ? 'ja' : undefined}>
                  {observation.conditions}
                </p>
              </details>
            )}
            <a className="text-link" href={source.url} target="_blank" rel="noreferrer">
              Read {source.name} official rates{' '}
              <span className="sr-only">(opens in a new tab)</span> ↗
            </a>
          </article>
        );
      })}
      {!sourcesOnly && (
        <JapanComparison
          items={comparison}
          now={now}
          onRemove={(id) => setSelected(selectedIds.filter((selectedId) => selectedId !== id))}
          onClear={() => setSelected([])}
        />
      )}
    </section>
  );
}
