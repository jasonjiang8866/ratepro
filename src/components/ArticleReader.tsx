import { ArrowRight, ArrowUpRight, ChevronLeft, Clock3, ExternalLink } from 'lucide-react';
import { articleHref, marketInfo, type MarketCode } from '../lib/markets';
import { categories, editorialStatus, readingMinutes, type Article } from '../lib/editorial';
import { type ArticleSummary } from '../lib/editorial-data';
const href = articleHref;
const date = (s: string, market: MarketCode = 'SG') =>
  new Intl.DateTimeFormat('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: marketInfo(market).timeZone,
  }).format(new Date(s));
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
function Meta({ article }: { article: Article | ArticleSummary }) {
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
export default function Reader({
  article,
  meta,
  now,
}: {
  article: Article;
  meta: ArticleSummary;
  now: Date;
}) {
  const replacement = meta.supersededBy
    ? { market: article.market, slug: meta.supersededBy }
    : null;
  return (
    <article className="reader">
      <a className="text-link" href="#/home">
        <ChevronLeft size={16} /> Back to the journal
      </a>
      <header className="reader-header">
        <Meta article={meta} />
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
                  timeZone: marketInfo(article.market).timeZone,
                }).format(new Date(s.checkedAt))}{' '}
                {marketInfo(article.market).timeZoneLabel}
              </small>
              <small>Document date: {s.documentDate ? date(s.documentDate) : 'Not stated'}</small>
            </div>
          ))}
          {article.supersedes && (
            <a className="text-link" href={href({ ...article, slug: article.supersedes })}>
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
