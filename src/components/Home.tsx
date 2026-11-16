import { useEffect, useState, lazy, Suspense } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronLeft,
  Clock3,
  ExternalLink,
  SlidersHorizontal,
} from 'lucide-react';
import { editorialClient, ContentError } from '../lib/content';
import { marketDay } from '../lib/markets';
import {
  type ArticleSummary,
  type HomeData,
  type EditorialPage,
  type EditorialFilter,
} from '../lib/editorial-data';
import { articleHref, marketInfo, type MarketCode } from '../lib/markets';
import { categories, editorialStatus, readingMinutes, type Article } from '../lib/editorial';
import './home.css';
import { HomeIllustration, StoryIllustration } from './MortgageVisuals';

const date = (s: string, market: MarketCode = 'SG') =>
  new Intl.DateTimeFormat('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: marketInfo(market).timeZone,
  }).format(new Date(s));
const href = articleHref;
export function Meta({ article }: { article: Article | ArticleSummary }) {
  return (
    <div className="story-meta">
      <span>{categories[article.category]}</span>
      <span>{date(article.reportDate)}</span>
      <span>
        <Clock3 size={12} />
        {'minutes' in article ? article.minutes : readingMinutes(article)} min read
      </span>
    </div>
  );
}
export function JournalView({
  data,
  page,
  now,
  market,
  category,
  onCategory,
  onPage,
}: {
  data: HomeData;
  page: EditorialPage;
  now: Date;
  market: MarketCode;
  category: EditorialFilter;
  onCategory: (category: EditorialFilter) => void;
  onPage: (page: number) => void;
}) {
  const info = marketInfo(market);
  const featured = data.featured,
    packages = data.packages,
    archive = page.items;
  const isSuperseded = (a: ArticleSummary) => Boolean(a.supersededBy);
  return (
    <div className="journal">
      <section className="journal-hero">
        <div>
          <div className="eyebrow">
            <span /> THE {info.name.toUpperCase()} HOME LOAN JOURNAL
          </div>
          <h1>
            A little context.
            <br />A clearer <em>next move.</em>
          </h1>
          <p>
            Understand the market. Look beyond the headline rate.
            <br className="hidden sm:block" /> Find a home loan with the full picture in view.
          </p>
          <div className="journal-actions">
            <a className="journal-button" href="#/rates">
              {market === 'SG' ? 'Compare home loans' : 'Explore Japan home loans'}{' '}
              <ArrowUpRight size={18} />
            </a>
            <a className="text-link" href="#journal-stories">
              Read the latest <ArrowRight size={16} />
            </a>
          </div>
        </div>
        <HomeIllustration market={market} />
      </section>
      {market === 'JP' && (
        <p className="market-coverage">
          <strong>JAPAN / 日本 · JPY</strong> Reviewed explainers and package observations. Daily
          bank-rate observations are available in the loan explorer, with source dates and
          conditions.
        </p>
      )}
      <div className="journal-divider">
        <span>THE BRIEFING</span>
        <span>{info.name.toUpperCase()} · INDEPENDENT PERSPECTIVE</span>
      </div>
      {featured ? (
        <section className="briefing" aria-labelledby="briefing-title">
          <div className="briefing-main">
            <Meta article={featured} />
            <h2 id="briefing-title">
              <a href={href(featured)}>{featured.title}</a>
            </h2>
            <p>{featured.summary}</p>
            <div className="briefing-bottom">
              <a className="text-link" href={href(featured)}>
                Read the briefing <ArrowRight size={17} />
              </a>
              <span className="story-status">{editorialStatus(featured, now)}</span>
            </div>
          </div>
          <div className="briefing-points">
            <span className="eyebrow">THE TAKEAWAYS</span>
            {featured.takeaways.map((t, i) => (
              <div className="briefing-point" key={i}>
                <span>0{i + 1}</span>
                <div>
                  <p>{t.text}</p>
                  <span className="evidence-links">
                    {t.sources.map((source) => (
                      <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                        {source.publisher}
                        <ArrowUpRight size={12} />
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="journal-empty">
          <h2>No current briefing is available.</h2>
          <p>Browse past reports in the reading room below or explore the rate directory.</p>
        </section>
      )}
      <section className="package-watch">
        <div className="journal-section-heading">
          <div>
            <span className="eyebrow">BEYOND THE HEADLINE</span>
            <h2>On the package watchlist.</h2>
          </div>
          <p>
            Public terms, dated checks.
            <br />
            Availability still needs confirming.
          </p>
        </div>
        <div className="package-grid">
          {packages.map((a) => (
            <article key={a.slug} className="watch-card">
              <div className="watch-top">
                <span className="lender-monogram">{a.lender.slice(0, 1)}</span>
                <div>
                  <strong>{a.lender}</strong>
                  <small>Checked {date(a.firstCheckedAt, a.market)}</small>
                </div>
                <ArrowUpRight size={20} />
              </div>
              <span className="story-status">
                {isSuperseded(a) ? 'Superseded report' : editorialStatus(a, now)}
              </span>
              <h3>
                <a href={href(a)}>{a.title}</a>
              </h3>
              <details className="visual-disclosure">
                <summary>Who is this for?</summary>
                <p>{a.eligibilityPreview}</p>
              </details>
              <div className="watch-expiry">
                {a.package!.expiry
                  ? `Published end: ${date(a.package!.expiry)}`
                  : a.effectiveUntil
                    ? `Stated period through ${date(a.effectiveUntil)} · application deadline not stated`
                    : 'End date not stated · limited availability may apply'}
              </div>
              <a className="text-link" href={href(a)}>
                Read terms & evidence <ArrowRight size={15} />
              </a>
            </article>
          ))}
          {packages.length === 0 && (
            <div className="journal-empty">
              <h3>No reviewed package reports yet.</h3>
              <p>We publish only after the source and eligibility are checked.</p>
            </div>
          )}
          <aside className="watch-checklist">
            <SlidersHorizontal size={24} />
            <h3>A better comparison starts with better questions.</h3>
            <ul>
              <li>
                <Check size={15} />
                What happens after the initial period?
              </li>
              <li>
                <Check size={15} />
                When can I leave, and at what cost?
              </li>
              <li>
                <Check size={15} />
                Do I meet the eligibility conditions?
              </li>
            </ul>
            <a className="text-link" href="#/rates">
              Open the rate directory <ArrowRight size={15} />
            </a>
          </aside>
        </div>
      </section>
      <section id="journal-stories" className="journal-archive">
        <div className="journal-section-heading">
          <div>
            <span className="eyebrow">THE READING ROOM</span>
            <h2>A little more perspective.</h2>
          </div>
          <BookOpen size={26} />
        </div>
        <div className="journal-filters" aria-label="Filter reports">
          {[['all', 'All stories'], ...Object.entries(categories)].map(([key, label]) => (
            <button
              key={key}
              aria-pressed={category === key}
              onClick={() => onCategory(key as EditorialFilter)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="story-list visual-story-grid">
          {archive.map((a) => (
            <article key={a.slug} className="story-row visual-story-card">
              <StoryIllustration category={a.category} />
              <div className="visual-story-body">
                <Meta article={a} />
                <h3>
                  <a href={href(a)}>{a.title}</a>
                </h3>
                <p>{a.summary}</p>
                <span className="story-status">
                  {isSuperseded(a) ? 'Superseded report' : editorialStatus(a, now)}
                </span>
              </div>
              <a href={href(a)} className="visual-story-open" aria-label={`Read: ${a.title}`}>
                Read story <ArrowUpRight size={17} />
              </a>
            </article>
          ))}
          {archive.length === 0 && (
            <p className="journal-empty">No reports in this category yet.</p>
          )}
        </div>
        <nav className="journal-pagination" aria-label="Reading room pages">
          <button disabled={page.page === 1} onClick={() => onPage(page.page - 1)}>
            Previous page
          </button>
          <span role="status">
            Page {page.page} of {Math.max(1, Math.ceil(page.total / 20))} · {page.total} reports
          </span>
          <button disabled={page.page * 20 >= page.total} onClick={() => onPage(page.page + 1)}>
            Next page
          </button>
        </nav>
      </section>
      <section className="journal-method">
        <div className="eyebrow">OUR APPROACH</div>
        <h2>
          Useful reading.
          <br />
          <em>Traceable information.</em>
        </h2>
        <div>
          <p>
            Every report links to its evidence and separates published facts from interpretation. A
            report date never renews a bank-rate observation.
          </p>
          <p>
            We cover selected public sources, not the entire market. Packages may change; confirm
            current terms with the lender.
          </p>
          <a className="text-link" href="#/sources">
            Explore our rate sources <ArrowRight size={16} />
          </a>
        </div>
      </section>
    </div>
  );
}

const Reader = lazy(() => import('./ArticleReader'));
function Loading() {
  return (
    <section className="journal-empty" role="status">
      Loading editorial content…
    </section>
  );
}
export function Failure({ error, retry }: { error: Error; retry: () => void }) {
  const missing = error instanceof ContentError && error.status === 404;
  return (
    <section className="journal-empty" role="alert">
      <h1>{missing ? 'We couldn’t find that report.' : 'Editorial content is unavailable.'}</h1>
      {!missing && <p>{error.message}</p>}
      <button className="text-link" onClick={retry}>
        Retry content
      </button>{' '}
      <a className="text-link" href="#/home">
        Back to the journal <ArrowRight size={16} />
      </a>
    </section>
  );
}
function ReadArticle({ slug, market, now }: { slug: string; market: MarketCode; now: Date }) {
  const [body, setBody] = useState<import('../lib/editorial-data').ArticleBody>();
  const [error, setError] = useState<Error>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setBody(undefined);
    setError(undefined);
    editorialClient
      .article(slug, market, c.signal)
      .then((value) => {
        if (!c.signal.aborted) setBody(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e);
      });
    return () => c.abort();
  }, [slug, market, retry]);
  if (error)
    return (
      <Failure
        error={error}
        retry={() => {
          editorialClient.clear();
          setRetry((r) => r + 1);
        }}
      />
    );
  return body ? (
    <Suspense fallback={<Loading />}>
      <Reader article={body.article} meta={body.meta} now={now} />
    </Suspense>
  ) : (
    <Loading />
  );
}
function Journal({ market, now }: { market: MarketCode; now: Date }) {
  const [category, setCategory] = useState<EditorialFilter>('all'),
    [pageNumber, setPageNumber] = useState(1),
    [retry, setRetry] = useState(0);
  const [data, setData] = useState<HomeData>(),
    [page, setPage] = useState<EditorialPage>(),
    [error, setError] = useState<Error>();
  const day = marketDay(now, market);
  useEffect(() => {
    const c = new AbortController();
    setError(undefined);
    setData(undefined);
    setPage(undefined);
    Promise.all([
      editorialClient.home(market, new Date(day + 'T04:00:00Z'), c.signal),
      editorialClient.page(market, category, pageNumber, c.signal),
    ])
      .then(([home, page]) => {
        if (!c.signal.aborted) {
          setData(home);
          setPage(page);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e);
      });
    return () => c.abort();
  }, [market, day, category, pageNumber, retry]);
  if (error)
    return (
      <Failure
        error={error}
        retry={() => {
          editorialClient.clear();
          setRetry((r) => r + 1);
        }}
      />
    );
  if (!data || !page) return <Loading />;
  return (
    <JournalView
      data={data}
      page={page}
      market={market}
      now={now}
      category={category}
      onCategory={(c) => {
        setCategory(c);
        setPageNumber(1);
      }}
      onPage={setPageNumber}
    />
  );
}
export function Home({ slug, market, now }: { slug?: string; market: MarketCode; now: Date }) {
  return slug ? (
    <ReadArticle key={market + ':' + slug} slug={slug} market={market} now={now} />
  ) : (
    <Journal key={market} market={market} now={now} />
  );
}
