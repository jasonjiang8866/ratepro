import { useState, type ReactNode } from 'react';
import { Check, ChevronRight, X } from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { jpFreshness } from '../lib/japan-rates';
import { japanComparisonWarnings, type JpComparisonItem } from '../lib/japan-comparison';

export const japanObservedDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value)) + ' JST';

export function JapanComparison({
  items,
  now,
  onRemove,
  onClear,
}: {
  items: JpComparisonItem[];
  now: Date;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const warnings = japanComparisonWarnings(items);
  const rows: { label: string; cell: (item: JpComparisonItem) => ReactNode }[] = [
    { label: 'Borrowing purpose', cell: ({ rate }) => rate.purpose },
    { label: 'Rate basis', cell: ({ source }) => <strong>{source.basis}</strong> },
    { label: 'Published annual rate', cell: ({ rate }) => `${rate.annualRate.toFixed(3)}%` },
    {
      label: 'Reference rate',
      cell: ({ rate }) =>
        rate.referenceRate === null
          ? 'To verify · no reference rate collected for this row'
          : `${rate.referenceRate.toFixed(3)}%`,
    },
    {
      label: 'Rate type / period',
      cell: ({ rate }) => (
        <>
          {rate.kind}
          {rate.kind !== 'Variable' && <span> · {rate.term}</span>}
          <small>
            {rate.kind === 'Variable'
              ? 'Rate can change during the loan.'
              : rate.kind === 'Initial fixed'
                ? 'Initial fixed period, not the full loan term.'
                : 'Full-term fixed; published borrowing-term band.'}
          </small>
        </>
      ),
    },
    {
      label: 'Eligibility & discounts',
      cell: ({ source }) => (
        <>
          {source.id === 'jp-mufg'
            ? 'Conditional discounts; borrower, account and insurance requirements apply.'
            : 'Individual discount plans are not collected.'}
          <small>To verify · eligibility and the rate available to your application.</small>
        </>
      ),
    },
    {
      label: 'Fees & insurance',
      cell: ({ source }) => (
        <>
          {source.id === 'jp-smbc' && (
            <span>Guarantee fee included in this standard rate (保証料内枠方式). </span>
          )}
          To verify · arrangement fees, insurance coverage and any additional premiums. See
          published conditions; a complete cost breakdown has not been extracted.
        </>
      ),
    },
    {
      label: 'Rate changes',
      cell: ({ rate }) =>
        rate.kind === 'Full-term fixed'
          ? 'Fixed for the applicable borrowing term; confirm eligibility and contract terms.'
          : rate.kind === 'Initial fixed'
            ? 'To verify · the applicable rate and discount after the initial fixed period. See published conditions.'
            : 'To verify · rate review timing and repayment adjustment rules. See published conditions.',
    },
    { label: 'Publication month', cell: ({ observation }) => observation.publicationMonth },
    {
      label: 'Last successful observation',
      cell: ({ observation }) => (
        <>
          {japanObservedDate(observation.observedAt)}
          <small>{jpFreshness(observation, now)}</small>
        </>
      ),
    },
    {
      label: 'Published conditions',
      cell: ({ source, observation }) => (
        <details>
          <summary>Read source conditions</summary>
          <p className="jp-conditions" lang={source.id === 'jp-mufg' ? 'ja' : undefined}>
            {observation.conditions}
          </p>
        </details>
      ),
    },
    {
      label: 'Official source',
      cell: ({ source }) => (
        <a className="text-link" href={source.url} target="_blank" rel="noreferrer">
          {source.name} official rates ↗<span className="sr-only"> (opens in a new tab)</span>
        </a>
      ),
    },
  ];
  if (!items.length) return null;
  return (
    <div className="compare-dock jp-compare-dock" aria-label="Japan comparison selection">
      <span role="status">
        <Check size={16} aria-hidden="true" /> {items.length} / 3 selected
      </span>
      <Dialog open={open && items.length >= 2} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" disabled={items.length < 2}>
            Compare terms <ChevronRight size={14} aria-hidden="true" />
          </Button>
        </DialogTrigger>
        <DialogContent className="jp-comparison-dialog sm:max-w-5xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Compare Japan loan terms</DialogTitle>
            <DialogDescription>
              Side-by-side published observations in JPY. Rates alone do not establish total
              borrowing cost or eligibility. Missing details are marked “To verify”.
            </DialogDescription>
          </DialogHeader>
          {warnings.length > 0 && (
            <div className="jp-comparison-notice" role="note" aria-label="Comparison differences">
              <strong>Check these differences</strong>
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
          <p className="calc-footnote">
            Scroll the table sideways on smaller screens to see all selected terms.
          </p>
          <div
            className="comparison-scroll jp-comparison-scroll"
            role="region"
            aria-label="Japan loan terms comparison"
            tabIndex={0}
          >
            <table>
              <caption className="sr-only">Selected Japan loan terms; no price ranking</caption>
              <thead>
                <tr>
                  <th scope="col">Term</th>
                  {items.map(({ source, rate }) => (
                    <th scope="col" key={rate.id}>
                      {source.name}
                      <small lang="ja">{rate.label}</small>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="jp-remove"
                        aria-label={`Remove ${source.name} ${rate.label}`}
                        onClick={() => {
                          if (items.length === 2) setOpen(false);
                          onRemove(rate.id);
                        }}
                      >
                        <X size={12} aria-hidden="true" /> Remove
                      </Button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ label, cell }) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {items.map((item) => (
                      <td key={item.rate.id}>{cell(item)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Clear Japan comparison"
        onClick={() => {
          setOpen(false);
          onClear();
        }}
      >
        <X size={16} aria-hidden="true" />
      </Button>
    </div>
  );
}
