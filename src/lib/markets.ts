import config from '../../config/markets.json';
export const MARKET_CODES = ['SG', 'JP'] as const;
export type MarketCode = (typeof MARKET_CODES)[number];
export const markets = config as ((typeof config)[number] & { code: MarketCode })[];
export const marketInfo = (code: MarketCode) => markets.find((m) => m.code === code)!;
export const isMarket = (value: unknown): value is MarketCode =>
  MARKET_CODES.some((m) => m === value);
export function marketDay(now: Date, market: MarketCode) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: marketInfo(market).timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function resolveMarket(
  search: string,
  hash: string,
  saved: unknown,
  articleMarket?: MarketCode,
): MarketCode {
  const params = new URLSearchParams(search);
  const explicit = params.get('market')?.toUpperCase();
  if (params.has('market')) return isMarket(explicit) ? explicit : 'SG';
  if (hash.startsWith('#/read/')) return articleMarket ?? 'SG';
  // Preserve all old Singapore deep links, even after choosing Japan.
  if (hash.startsWith('#/')) return 'SG';
  return isMarket(saved) ? saved : 'SG';
}
export const articleHref = (a: { market: MarketCode; slug: string }) =>
  `?market=${a.market}#/read/${a.slug}`;
export function marketMoney(value: number, market: MarketCode) {
  const info = marketInfo(market);
  return new Intl.NumberFormat(info.locale, {
    style: 'currency',
    currency: info.currency,
    maximumFractionDigits: 0,
  }).format(value);
}
