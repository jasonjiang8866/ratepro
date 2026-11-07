import { marketInfo, marketMoney, type MarketCode } from '../lib/markets';
import { Input } from './ui/input';
import { LoanAmountInput } from './LoanAmountInput';

type Props = {
  market: MarketCode;
  principal: string;
  years: string;
  rate: string;
  monthly: number | null;
  setPrincipal: (value: string) => void;
  setYears: (value: string) => void;
  setRate: (value: string) => void;
};

// Both markets share presentation; callers retain their input state and validation.
export function ScenarioCalculator({
  market,
  principal,
  years,
  rate,
  monthly,
  setPrincipal,
  setYears,
  setRate,
}: Props) {
  const currency = marketInfo(market).currency;
  const ids =
    market === 'SG'
      ? { principal: 'loan', years: 'tenure', rate: 'rate' }
      : { principal: 'jp-principal', years: 'jp-years', rate: 'jp-rate' };
  const totalInterest =
    monthly === null ? null : Math.max(0, monthly * Number(years) * 12 - Number(principal));
  return (
    <section
      className="watch-card scenario-calculator"
      aria-label={`${currency} repayment calculator`}
    >
      <div className="eyebrow">YOUR SCENARIO · {currency}</div>
      <h2>Make the numbers real.</h2>
      <label htmlFor={ids.principal} className="field-label">
        Loan amount ({market === 'SG' ? 'S$' : 'JPY'})
      </label>
      <LoanAmountInput id={ids.principal} value={principal} onValueChange={setPrincipal} />
      <label htmlFor={ids.years} className="field-label">
        Tenure (years)
      </label>
      <Input
        id={ids.years}
        type="number"
        min="1"
        max={market === 'SG' ? 35 : 50}
        value={years}
        onChange={(e) => setYears(e.target.value)}
      />
      <label htmlFor={ids.rate} className="field-label">
        Your assumed annual rate (%)
      </label>
      <Input
        id={ids.rate}
        type="number"
        min="0"
        max="30"
        step="0.01"
        placeholder="Enter a scenario rate"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
      />
      <div className="payment" aria-live="polite">
        <span>Estimated monthly payment · {currency}</span>
        <strong>{monthly !== null ? marketMoney(monthly, market) : '—'}</strong>
      </div>
      {totalInterest !== null && (
        <div className="repayment-visual">
          <div
            className="repayment-ring"
            role="img"
            aria-label={`Constant-rate illustration: principal ${marketMoney(Number(principal), market)}, total interest ${marketMoney(totalInterest, market)}`}
            style={{
              background: `conic-gradient(var(--primary) ${(Number(principal) / (Number(principal) + totalInterest)) * 100}%, var(--visual-sun) 0)`,
            }}
          >
            <span>
              {years}
              <small>years</small>
            </span>
          </div>
          <dl>
            <div>
              <dt>
                <i />
                Principal
              </dt>
              <dd>{marketMoney(Number(principal), market)}</dd>
            </div>
            <div>
              <dt>
                <i />
                Total interest
              </dt>
              <dd>{marketMoney(totalInterest, market)}</dd>
            </div>
          </dl>
        </div>
      )}
      <p className="calc-footnote">
        Illustration assumes your entered rate stays constant for the entire loan.
      </p>
      <details className="visual-disclosure">
        <summary>Assumptions & exclusions</summary>
        <p className="calc-footnote">
          {market === 'SG'
            ? 'Assumes a fully drawn, amortising loan and a constant rate for the whole tenure. Excludes fees, CPF effects and eligibility checks. Not a progressive-payment estimate for construction loans.'
            : 'A constant-rate, equal-payment illustration only. Excludes fees, insurance, tax relief, bonus repayments and rate resets. It does not model staged Flat35 discounts or any five-year / 125% payment rule. Tenure and borrowing eligibility depend on the lender.'}
        </p>
      </details>
      {monthly === null && (
        <p className="text-sm" role="alert">
          {market === 'SG'
            ? 'Enter a positive loan up to S$100 million, 1–35 years and a rate of 0–30%.'
            : 'Enter a loan up to ¥1 billion, 1–50 years and an assumed rate of 0–30%.'}
        </p>
      )}
    </section>
  );
}
