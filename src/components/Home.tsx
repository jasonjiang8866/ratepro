import { useState } from 'react';
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
import { articles } from '../lib/content';
import { categories, editorialStatus, readingMinutes, type Article } from '../lib/editorial';
import './home.css';

const date = (s: string) =>
  new Intl.DateTimeFormat('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Singapore',
  }).format(new Date(s));
const href = (a: Article) => `#/read/${a.slug}`;
function SourceLinks({ article, ids }: { article: Article; ids: string[] }) {
  return (
    <span className="evidence-links">
      {ids.map((id) => {
        const source = article.sources.find((s) => s.id === id)!;
        return (
          <a key={id} href={source.url} target="_blank" rel="noreferrer">
            {source.publisher}
            <ArrowUpRight size={12} />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        );
      })}
    </span>
  );
}
function Meta({ article }: { article: Article }) {
  return (
    <div className="story-meta">
      <span>{categories[article.category]}</span>
      <span>{date(article.reportDate)}</span>
      <span>
        <Clock3 size={12} />
        {readingMinutes(article)} min read
      </span>
    </div>
  );
}
function Reader({ article, now }: { article: Article; now: Date }) {
  const replacement = articles.find((item) => item.supersedes === article.slug);
  return (
    <article className="reader">
      <a className="text-link" href="#/home">
        <ChevronLeft size={16} /> Back to the journal
      </a>
      <header className="reader-header">
        <Meta article={article} />
        <h1>{article.title}</h1>
        <p className="reader-deck">{article.summary}</p>
        <span className="story-status">
          {replacement ? 'Superseded report' : editorialStatus(article, now)}
        </span>
        {replacement && (
          <p className="correction-notice">
            This report has a correction.{' '}
            <a className="text-link" href={href(replacement)}>
              Read the updated report <ArrowRight size={14} />
            </a>
          </p>
        )}
      </header>
      <div className="reader-columns">
        <div className="reader-body">
          <section className="reader-takeaways">
            <h2>At a glance</h2>
            {article.takeaways.map((t, i) => (
              <div key={i}>
                <p>{t.text}</p>
                <SourceLinks article={article} ids={t.sourceIds} />
              </div>
            ))}
          </section>
          {article.sections.map((s, i) => (
            <section key={i}>
              <div className="eyebrow">
                {s.kind === 'analysis' ? 'EDITORIAL INTERPRETATION' : 'OFFICIAL PUBLICATION'}
              </div>
              <h2>{s.heading}</h2>
              <p>{s.text}</p>
              <SourceLinks article={article} ids={s.sourceIds} />
            </section>
          ))}
          {article.package && (
            <section className="package-terms">
              <h2>The eligibility & conditions</h2>
              <dl>
                <dt>Who it covers</dt>
                <dd>{article.package.eligibility}</dd>
                <dt>Important conditions</dt>
                <dd>{article.package.conditions}</dd>
                <dt>Published end date</dt>
                <dd>
                  {article.package.expiry
                    ? date(article.package.expiry)
                    : 'Not stated in the reviewed source. Confirm availability with the lender.'}
                </dd>
              </dl>
              <SourceLinks article={article} ids={article.package.sourceIds} />
            </section>
          )}
        </div>
        <aside className="reader-sources">
          <div className="eyebrow">THE EVIDENCE</div>
          <h2>Follow the sources.</h2>
          <p>
            Report date: {date(article.reportDate)}. Source checks below are separate from rate
            observations in the comparison tool.
          </p>
          {(article.effectiveFrom || article.effectiveUntil) && (
            <p>
              Stated period:{' '}
              {article.effectiveFrom ? date(article.effectiveFrom) : 'Start not stated'}
              {article.effectiveUntil && ` – ${date(article.effectiveUntil)}`}.
            </p>
          )}
          {article.sources.map((s) => (
            <div key={s.id} className="source-note">
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.publisher}
                <ExternalLink size={13} />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <p>{s.title}</p>
              <small>
                Checked:{' '}
                {new Intl.DateTimeFormat('en-SG', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Asia/Singapore',
                }).format(new Date(s.checkedAt))}{' '}
                SGT
              </small>
              <small>Document date: {s.documentDate ? date(s.documentDate) : 'Not stated'}</small>
            </div>
          ))}
          {article.supersedes && (
            <a className="text-link" href={`#/read/${article.supersedes}`}>
              Earlier report <ArrowRight size={14} />
            </a>
          )}
        </aside>
      </div>
      <div className="reader-next">
        <div>
          <span className="eyebrow">PUT THE CONTEXT TO WORK</span>
          <h2>Compare the terms that matter to you.</h2>
        </div>
        <a className="journal-button" href="#/rates">
          Explore loan packages <ArrowRight size={17} />
        </a>
      </div>
    </article>
  );
}
export function Home({ slug, now }: { slug?: string; now: Date }) {
  const [category, setCategory] = useState('all');
  if (slug) {
    const article = articles.find((a) => a.slug === slug);
    return article ? (
      <Reader article={article} now={now} />
    ) : (
      <section className="journal-empty">
        <h1>We couldn’t find that report.</h1>
        <a className="text-link" href="#/home">
          Back to the journal <ArrowRight size={16} />
        </a>
      </section>
    );
  }
  const isSuperseded = (a: Article) => articles.some((item) => item.supersedes === a.slug);
  const featured = articles.find((a) => a.category === 'market' && !isSuperseded(a));
  const packages = articles.filter((a) => a.category === 'package' && !isSuperseded(a)).slice(0, 3);
  const archive = articles.filter((a) => category === 'all' || a.category === category);
  return (
    <div className="journal">
      <section className="journal-hero">
        <div>
          <div className="eyebrow">
            <span /> THE SINGAPORE HOME LOAN JOURNAL
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
              Compare home loans <ArrowUpRight size={18} />
            </a>
            <a className="text-link" href="#journal-stories">
              Read the latest <ArrowRight size={16} />
            </a>
          </div>
        </div>
        <aside className="journal-principles">
          <span className="eyebrow">LESS NOISE. MORE CONTEXT.</span>
          <div>
            <span className="principle-number">01</span>
            <p>
              <strong>Go to the source.</strong>Official publications, linked in every report.
            </p>
          </div>
          <div>
            <span className="principle-number">02</span>
            <p>
              <strong>Read the conditions.</strong>Eligibility and fine print belong in the story.
            </p>
          </div>
          <div>
            <span className="principle-number">03</span>
            <p>
              <strong>Know the date.</strong>A dated observation is a starting point.
            </p>
          </div>
        </aside>
      </section>
      <div className="journal-divider">
        <span>THE BRIEFING</span>
        <span>SINGAPORE · INDEPENDENT PERSPECTIVE</span>
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
                  <SourceLinks article={featured} ids={t.sourceIds} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="journal-empty">
          <h2>The first briefing is on its way.</h2>
          <p>Reports appear here after source review. You can explore the rate directory now.</p>
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
                <span className="lender-monogram">{a.package!.lender.slice(0, 1)}</span>
                <div>
                  <strong>{a.package!.lender}</strong>
                  <small>Checked {date(a.sources[0].checkedAt)}</small>
                </div>
                <ArrowUpRight size={20} />
              </div>
              <span className="story-status">
                {isSuperseded(a) ? 'Superseded report' : editorialStatus(a, now)}
              </span>
              <h3>
                <a href={href(a)}>{a.title}</a>
              </h3>
              <p>{a.package!.eligibility}</p>
              <div className="watch-expiry">
                {a.package!.expiry
                  ? `Published end: ${date(a.package!.expiry)}`
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
            <button key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="story-list">
          {archive.map((a, i) => (
            <article key={a.slug} className="story-row">
              <span className="story-number">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <Meta article={a} />
                <h3>
                  <a href={href(a)}>{a.title}</a>
                </h3>
                <p>{a.summary}</p>
                <span className="story-status">
                  {isSuperseded(a) ? 'Superseded report' : editorialStatus(a, now)}
                </span>
              </div>
              <a href={href(a)} className="story-open" aria-label={`Read: ${a.title}`}>
                <ArrowUpRight size={23} />
              </a>
            </article>
          ))}
          {archive.length === 0 && (
            <p className="journal-empty">No reports in this category yet.</p>
          )}
        </div>
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
