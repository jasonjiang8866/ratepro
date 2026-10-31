import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronRight,
  CircleHelp,
  Database,
  ExternalLink,
  History,
  House,
  Leaf,
  Moon,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  WifiOff,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  CACHE_KEY,
  mergeFeed,
  mergeCheckEvidence,
  parseImport,
  payment,
  readCache,
  saveCache,
  stageDisplay,
  compareInitialRates,
  matchesProperty,
  offerPayment,
} from '@/lib/data';
import {
  CacheSchema,
  SOURCES,
  REFERENCE_SOURCES,
  banks,
  emptyCache,
  isStale,
  observationAge,
  freshnessWarning,
  sourceFor,
  type Cache,
  type Offer,
} from '@/lib/schema';
import { synchronize } from '@/lib/sync';
import { cn } from '@/lib/utils';
const money = (n: number) =>
  new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    maximumFractionDigits: 0,
  }).format(n);
const date = (s: string) =>
  new Intl.DateTimeFormat('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Singapore',
  }).format(new Date(s));
const timestamp = (s?: string) =>
  s
    ? `${new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }).format(new Date(s))} SGT`
    : 'Not recorded';
function initial() {
  try {
    return readCache(window.localStorage);
  } catch {
    return {
      cache: emptyCache(),
      warning: 'Browser storage unavailable. Rates will only be kept for this session.',
    };
  }
}
function getPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('ratepro.preferences') ?? '{}');
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}
function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="filter-label">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
export default function App() {
  const [loaded] = useState(initial);
  const [cache, setCache] = useState<Cache>(loaded.cache);
  const current = useRef(cache);
  const running = useRef(false);
  const [warning, setWarning] = useState(loaded.warning ?? '');
  const [message, setMessage] = useState('Checking for published updates…');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const [tab, setTab] = useState('Rates');
  const [query, setQuery] = useState('');
  const [property, setProperty] = useState('All properties');
  const [kind, setKind] = useState('All rates');
  const [purpose, setPurpose] = useState('All purposes');
  const [construction, setConstruction] = useState('All stages');
  const [bank, setBank] = useState('All lenders');
  const [savedOnly, setSavedOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [sort, setSort] = useState('Rate: low to high');
  const [prefs] = useState(getPrefs);
  const [saved, setSaved] = useState<string[]>(
    Array.isArray(prefs.saved) ? prefs.saved.filter((x: unknown) => typeof x === 'string') : [],
  );
  const [dark, setDark] = useState(
    prefs.theme === 'dark' ||
      (!prefs.theme && window.matchMedia('(prefers-color-scheme: dark)').matches),
  );
  const [principal, setPrincipal] = useState('500000');
  const [years, setYears] = useState('25');
  const [calcRate, setCalcRate] = useState('2.6');
  const file = useRef<HTMLInputElement>(null);
  function persist(next: Cache) {
    current.current = next;
    setCache(next);
    try {
      const w = saveCache(localStorage, next);
      if (w) setWarning(w);
    } catch {
      setWarning('Browser storage unavailable. Changes are session-only.');
    }
  }
  async function refresh(force = false) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const commitRefresh = (updated: Cache) => {
        const merged = mergeFeed(current.current, {
          version: 1,
          generatedAt: new Date().toISOString(),
          offers: updated.offers,
          sources: updated.sources,
        });
        persist(mergeCheckEvidence(merged, updated));
      };
      const result = await synchronize(current.current, force, fetch, commitRefresh);
      commitRefresh(result.cache);
      setMessage(result.message);
    } catch {
      setMessage('Refresh failed. Your previous observations are safe.');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    const tick = window.setInterval(() => setClock(Date.now()), 60000);
    return () => window.clearInterval(tick);
  }, []);
  useEffect(() => {
    void refresh();
    const online = () => void refresh(true);
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem(
        'ratepro.preferences',
        JSON.stringify({ saved, theme: dark ? 'dark' : 'light' }),
      );
    } catch {
      setWarning('Browser preferences cannot be saved.');
    }
  }, [dark, saved]);
  useEffect(() => {
    function changed(e: StorageEvent) {
      if (e.key !== CACHE_KEY || !e.newValue) return;
      try {
        const incoming = CacheSchema.parse(JSON.parse(e.newValue));
        const next = mergeFeed(current.current, {
          version: 1,
          generatedAt: new Date().toISOString(),
          offers: incoming.offers,
          sources: incoming.sources,
        });
        const withEvidence = mergeCheckEvidence(next, incoming);
        current.current = withEvidence;
        setCache(withEvidence);
      } catch {
        /* Ignore invalid data written by another tab. */
      }
    }
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  const offers = cache.offers
    .filter(
      (o) =>
        matchesProperty(o, property) &&
        (kind === 'All rates' || o.kind === kind) &&
        (purpose === 'All purposes' || o.purpose.includes(purpose as 'Purchase' | 'Refinance')) &&
        (construction === 'All stages' ||
          o.construction === 'Any' ||
          o.construction === construction) &&
        (bank === 'All lenders' || o.bank === bank) &&
        (!savedOnly || saved.includes(o.id)) &&
        `${o.bank} ${o.name} ${o.terms}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'Latest observation'
        ? Date.parse(b.observedAt) - Date.parse(a.observedAt)
        : compareInitialRates(a, b, sort === 'Rate: high to low'),
    );
  const comparison = cache.offers.filter((o) => selected.includes(o.id));
  const monthly = payment(Number(principal), Number(calcRate), Number(years));
  const validCalc =
    Number(principal) > 0 &&
    Number(principal) <= 100000000 &&
    Number(years) >= 1 &&
    Number(years) <= 35 &&
    Number(calcRate) >= 0 &&
    Number(calcRate) <= 30 &&
    calcRate !== '';
  const lastObserved = cache.offers
    .map((o) => o.observedAt)
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(-1);
  function exportData() {
    const blob = new Blob([JSON.stringify(current.current, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ratepro-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(
      'Exported your observations and history. Share the JSON file to compare the same data.',
    );
  }
  async function importData(f: File | undefined) {
    if (!f) return;
    try {
      if (f.size > 2000000) throw Error('Maximum file size is 2 MB.');
      const feed = parseImport(await f.text());
      persist(mergeFeed(current.current, feed));
      setMessage(
        'Imported observations; newer local records were preserved. Imported dates are supplied by the file author.',
      );
    } catch {
      setMessage(
        'Import rejected. Use a valid RatePro JSON export under 2 MB. Your data is unchanged.',
      );
    }
    if (file.current) file.current.value = '';
  }
  function resetFilters() {
    setProperty('All properties');
    setKind('All rates');
    setPurpose('All purposes');
    setConstruction('All stages');
    setBank('All lenders');
    setQuery('');
    setSavedOnly(false);
  }
  return (
    <div className="min-h-screen">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <div className="shell flex h-20 items-center justify-between gap-3">
          <a href="#" className="brand" aria-label="RatePro home" onClick={() => setTab('Rates')}>
            <span className="brand-icon">
              <House size={21} />
            </span>
            ratepro<span className="brand-sg">SG</span>
          </a>
          <div className="flex items-center gap-2">
            <span className="local-pill hidden sm:flex">
              <span />
              Your browser. Your data.
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={dark ? 'Use light theme' : 'Use dark theme'}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="shell pb-14">
        <section className="hero">
          <div>
            <div className="eyebrow">
              <span /> INDEPENDENT · PUBLICLY SOURCED
            </div>
            <h1>
              A clearer view of
              <br />
              your next home loan<span>.</span>
            </h1>
            <p>
              Explore Singapore’s published mortgage rates.
              <br className="hidden sm:block" /> Keep the sources, compare the terms, track what
              changes.
            </p>
            <div className="hero-actions">
              <Button onClick={() => void refresh(true)} disabled={busy}>
                <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
                {busy ? 'Checking sources…' : 'Refresh rates'}
              </Button>
              <span className="text-xs text-muted-foreground">No account. No sales calls.</span>
            </div>
          </div>
          <div className="hero-note">
            <div className="flex items-center justify-between">
              <span className="eyebrow">THE LOCAL-FIRST APPROACH</span>
              <ShieldCheck className="size-5" />
            </div>
            <h2>
              Useful information.
              <br />
              Without the lead form.
            </h2>
            <p>
              Public observations stay in your browser. Export a copy to share, and come back to see
              what has changed.
            </p>
            <div className="hero-note-bottom">
              <Database size={15} /> Browser saved <span>↗ Open sources</span>
            </div>
          </div>
        </section>
        <div className="metrics">
          <div>
            <span>Published observations</span>
            <strong>
              {cache.offers.length.toString().padStart(2, '0')}
              <small>packages in this directory</small>
            </strong>
          </div>
          <div>
            <span>Source coverage</span>
            <strong>
              {SOURCES.length.toString().padStart(2, '0')}
              <small>official sources monitored</small>
            </strong>
          </div>
          <div>
            <span>Latest observation</span>
            <strong className="metric-date">
              {lastObserved ? date(lastObserved) : 'Awaiting data'}
              <small>not a personalised bank quote</small>
            </strong>
          </div>
        </div>
        <div className="sync-bar" role="status" aria-live="polite">
          {busy ? (
            <RefreshCw className="size-4 animate-spin shrink-0" />
          ) : (
            <Database className="size-4 shrink-0" />
          )}
          <span>{message}</span>
          <button
            onClick={() => setTab('Sources')}
            className="ml-auto shrink-0 underline underline-offset-4"
          >
            Source details
          </button>
        </div>
        {cache.offers.length > 0 && (
          <p className="my-4 text-sm text-muted-foreground">
            {cache.offers.filter((o) => o.method === 'reviewed').length} manually reviewed snapshots
            {' · '}
            {cache.offers.filter((o) => isStale(o, clock)).length} observations need rechecking.{' '}
            Observations older than 7 days or past their published period are flagged. Downloading a
            snapshot does not renew its observation dates.
          </p>
        )}
        {warning && (
          <div className="notice" role="alert">
            <WifiOff size={16} />
            {warning}
          </div>
        )}
        <div className="section-nav">
          <div className="flex gap-1" aria-label="Views">
            {['Rates', 'Sources', 'History'].map((t) => (
              <button
                key={t}
                aria-current={tab === t ? 'page' : undefined}
                className={cn('nav-item', tab === t && 'active')}
                onClick={() => setTab(t)}
              >
                {t === 'Rates' ? (
                  <SlidersHorizontal size={15} />
                ) : t === 'Sources' ? (
                  <ExternalLink size={15} />
                ) : (
                  <History size={15} />
                )}{' '}
                {t}
                {t === 'History' && cache.history.length > 0 && (
                  <span className="count">{cache.history.length}</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="Import rate observations"
              onChange={(e) => void importData(e.target.files?.[0])}
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label="Import observations"
              onClick={() => file.current?.click()}
            >
              <ArrowUpFromLine size={14} />
              <span className="hidden sm:inline">Import</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Export observations"
              onClick={exportData}
              disabled={!cache.offers.length}
            >
              <ArrowDownToLine size={14} />
              <span className="hidden sm:inline">Export</span>
            </Button>
          </div>
        </div>
        {tab === 'Rates' && (
          <div className="workspace">
            <section className="min-w-0">
              <div className="section-heading">
                <div>
                  <h2>Find your starting point</h2>
                  <p>Advertised rates, with the context that matters.</p>
                </div>
              </div>
              <div className="filters">
                <div className="search-box">
                  <Search size={16} />
                  <Input
                    aria-label="Search lenders or packages"
                    placeholder="Search lenders or packages"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="filter-grid">
                  <Select
                    label="Property"
                    value={property}
                    onChange={setProperty}
                    options={['All properties', 'HDB', 'Private']}
                  />
                  <Select
                    label="Rate type"
                    value={kind}
                    onChange={setKind}
                    options={['All rates', 'Fixed', 'Floating', 'Concessionary']}
                  />
                  <Select
                    label="Purpose"
                    value={purpose}
                    onChange={setPurpose}
                    options={['All purposes', 'Purchase', 'Refinance']}
                  />
                  <Select
                    label="Lender"
                    value={bank}
                    onChange={setBank}
                    options={['All lenders', ...banks]}
                  />
                  <Select
                    label="Property stage"
                    value={construction}
                    onChange={setConstruction}
                    options={['All stages', 'Completed', 'Under construction']}
                  />
                </div>
              </div>
              <div className="results-toolbar">
                <span>
                  {offers.length} observation{offers.length !== 1 ? 's' : ''}
                </span>
                <button
                  aria-pressed={savedOnly}
                  className={cn('saved-toggle', savedOnly && 'text-primary')}
                  onClick={() => setSavedOnly(!savedOnly)}
                >
                  <Bookmark size={14} fill={savedOnly ? 'currentColor' : 'none'} /> Saved
                </button>
                <select
                  aria-label="Sort rates"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  {['Rate: low to high', 'Rate: high to low', 'Latest observation'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-4">
                {offers.map((o) => (
                  <Card key={o.id} className="offer-card">
                    <CardContent className="p-5 sm:p-6">
                      <div className="flex items-start gap-3">
                        <div className={cn('bank-mark', o.bank === 'HDB' ? 'hdb' : 'dbs')}>
                          {o.bank === 'HDB' ? (
                            <House size={22} />
                          ) : o.bank === 'Standard Chartered' ? (
                            'SC'
                          ) : o.bank === 'Maybank' ? (
                            'MYB'
                          ) : (
                            o.bank
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap gap-2 items-center">
                            <h3>{o.name}</h3>
                            {o.id === 'dbs-green-fhr6' && (
                              <Leaf size={15} className="text-primary" />
                            )}
                          </div>
                          <p className="offer-subtitle">
                            {o.bank} · {o.property} · {o.construction}
                          </p>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`${saved.includes(o.id) ? 'Unsave' : 'Save'} ${o.name}`}
                          onClick={() =>
                            setSaved((s) =>
                              s.includes(o.id) ? s.filter((i) => i !== o.id) : [...s, o.id],
                            )
                          }
                        >
                          <Bookmark
                            size={18}
                            fill={saved.includes(o.id) ? 'currentColor' : 'none'}
                          />
                        </Button>
                      </div>
                      <div className="offer-main">
                        <div>
                          {o.stages[0].rate === null ? (
                            <div className="text-xl font-semibold break-words">
                              {o.stages[0].formula}
                            </div>
                          ) : (
                            <div className="rate">
                              {o.stages[0].rate.toFixed(2)}
                              <span>%</span>
                              <small>p.a.</small>
                            </div>
                          )}
                          <p className="rate-caption">
                            {o.stages[0].label} ·{' '}
                            {o.stages[0].rate === null
                              ? 'Formula only · all-in rate not calculated'
                              : 'observed rate'}
                          </p>
                        </div>
                        <div className="offer-facts">
                          <div>
                            <span>Rate type</span>
                            <strong>{o.kind}</strong>
                          </div>
                          <div>
                            <span>Commitment</span>
                            <strong>
                              {o.lockYears === null ? 'Check source' : `${o.lockYears} years`}
                            </strong>
                          </div>
                          <div>
                            <span>Minimum loan</span>
                            <strong>
                              {o.minLoan === null ? 'Check source' : money(o.minLoan)}
                            </strong>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{o.stages[0].formula}</Badge>
                        <Badge variant="outline" className={isStale(o, clock) ? 'stale' : ''}>
                          {isStale(o, clock) ? 'Needs recheck · ' : ''}
                          {o.method === 'reviewed'
                            ? 'Reviewed snapshot'
                            : o.method === 'imported'
                              ? 'Shared snapshot · unverified'
                              : 'Source observation'}{' '}
                          · {date(o.observedAt)}
                        </Badge>
                      </div>
                      <p className="text-sm mt-3 text-muted-foreground">
                        {observationAge(o, clock)} · {timestamp(o.observedAt)}
                      </p>
                      {freshnessWarning(o, clock) && (
                        <p className="text-sm mt-2 font-medium">{freshnessWarning(o, clock)}</p>
                      )}
                      {o.method === 'reviewed' && (
                        <p className="text-sm mt-2 text-muted-foreground">
                          Manually reviewed snapshot. Automated refresh is not guaranteed.
                        </p>
                      )}
                      {o.customerTier && (
                        <div className="text-sm mt-3 space-y-1">
                          <p>
                            Customer tier: <strong>{o.customerTier}</strong>
                            {o.minRelationshipBalance !== undefined &&
                              ` · relationship balance at least ${money(o.minRelationshipBalance)}`}
                          </p>
                          <p>
                            Loan band: {money(o.minLoan!)}
                            {o.maxLoanExclusive
                              ? ` to below ${money(o.maxLoanExclusive)}`
                              : ' and above'}
                            .
                          </p>
                          <p>
                            SORA effective-rate floor: {o.rateFloor?.toFixed(2)}%. Property type and
                            loan purpose: confirm with lender.
                          </p>
                          <p>
                            Document printed: {o.documentDate && date(o.documentDate)} · separate
                            from observation date.
                          </p>
                        </div>
                      )}
                      {o.effectiveFrom && (
                        <p className="text-sm mt-3">
                          Source terms effective from {date(o.effectiveFrom)}. Confirm current
                          availability.
                        </p>
                      )}
                      <details className="offer-details">
                        <summary>
                          Rate schedule & conditions <ChevronRight size={14} />
                        </summary>
                        <div className="schedule">
                          {o.stages.map((s, i) => (
                            <div key={i}>
                              <span>{s.label}</span>
                              <strong>
                                {stageDisplay(s)} {s.rate !== null && <small>{s.formula}</small>}
                              </strong>
                            </div>
                          ))}
                        </div>
                        <p>{o.terms}</p>
                        {o.effectiveUntil && <p>Published period ends {date(o.effectiveUntil)}.</p>}
                        <p>
                          Observed{' '}
                          {new Date(o.observedAt).toLocaleString('en-SG', {
                            timeZone: 'Asia/Singapore',
                          })}{' '}
                          SGT. Future variable rates are not guaranteed.
                        </p>
                      </details>
                      <div className="offer-footer">
                        <label className="compare-check">
                          <input
                            type="checkbox"
                            checked={selected.includes(o.id)}
                            disabled={!selected.includes(o.id) && selected.length >= 3}
                            onChange={() =>
                              setSelected((s) =>
                                s.includes(o.id) ? s.filter((i) => i !== o.id) : [...s, o.id],
                              )
                            }
                          />
                          Compare
                        </label>
                        <a href={sourceFor(o.sourceId).url} target="_blank" rel="noreferrer">
                          View official source <ArrowUpRight size={15} />
                        </a>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {!offers.length && (
                <div className="empty-state">
                  <Search size={25} />
                  <h3>{busy ? 'Collecting public observations…' : 'No matching observations'}</h3>
                  <p>
                    {cache.offers.length
                      ? 'Try another filter. This is a focused directory, not the whole mortgage market.'
                      : 'No published data available yet. Refresh when online or import a shared export.'}
                  </p>
                  <Button variant="outline" onClick={resetFilters}>
                    Reset filters
                  </Button>
                </div>
              )}
              <p className="coverage-note">
                Selected published packages from DBS, Maybank, Standard Chartered, UOB, Citi and
                HDB. Formula-only packages appear after numerical rates in both rate sorts; a spread
                is not an all-in rate. These public schedules may differ from personalised offers.
                Missing lenders or packages do not mean they are unavailable. See Sources for
                quote-only options.
              </p>
            </section>
            <aside className="sidebar">
              <Card className="calculator">
                <CardContent className="p-6">
                  <div className="eyebrow">PLAN THE MONTHLY PAYMENT</div>
                  <h2>Make the numbers real.</h2>
                  <p>A simple repayment estimate.</p>
                  <label className="field-label" htmlFor="loan">
                    Loan amount (S$)
                  </label>
                  <Input
                    id="loan"
                    type="number"
                    min="1"
                    max="100000000"
                    value={principal}
                    onChange={(e) => setPrincipal(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="field-label" htmlFor="tenure">
                        Tenure (years)
                      </label>
                      <Input
                        id="tenure"
                        type="number"
                        min="1"
                        max="35"
                        value={years}
                        onChange={(e) => setYears(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="rate">
                        Annual rate (%)
                      </label>
                      <Input
                        id="rate"
                        type="number"
                        min="0"
                        max="30"
                        step="0.01"
                        value={calcRate}
                        onChange={(e) => setCalcRate(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="payment">
                    <span>Estimated monthly payment</span>
                    <strong>
                      {validCalc && monthly !== null ? money(monthly) : '—'}
                      <small>/ month</small>
                    </strong>
                  </div>
                  {!validCalc && (
                    <p role="alert">Enter a positive loan, 1–35 years and a rate of 0–30%.</p>
                  )}
                  <p className="calc-footnote">
                    Assumes a fully drawn, amortising loan and a constant rate for the whole tenure.
                    Excludes fees, CPF effects and eligibility checks. Not a progressive-payment
                    estimate for construction loans.
                  </p>
                </CardContent>
              </Card>
              <div className="how-it-works">
                <CircleHelp size={19} />
                <h3>What happens on refresh?</h3>
                <p>
                  We check published data and try the official sources. New observations are merged
                  into this browser; previous rates are kept when a source is unreachable.
                </p>
                <button onClick={() => setTab('Sources')}>
                  See sources & freshness <ArrowUpRight size={14} />
                </button>
              </div>
            </aside>
          </div>
        )}
        {tab === 'Sources' && (
          <section className="sources-view">
            <div className="section-heading">
              <div>
                <h2>Follow the information back.</h2>
                <p>
                  Snapshot generation, bank observations and browser checks have separate
                  timestamps.
                </p>
                <p>
                  Snapshot generated: {timestamp(cache.snapshotGeneratedAt)}. Generation does not
                  renew bank observations.
                </p>
                {cache.lastFeedCheck && (
                  <p>
                    Published feed last downloaded:{' '}
                    {new Date(cache.lastFeedCheck).toLocaleString('en-SG', {
                      timeZone: 'Asia/Singapore',
                    })}{' '}
                    SGT
                  </p>
                )}
              </div>
            </div>
            <div className="source-intro">
              <ShieldCheck size={23} />
              <div>
                <h3>Automatic updates, honest limits</h3>
                <p>
                  On page load, a six-hour refresh window checks the published static snapshot and
                  attempts direct public-page collection. Banks may block browser reads. A scheduled
                  GitHub job refreshes the published snapshot daily. No login or personal financial
                  data is sent.
                </p>
              </div>
            </div>
            {SOURCES.map((s) => {
              const status = cache.publishedSources?.find((v) => v.sourceId === s.id);
              const browserStatus = cache.browserSources?.find((v) => v.sourceId === s.id);
              const observations = cache.offers.filter((o) => o.sourceId === s.id);
              const dates = observations
                .map((o) => o.observedAt)
                .sort((a, b) => Date.parse(a) - Date.parse(b));
              return (
                <Card key={s.id} className="mb-4">
                  <CardContent className="source-row">
                    <div>
                      <h3>{s.name}</h3>
                      <p>
                        {observations.length} observation{observations.length !== 1 ? 's' : ''} ·{' '}
                        {observations.filter((o) => o.method === 'reviewed').length} manually
                        reviewed
                      </p>
                      <p className="text-sm mt-2">
                        Latest retained observation: {timestamp(dates.at(-1))}
                      </p>
                      {dates[0] !== dates.at(-1) && (
                        <p className="text-sm">
                          Oldest retained observation: {timestamp(dates[0])}
                        </p>
                      )}
                      <p className="text-sm mt-2">
                        Published collector:{' '}
                        {status?.status === 'ok'
                          ? 'Successful'
                          : status
                            ? 'Unavailable · previous observations retained'
                            : 'Not recorded'}
                      </p>
                      <p className="text-xs mt-2">
                        Last collector attempt: {timestamp(status?.attemptedAt)}
                      </p>
                      <p className="text-xs mt-2">
                        Last successful collector extraction: {timestamp(status?.successAt)}
                      </p>
                      <p className="text-sm mt-2">{status?.message}</p>
                      <p className="text-sm mt-3">
                        Browser direct check:{' '}
                        {'collectorOnly' in s
                          ? 'Snapshot only · PDF processed by collector'
                          : browserStatus?.status === 'ok'
                            ? 'Successful'
                            : browserStatus
                              ? 'Unavailable · does not change collector status'
                              : 'Not recorded'}
                      </p>
                      <p className="text-xs mt-2">
                        Last browser attempt: {timestamp(browserStatus?.attemptedAt)}
                      </p>
                      <p className="text-xs mt-2">
                        Last successful browser extraction: {timestamp(browserStatus?.successAt)}
                      </p>
                      {status?.failureKind && (
                        <p className="text-xs mt-2">
                          Failure category: {status.failureKind}
                          {status.httpStatus ? ` (HTTP ${status.httpStatus})` : ''} ·{' '}
                          {status.attempts ?? 1} attempt(s). Previous observations retained.
                        </p>
                      )}
                      {s.id === 'maybank' && (
                        <p className="text-sm mt-3">
                          Experimental automatic collection. Reviewed snapshots remain available
                          when retrieval fails.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge variant="outline">
                        {observations.some((o) => isStale(o, clock))
                          ? 'Needs recheck'
                          : status?.status === 'ok'
                            ? 'Collector verified'
                            : 'Retained / unverified'}
                      </Badge>
                      <a
                        aria-label={`Open ${s.name}`}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ArrowUpRight size={20} />
                      </a>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            <div className="source-directory">
              <h3>Explore more official sources</h3>
              <p>
                These links are provided for research. Their rates are not automatically extracted
                in this version.
              </p>
              <p className="mt-2 text-sm">
                Coverage reviewed 31 October 2026. These are research dates, not rate observations.
              </p>
              <div className="space-y-4 mt-4">
                {REFERENCE_SOURCES.map((source) => (
                  <div key={source.name}>
                    <a className="source-link" href={source.url} target="_blank" rel="noreferrer">
                      {source.name}
                      <ArrowUpRight size={14} />
                    </a>
                    <Badge variant="outline" className="ml-2">
                      {source.status}
                    </Badge>
                    <p className="text-sm mt-2">{source.detail}</p>
                  </div>
                ))}
                <a
                  className="source-link"
                  href="https://www.mas.gov.sg/monetary-policy/sora"
                  target="_blank"
                  rel="noreferrer"
                >
                  MAS · SORA benchmark <ArrowUpRight size={14} />
                </a>
              </div>
            </div>
          </section>
        )}
        {tab === 'History' && (
          <section>
            <div className="section-heading">
              <div>
                <h2>Your rate notebook.</h2>
                <p>
                  Revisions observed by this browser. Repeated downloads do not create duplicate
                  entries.
                </p>
              </div>
            </div>
            {cache.history.length ? (
              <div className="history-list">
                {[...cache.history].reverse().map((h, i) => (
                  <div className="history-row" key={`${h.offer.id}-${h.replacedAt}-${i}`}>
                    <History size={19} />
                    <div>
                      <h3>
                        {h.offer.bank} · {h.offer.name}
                      </h3>
                      <p>
                        Previous observation: {stageDisplay(h.offer.stages[0])} ·{' '}
                        {date(h.offer.observedAt)}
                      </p>
                      <p>
                        Superseded {date(h.replacedAt)} · {h.offer.stages[0].formula}
                      </p>
                    </div>
                    <Badge variant="outline">Archived</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <History size={28} />
                <h3>A little history takes time.</h3>
                <p>
                  When a package’s rate or terms change, its previous observation will appear here.
                  The first download is your starting point.
                </p>
                <Button variant="outline" onClick={() => setTab('Rates')}>
                  Explore rates
                </Button>
              </div>
            )}
          </section>
        )}
        <footer>
          <span className="flex items-center gap-2">
            <House size={16} /> ratepro <span className="text-muted-foreground">/ Singapore</span>
          </span>
          <p>
            Independent public information, not a lender or financial adviser. Confirm current rates
            and full terms with the institution.
          </p>
        </footer>
      </main>
      {comparison.length > 0 && (
        <div className="compare-dock">
          <span>
            <Check size={16} />
            {comparison.length} selected
          </span>
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm">
                Compare packages <ChevronRight size={14} />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-auto">
              <DialogHeader>
                <DialogTitle>Compare the full picture</DialogTitle>
                <DialogDescription>
                  Different property types and eligibility criteria may make these offers unsuitable
                  for the same borrower. Initial-rate estimates assume a fully drawn loan.
                </DialogDescription>
              </DialogHeader>
              <div className="comparison-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Package</th>
                      {comparison.map((o) => (
                        <th key={o.id}>
                          {o.bank}
                          <br />
                          {o.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      'Property',
                      'Initial rate',
                      'Formula',
                      'Commitment',
                      'Minimum loan',
                      'Maximum loan',
                      'Customer conditions',
                      'SORA rate floor',
                      'Monthly estimate',
                      'Observed',
                    ].map((label) => (
                      <tr key={label}>
                        <th>{label}</th>
                        {comparison.map((o) => {
                          const p = offerPayment(o, Number(principal), Number(years));
                          const below = o.minLoan !== null && Number(principal) < o.minLoan;
                          return (
                            <td key={o.id}>
                              {label === 'Property'
                                ? `${o.property} · ${o.construction}`
                                : label === 'Initial rate'
                                  ? stageDisplay(o.stages[0])
                                  : label === 'Formula'
                                    ? o.stages[0].formula
                                    : label === 'Commitment'
                                      ? o.lockYears === null
                                        ? 'Check source'
                                        : `${o.lockYears} years`
                                      : label === 'Minimum loan'
                                        ? o.minLoan === null
                                          ? 'Check source'
                                          : money(o.minLoan)
                                        : label === 'Maximum loan'
                                          ? o.maxLoanExclusive
                                            ? `Below ${money(o.maxLoanExclusive)}`
                                            : 'No upper band extracted'
                                          : label === 'Customer conditions'
                                            ? o.customerTier
                                              ? `${o.customerTier}${o.minRelationshipBalance ? ` · relationship balance ≥ ${money(o.minRelationshipBalance)}` : ''}`
                                              : 'See source terms'
                                            : label === 'SORA rate floor'
                                              ? o.rateFloor !== undefined
                                                ? `${o.rateFloor.toFixed(2)}%`
                                                : 'Not extracted'
                                              : label === 'Monthly estimate'
                                                ? below
                                                  ? 'Below minimum loan'
                                                  : o.maxLoanExclusive &&
                                                      Number(principal) >= o.maxLoanExclusive
                                                    ? 'Outside loan amount band'
                                                    : o.stages[0].rate === null
                                                      ? 'Not calculated: benchmark fixing required'
                                                      : o.construction === 'Under construction'
                                                        ? 'Progressive drawdown; check source'
                                                        : validCalc && p !== null
                                                          ? money(p)
                                                          : 'Check calculator inputs'
                                                : `${date(o.observedAt)}${isStale(o) ? ' · stale' : ''}`}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Estimate uses {money(Number(principal) || 0)} over {years || '—'} years. It does not
                model future rate changes, fees or eligibility.
              </p>
            </DialogContent>
          </Dialog>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Clear comparison"
            onClick={() => setSelected([])}
          >
            <X size={16} />
          </Button>
        </div>
      )}
    </div>
  );
}
