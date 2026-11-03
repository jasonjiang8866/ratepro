import { BookOpen, Landmark, Tag, ArrowUpRight } from 'lucide-react';
import type { Article } from '../lib/editorial';
import type { MarketCode } from '../lib/markets';
import type { JpObservation } from '../lib/japan-rates';
import './visuals.css';

export function HomeIllustration({ market }: { market: MarketCode }) {
  return (
    <aside className="home-illustration" aria-label="A clearer path to your next home">
      <div className="illustration-heading">
        <span className="eyebrow">ROOM FOR YOUR NEXT CHAPTER</span>
        <span>{market}</span>
      </div>
      <svg viewBox="0 0 480 310" aria-hidden="true" focusable="false">
        <circle cx="338" cy="84" r="61" fill="var(--visual-sun)" />
        <path
          d="M36 244Q134 186 237 230T451 231"
          fill="none"
          stroke="var(--visual-line)"
          strokeWidth="1.5"
        />
        <path
          d="M26 270Q128 216 251 260T455 265"
          fill="none"
          stroke="var(--visual-line)"
          strokeWidth="1.5"
        />
        {market === 'SG' ? (
          <g>
            <path
              d="M90 241V83L188 57V238"
              fill="var(--visual-building)"
              stroke="var(--visual-ink)"
              strokeWidth="2"
            />
            <path
              d="M188 57L235 85V242H188Z"
              fill="var(--visual-side)"
              stroke="var(--visual-ink)"
              strokeWidth="2"
            />
            {[104, 141, 178].map((y) => (
              <g key={y} stroke="var(--visual-ink)" strokeWidth="6">
                <path d={`M110 ${y}l22 -6M151 ${y - 11}l20 -5`} />
                <path d={`M204 ${y - 9}v13`} />
              </g>
            ))}
            <path d="M132 238V209L161 202V239" fill="var(--visual-ink)" />
          </g>
        ) : (
          <g>
            <path
              d="M68 155L147 88L225 155"
              fill="var(--visual-side)"
              stroke="var(--visual-ink)"
              strokeWidth="2"
            />
            <path
              d="M87 151V240H208V151L147 100Z"
              fill="var(--visual-building)"
              stroke="var(--visual-ink)"
              strokeWidth="2"
            />
            <path
              d="M103 168h28v30h-28zM163 168h28v30h-28zM138 210h20v30h-20z"
              fill="var(--visual-ink)"
            />
            <path
              d="M235 173l53 -46 54 46v65H235Z"
              fill="var(--visual-side)"
              stroke="var(--visual-ink)"
              strokeWidth="2"
            />
            <path d="M271 184h29v25h-29z" fill="var(--visual-building)" />
          </g>
        )}
        <path d="M364 244v-80" stroke="var(--visual-ink)" strokeWidth="3" />
        <path d="M364 111c-49 38-45 87 0 90 46-3 48-52 0-90Z" fill="var(--visual-leaf)" />
        <path
          d="M364 191v-43m0 27l-15-13m15 23l16-15"
          stroke="var(--visual-ink)"
          strokeWidth="2"
          fill="none"
        />
        <path
          d="M64 245h343M123 271h183"
          stroke="var(--visual-ink)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <g transform="translate(263 42) rotate(-9)">
          <rect
            width="64"
            height="64"
            rx="14"
            fill="var(--visual-card)"
            stroke="var(--visual-ink)"
            strokeWidth="1.5"
          />
          <circle cx="23" cy="24" r="9" fill="none" stroke="var(--visual-ink)" strokeWidth="3" />
          <path d="M29 31l16 16m-7-7l6-6m-1 11l6-6" stroke="var(--visual-ink)" strokeWidth="3" />
        </g>
      </svg>
      <a href="#/rates" className="illustration-link">
        <span>
          <strong>Your home. Your terms.</strong>
          <small>Explore the options, one step at a time.</small>
        </span>
        <ArrowUpRight size={23} />
      </a>
    </aside>
  );
}

export function StoryIllustration({ category }: { category: Article['category'] }) {
  const Icon = category === 'market' ? Landmark : category === 'package' ? Tag : BookOpen;
  return (
    <div className={`story-illustration art-${category}`} aria-hidden="true">
      <span className="art-orbit" />
      <span className="art-sheet">
        <Icon size={42} strokeWidth={1.25} />
        <i />
        <i />
      </span>
      <span className="art-stamp">
        {category === 'market'
          ? 'THE BIG PICTURE'
          : category === 'package'
            ? 'THE FINE PRINT'
            : 'A LITTLE CLARITY'}
      </span>
    </div>
  );
}

type RateKind = JpObservation['rates'][number]['kind'];
export function RateStructure({ kind }: { kind: RateKind }) {
  const variable = kind === 'Variable';
  const initial = kind === 'Initial fixed';
  const label = variable
    ? 'Rate can change throughout the loan.'
    : initial
      ? 'Fixed initially; the rate resets after the fixed period.'
      : 'Rate remains fixed for the applicable loan term.';
  return (
    <figure
      className={`rate-structure structure-${variable ? 'variable' : initial ? 'initial' : 'full'}`}
    >
      <svg viewBox="0 0 240 58" role="img" aria-label={label}>
        <path d="M8 48H232" className="structure-axis" />
        <path
          d={
            variable
              ? 'M8 34H43V22H77V31H114V15H153V26H191V19H232'
              : initial
                ? 'M8 30H126'
                : 'M8 30H232'
          }
          className="structure-line"
        />
        {initial && (
          <>
            <path d="M126 8V48" className="structure-axis" />
            <path d="M126 30H160M172 30H196M208 30H232" className="structure-unknown" />
          </>
        )}
        <circle cx="8" cy={variable ? '34' : '30'} r="3.5" className="structure-dot" />
      </svg>
      <figcaption>
        <span>{variable ? 'Can change' : initial ? 'Fixed first' : 'Fixed throughout'}</span>
        <span>{initial ? 'Then resets' : 'Loan term →'}</span>
      </figcaption>
    </figure>
  );
}
