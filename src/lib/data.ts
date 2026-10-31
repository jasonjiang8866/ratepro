import { CacheSchema, FeedSchema, emptyCache, type Cache, type Feed, type Offer } from './schema';
export const CACHE_KEY = 'ratepro.cache.v1';
export const REFRESH_INTERVAL = 6 * 60 * 60 * 1000;
export const MAX_BYTES = 2_000_000;
export function fingerprint(offer: Offer) {
  const { observedAt: _at, method: _method, ...terms } = offer;
  return JSON.stringify(terms);
}
export function mergeFeed(cache: Cache, raw: unknown, now = new Date().toISOString()): Cache {
  const feed = FeedSchema.parse(raw);
  if (
    Date.parse(feed.generatedAt) > Date.parse(now) + 300000 ||
    feed.offers.some((o) => Date.parse(o.observedAt) > Date.parse(now) + 300000)
  )
    throw new Error('Future-dated feed rejected');
  const map = new Map(cache.offers.map((o) => [o.id, o]));
  const history = [...cache.history];
  for (const offer of feed.offers) {
    const old = map.get(offer.id);
    if (old && Date.parse(old.observedAt) >= Date.parse(offer.observedAt)) continue;
    if (old && fingerprint(old) !== fingerprint(offer))
      history.push({ offer: old, replacedAt: offer.observedAt });
    map.set(offer.id, offer);
  }
  const statuses = new Map(cache.sources.map((s) => [s.sourceId, s]));
  for (const s of feed.sources) {
    const old = statuses.get(s.sourceId);
    if (!old || Date.parse(s.attemptedAt) > Date.parse(old.attemptedAt))
      statuses.set(s.sourceId, s);
  }
  return CacheSchema.parse({
    ...cache,
    offers: [...map.values()],
    history: history.slice(-500),
    sources: [...statuses.values()],
  });
}
export function readCache(storage: Pick<Storage, 'getItem'>): { cache: Cache; warning?: string } {
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return { cache: emptyCache() };
    if (raw.length > MAX_BYTES) throw Error();
    return { cache: CacheSchema.parse(JSON.parse(raw)) };
  } catch {
    return {
      cache: emptyCache(),
      warning: 'Saved data could not be read. Refresh to recover the published rates.',
    };
  }
}
export function saveCache(storage: Pick<Storage, 'setItem'>, cache: Cache): string | undefined {
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(CacheSchema.parse(cache)));
  } catch {
    return 'Browser storage is unavailable or full. This session works, but changes will not survive a reload.';
  }
}
export function parseImport(text: string): Feed {
  if (text.length > MAX_BYTES) throw Error('File is too large (maximum 2 MB).');
  const raw = JSON.parse(text);
  let feed: Feed;
  if (raw && typeof raw === 'object' && 'history' in raw) {
    const c = CacheSchema.parse(raw);
    feed = FeedSchema.parse({
      version: 1,
      generatedAt: new Date().toISOString(),
      offers: c.offers,
      sources: [],
    });
  } else feed = FeedSchema.parse(raw);
  return {
    ...feed,
    sources: [],
    offers: feed.offers.map((o) => ({ ...o, method: 'imported' as const })),
  };
}
export function payment(principal: number, rate: number, years: number) {
  if (
    !Number.isFinite(principal) ||
    !Number.isFinite(rate) ||
    !Number.isFinite(years) ||
    principal <= 0 ||
    rate < 0 ||
    years <= 0
  )
    return null;
  const n = years * 12,
    r = rate / 1200;
  return r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n));
}
