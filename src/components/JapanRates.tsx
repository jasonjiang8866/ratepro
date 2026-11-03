import { useEffect, useState } from 'react';
import published from '../../public/data/rates-jp.json';
import { JP_SOURCES, JpFeedSchema, jpFreshness, type JpFeed } from '../lib/japan-rates';
import { fetchText } from '../lib/sync';
import { JapanComparison, japanObservedDate } from './JapanComparison';
import { japanComparisonItems, JP_COMPARISON_LIMIT, type JpPurpose } from '../lib/japan-comparison';
import { RateStructure } from './MortgageVisuals';

export function JapanRates({ now, sourcesOnly = false }: { now: Date; sourcesOnly?: boolean }) {
  const [feed, setFeed] = useState<JpFeed>(() => JpFeedSchema.parse(published));
  const [error, setError] = useState(false);
  const [purpose, setPurpose] = useState<JpPurpose>('Purchase');
  const [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState<'All' | 'Variable' | 'Initial fixed' | 'Full-term fixed'>('All');
  const [tableView, setTableView] = useState(false);
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
      <p className="visual-source-line">
        Daily at 10:43 JST / 09:43 SGT · Selected official sources
      </p>
      {!sourcesOnly && (
        <div className="rate-kind-picker" role="group" aria-label="Filter by rate structure">
          {(['Variable', 'Initial fixed', 'Full-term fixed'] as const).map((type) => (
            <button
              key={type}
              type="button"
              aria-label={`${type} rates`}
              aria-pressed={kind === type}
              onClick={() => {
                setKind(kind === type ? 'All' : type);
                setSelected([]);
              }}
            >
              <span>{type}</span>
              <RateStructure kind={type} />
            </button>
          ))}
          <div className="structure-picker-note">
            <span>Structure illustrations · not rate forecasts</span>
            <button
              type="button"
              aria-pressed={kind === 'All'}
              onClick={() => {
                setKind('All');
                setSelected([]);
              }}
            >
              Show all types
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="status">
          Published feed unavailable. Showing the bundled snapshot from {date(feed.generatedAt)};
          observation dates have not been renewed.
        </p>
      )}
      {!sourcesOnly && (
        <div className="rate-view-toolbar">
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
          <div className="rate-view-toggle" role="group" aria-label="Rate display">
            <button type="button" aria-pressed={!tableView} onClick={() => setTableView(false)}>
              Cards
            </button>
            <button type="button" aria-pressed={tableView} onClick={() => setTableView(true)}>
              Table
            </button>
          </div>
        </div>
      )}
      {!sourcesOnly && (
        <p id="jp-comparison-help" className="calc-footnote">
          Select 2–3 rates to compare. Changing purpose or rate-type filters clears the selection.
          {comparison.length === JP_COMPARISON_LIMIT &&
            ' Selection full: remove a row to choose another.'}
        </p>
      )}
      {JP_SOURCES.map((source) => {
        const observation = feed.observations.find((o) => o.sourceId === source.id);
        const status = feed.sources.find((s) => s.sourceId === source.id);
        const visibleRates =
          observation?.rates.filter(
            (r) => r.purpose === purpose && (kind === 'All' || r.kind === kind),
          ) ?? [];
        return (
          <article className="watch-card jp-bank-card" key={source.id}>
            <div className="visual-bank-heading">
              <span className="bank-seal" aria-hidden="true">
                {source.id === 'jp-mufg' ? 'M' : 'S'}
              </span>
              <div>
                <div className="eyebrow">{source.name}</div>
                <h3>{source.basis}</h3>
              </div>
            </div>
            {observation ? (
              <>
                <span className="observation-pill">{jpFreshness(observation, now)}</span>
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
                  {purpose} · {visibleRates.length} published rates
                </summary>
                {!visibleRates.length && (
                  <p>No published rates match this type and borrowing purpose.</p>
                )}
                {!tableView ? (
                  <div className="visual-rate-grid">
                    {visibleRates.map((r) => (
                      <label
                        className="visual-rate-card"
                        data-selected={selectedIds.includes(r.id)}
                        key={r.id}
                      >
                        <span className="visual-rate-kind">
                          {r.kind}
                          {r.kind !== 'Variable' && <> · {r.term}</>}
                        </span>
                        <span className="visual-rate-number">
                          {r.annualRate.toFixed(3)}
                          <small>%</small>
                        </span>
                        <span className="visual-rate-basis">
                          {source.id === 'jp-mufg'
                            ? 'Applied annual rate'
                            : 'Standard annual rate · before discounts'}
                        </span>
                        <span className="visual-rate-label" lang="ja">
                          {r.label}
                        </span>
                        <span className="visual-rate-reference">
                          {r.referenceRate !== null
                            ? `Reference ${r.referenceRate.toFixed(3)}%`
                            : 'Reference rate not collected'}
                        </span>
                        <span className="visual-rate-select">
                          <span>
                            {selectedIds.includes(r.id) ? 'Selected' : 'Add to comparison'}
                          </span>
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
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
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
                        {visibleRates.map((r) => (
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
                )}
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
