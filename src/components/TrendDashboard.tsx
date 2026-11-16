import { useEffect, useState } from 'react';
import {
  AnalyticsIndexSchema,
  SeriesSchema,
  chartSegments,
  comparable,
  filterPoints,
  rangeStart,
  ranges,
  type AnalyticsIndex,
  type Market,
  type ProductSummary,
  type TrendPoint,
  type TrendRange,
} from '@/lib/history';
import './trends.css';
const root = '/data/analytics/v1';
const fmt = (at: string | null) =>
  at
    ? new Date(at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'Not recorded';
const percent = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(3)}%`);
const basisLabel = {
  'published-rate': 'Published initial rate',
  'sora-spread': 'SORA spread only',
  'applied-rate': 'Applied rate',
  'standard-rate': 'Standard rate before discounts',
};
async function json(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw Error(`Historical data unavailable (${res.status})`);
  return res.json();
}
function Chart({
  series,
  onSelect,
}: {
  series: { product: ProductSummary; points: TrendPoint[] }[];
  onSelect: (p: TrendPoint) => void;
}) {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 640,
  );
  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const width = compact ? 400 : 800,
    left = compact ? 54 : 64,
    right = width - (compact ? 12 : 56);
  const all = series.flatMap((s) => s.points).filter((p) => p.value !== null);
  if (!all.length)
    return (
      <div className="trend-empty" role="status">
        No numeric observations in this window. Missing values are never filled.
      </div>
    );
  const times = all.map((p) => Date.parse(p.observedAt)),
    values = all.map((p) => p.value!);
  const minT = Math.min(...times),
    maxT = Math.max(...times),
    lo = Math.min(...values),
    hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.2, 0.05),
    minY = lo - pad,
    maxY = hi + pad;
  const x = (p: TrendPoint) =>
    maxT === minT
      ? width / 2
      : left + ((Date.parse(p.observedAt) - minT) / (maxT - minT)) * (right - left);
  const y = (v: number) => 250 - ((v - minY) / (maxY - minY)) * 210;
  return (
    <svg
      className="trend-chart"
      viewBox={`0 0 ${width} 300`}
      role="group"
      aria-label="Mortgage rate trend chart"
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const v = minY + ((maxY - minY) * i) / 4;
        return (
          <g key={i}>
            <line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="var(--border)" />
            <text x={left - 10} y={y(v) + 4} textAnchor="end">
              {v.toFixed(2)}%
            </text>
          </g>
        );
      })}
      <text x={left} y="284">
        {fmt(new Date(minT).toISOString())}
      </text>
      <text x={right} y="284" textAnchor="end">
        {fmt(new Date(maxT).toISOString())}
      </text>
      {series.map(({ product, points }, i) => (
        <g key={product.productId} className={i ? 'trend-secondary' : 'trend-primary'}>
          {chartSegments(points).map((segment, n) => (
            <polyline
              key={n}
              points={segment.map((p) => `${x(p)},${y(p.value!)}`).join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          ))}
          {points
            .filter((p) => p.value !== null)
            .map((p) => (
              <circle
                key={p.id}
                cx={x(p)}
                cy={y(p.value!)}
                r={compact ? 5 : 4}
                stroke="transparent"
                strokeWidth={compact ? 20 : 8}
                tabIndex={0}
                role="button"
                aria-label={`${product.name}, ${p.observedAt}, ${percent(p.value)}`}
                onMouseEnter={() => onSelect(p)}
                onFocus={() => onSelect(p)}
                onClick={() => onSelect(p)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(p);
                  }
                }}
                fill="currentColor"
              >
                <title>
                  {product.name}: {percent(p.value)} · {p.observedAt}
                </title>
              </circle>
            ))}
        </g>
      ))}
    </svg>
  );
}
export default function TrendDashboard({
  market,
  onMarket,
}: {
  market: Market;
  onMarket: (m: string) => void;
}) {
  const [index, setIndex] = useState<AnalyticsIndex>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [bank, setBank] = useState('All banks');
  const [productId, setProductId] = useState('');
  const [compareId, setCompareId] = useState('');
  const [range, setRange] = useState<TrendRange>('1M');
  const [series, setSeries] = useState<{ product: ProductSummary; points: TrendPoint[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [point, setPoint] = useState<TrendPoint>();
  const [seriesError, setSeriesError] = useState('');
  const [now] = useState(Date.now);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setIndex(undefined);
    json(`${root}/${market}/index.json`, controller.signal)
      .then((raw) => {
        const data = AnalyticsIndexSchema.parse(raw);
        if (data.market !== market) throw Error('Historical market mismatch');
        setIndex(data);
        setProductId(data.products[0]?.productId ?? '');
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [market, retry]);
  const selected = index?.products.find((p) => p.productId === productId);
  const comparison = index?.products.find(
    (p) => p.productId === compareId && selected && comparable(p, selected),
  );
  useEffect(() => {
    const controller = new AbortController();
    setSeries([]);
    setPoint(undefined);
    setSeriesError('');
    if (!selected) return () => controller.abort();
    setLoading(true);
    Promise.all(
      [selected, ...(comparison ? [comparison] : [])].map(async (product) => {
        const firstYear = range === 'All' ? 0 : new Date(rangeStart(range, now)).getUTCFullYear();
        const years = product.years.filter(
          (y) => y >= firstYear && y <= new Date(now).getUTCFullYear(),
        );
        const shards = await Promise.all(
          years.map(async (year) => {
            const s = SeriesSchema.parse(
              await json(`${root}/${market}/${product.productId}/${year}.json`, controller.signal),
            );
            if (s.market !== market || s.productId !== product.productId || s.year !== year)
              throw Error('Historical series mismatch');
            return s;
          }),
        );
        const points = filterPoints(
          shards.flatMap((s) => s.points),
          range,
          now,
        ).map((p) => (p.comparisonKey === product.comparisonKey ? p : { ...p, value: null }));
        return { product, points };
      }),
    )
      .then((s) => {
        if (!controller.signal.aborted) {
          setSeries(s);
          setPoint(s[0]?.points.at(-1));
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setSeriesError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selected, comparison, range, market, now, retry]);
  const products = index?.products.filter((p) => bank === 'All banks' || p.bank === bank) ?? [];
  const pointProduct = series.find((s) => s.points.some((p) => p.id === point?.id))?.product;
  return (
    <section className="trends" aria-labelledby="trends-title">
      <header className="trends-heading">
        <div>
          <span className="eyebrow">THE PUBLIC RECORD</span>
          <h1 id="trends-title">
            Mortgage rate trends<span>.</span>
          </h1>
          <p>Follow the observations. See what changed.</p>
        </div>
        <label>
          Trend market
          <select
            aria-label="Trend market"
            value={market}
            onChange={(e) => onMarket(e.target.value)}
          >
            <option>SG</option>
            <option>JP</option>
          </select>
        </label>
      </header>
      {error ? (
        <div role="alert" className="trend-empty">
          {error} <button onClick={() => setRetry((r) => r + 1)}>Retry historical data</button>
        </div>
      ) : !index ? (
        <p role="status">Loading historical coverage…</p>
      ) : (
        <>
          <div className="trend-stats">
            <div>
              <span>Public record begins</span>
              <strong>{fmt(index.firstObservedAt)}</strong>
            </div>
            <div>
              <span>Successful observations</span>
              <strong>
                {index.products.reduce((n, p) => n + p.observations, 0).toLocaleString()}
              </strong>
            </div>
            <div>
              <span>Last successful collection</span>
              <strong>{fmt(index.lastSuccessfulCollection)}</strong>
            </div>
          </div>
          {!index.products.length ? (
            <div role="status" className="trend-empty">
              No historical products yet.
            </div>
          ) : (
            <article className="trend-panel">
              <div className="trend-controls">
                <label>
                  Trend bank
                  <select
                    aria-label="Trend bank"
                    value={bank}
                    onChange={(e) => {
                      setBank(e.target.value);
                      setCompareId('');
                      setProductId(
                        index.products.find(
                          (p) => e.target.value === 'All banks' || p.bank === e.target.value,
                        )?.productId ?? '',
                      );
                    }}
                  >
                    <option>All banks</option>
                    {[...new Set(index.products.map((p) => p.bank))].map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Trend product
                  <select
                    aria-label="Trend product"
                    value={productId}
                    onChange={(e) => {
                      setProductId(e.target.value);
                      setCompareId('');
                    }}
                  >
                    {products.map((p) => (
                      <option key={p.productId} value={p.productId}>
                        {p.bank} · {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Compare matching basis
                  <select
                    aria-label="Compare matching basis"
                    value={compareId}
                    onChange={(e) => setCompareId(e.target.value)}
                  >
                    <option value="">Single product</option>
                    {index.products
                      .filter(
                        (p) => selected && p.productId !== productId && comparable(p, selected),
                      )
                      .map((p) => (
                        <option key={p.productId} value={p.productId}>
                          {p.bank} · {p.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="trend-chart-heading">
                <div>
                  <h2>{selected?.name}</h2>
                  <p>
                    {selected && basisLabel[selected.basis]} · {selected?.rateType}
                  </p>
                </div>
                <div className="trend-ranges" aria-label="Trend date range">
                  {ranges.map((r) => (
                    <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <p className="trend-note">
                {selected?.basis === 'sora-spread'
                  ? 'Spread only: this excludes the SORA fixing and is not an all-in mortgage rate.'
                  : 'Published pricing, subject to lender eligibility and terms.'}{' '}
                {market === 'JP' &&
                  'Applied and standard rates are kept separate; publication month does not establish an effective date.'}
              </p>
              {loading ? (
                <div role="status" className="trend-empty">
                  Loading observations…
                </div>
              ) : seriesError ? (
                <div role="alert" className="trend-empty">
                  {seriesError} <button onClick={() => setRetry((r) => r + 1)}>Retry series</button>
                </div>
              ) : (
                <Chart series={series} onSelect={setPoint} />
              )}
              <div className="trend-legend">
                {series.map((s, i) => (
                  <span
                    key={s.product.productId}
                    className={i ? 'trend-secondary' : 'trend-primary'}
                  >
                    ● {s.product.bank} · {s.product.name}
                  </span>
                ))}
              </div>
              <div className="trend-point" aria-live="polite">
                {point ? (
                  <>
                    <strong>{percent(point.value)}</strong>
                    <span>
                      {pointProduct?.bank} · {pointProduct?.name}
                    </span>
                    <span>
                      Observed {point.observedAt} · {point.method}
                    </span>
                    <a href={point.evidenceUrl} target="_blank" rel="noreferrer">
                      Official source ↗
                    </a>
                    {point.provenance.runUrl && (
                      <a href={point.provenance.runUrl} target="_blank" rel="noreferrer">
                        Collection run ↗
                      </a>
                    )}
                    {point.provenance.commit && (
                      <a
                        href={`https://github.com/jasonjiang8866/ratepro/blob/${point.provenance.commit}/${point.provenance.feedPath}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Git evidence ↗
                      </a>
                    )}
                    <a
                      href={`/data/history/v1/${market}/product-version/${point.productVersionId}.jsonl`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Published terms ↗
                    </a>
                    <span>
                      {point.provenance.mode === 'git-backfill'
                        ? 'Recovered from Git history'
                        : 'Recorded snapshot'}{' '}
                      · effective period {point.effectiveFrom ?? 'unknown'} →{' '}
                      {point.effectiveUntil ?? 'unknown'}
                    </span>
                  </>
                ) : (
                  <span>Hover, tap or focus an observation to inspect its evidence.</span>
                )}
              </div>
              <div className="trend-numbers">
                <div>
                  Historical low<strong>{percent(selected?.min)}</strong>
                </div>
                <div>
                  Historical high<strong>{percent(selected?.max)}</strong>
                </div>
                <div>
                  Latest observed<strong>{percent(selected?.latest)}</strong>
                </div>
                <div>
                  Observed span<strong>{Math.floor(selected?.durationDays ?? 0)} days</strong>
                </div>
              </div>
              <p className="trend-note">
                Statistics cover all stored observations on the current pricing basis. Lines break
                across missing daily observations; gaps are not zero. These are observation dates,
                not bank repricing dates.
              </p>
            </article>
          )}
          <section aria-labelledby="movement-title">
            <h2 id="movement-title">Rate movement summary</h2>
            <div className="trend-movements">
              {(['rate-up', 'rate-down', 'terms-change'] as const).map((kind) => (
                <article key={kind}>
                  <h3>
                    {kind === 'rate-up'
                      ? '↗ Recently higher'
                      : kind === 'rate-down'
                        ? '↘ Recently lower'
                        : '≋ Terms updated'}
                  </h3>
                  {index.recentEvents
                    .filter((e) => e.kind === kind)
                    .slice(0, 3)
                    .map((e) => (
                      <p key={e.id}>
                        <strong>
                          {index.products.find((p) => p.productId === e.productId)?.name ??
                            e.productId}
                        </strong>
                        <span>
                          {fmt(e.at)}
                          {e.delta !== null
                            ? ` · ${e.delta > 0 ? '+' : ''}${e.delta.toFixed(3)} percentage points`
                            : ''}
                        </span>
                      </p>
                    ))}
                  {!index.recentEvents.some((e) => e.kind === kind) && (
                    <p>No recorded changes in the retained event summary.</p>
                  )}
                </article>
              ))}
            </div>
          </section>
          <section className="trend-panel" aria-labelledby="coverage-title">
            <h2 id="coverage-title">Data coverage</h2>
            <p className="trend-note">
              Success rate counts recorded source attempts, not calendar days or product rows. Older
              all-source failures may be absent from Git; no historical attempt is invented.
            </p>
            <div className="trend-coverage">
              {index.sources.map((s) => (
                <article key={s.sourceId}>
                  <h3>{s.sourceId}</h3>
                  <strong>
                    {s.observations.toLocaleString()} <small>observations</small>
                  </strong>
                  <meter
                    aria-label={`${s.sourceId} collection success`}
                    min="0"
                    max="1"
                    value={s.successRate ?? 0}
                  />
                  <span>
                    {s.successRate === null
                      ? 'No attempts'
                      : `${Math.round(s.successRate * 100)}% successful · ${s.successes}/${s.attempts} attempts`}
                  </span>
                  <span>Last success: {fmt(s.lastSuccess)}</span>
                </article>
              ))}
            </div>
            <details>
              <summary>Product tracking & missing data</summary>
              <ul className="trend-tracking">
                {index.products.map((p) => (
                  <li key={p.productId}>
                    <strong>
                      {p.bank} · {p.name}
                    </strong>
                    <span>
                      First: {fmt(p.firstObservedAt)} · latest: {fmt(p.lastObservedAt)} ·{' '}
                      {p.observations} observations
                    </span>
                    <span>
                      {!p.tracked
                        ? 'No longer in RatePro feed'
                        : p.effectiveUntil &&
                            p.effectiveUntil < new Date(now).toISOString().slice(0, 10)
                          ? 'Published period ended'
                          : now - Date.parse(p.lastObservedAt) > 48 * 3600000
                            ? 'Observation overdue / missing recent data'
                            : 'Currently tracked'}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </section>
          <p className="trend-note">
            Generated {index.generatedAt}. Public observations are independent of your browser
            history. Only supported products are tracked; disappearance from this feed is not proof
            of bank withdrawal.
          </p>
        </>
      )}
    </section>
  );
}
