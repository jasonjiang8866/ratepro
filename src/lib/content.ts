import { type z } from 'zod';
import {
  BodySchema,
  CalendarSchema,
  HomeDataSchema,
  LocatorSchema,
  ManifestSchema,
  PageSchema,
  type ArticleBody,
  type EditorialFilter,
  type EditorialManifest,
  type EditorialPage,
  type HomeData,
} from './editorial-data';
import { marketDay, type MarketCode } from './markets';
export class ContentError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}
class RevisionError extends Error {}
export class LruCache<T> {
  private entries = new Map<string, { value: T; bytes: number; expires: number }>();
  private bytes = 0;
  constructor(
    readonly maxEntries: number,
    readonly maxBytes: number,
    readonly ttl = 300000,
  ) {}
  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.expires <= now) {
      this.delete(key);
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  private delete(key: string) {
    const e = this.entries.get(key);
    if (e) this.bytes -= e.bytes;
    this.entries.delete(key);
  }
  set(key: string, value: T, bytes: number, now = Date.now()) {
    this.delete(key);
    if (bytes > this.maxBytes) return;
    for (const [k, v] of this.entries) if (v.expires <= now) this.delete(k);
    this.entries.set(key, { value, bytes, expires: now + this.ttl });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes)
      this.delete(this.entries.keys().next().value!);
  }
  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
  stats() {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
    };
  }
}
async function limitedJson<T>(
  fetcher: typeof fetch,
  url: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  limit: number,
) {
  const response = await fetcher(url, { signal, cache: 'no-cache' });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ContentError(
      response.status === 404
        ? 'We couldn’t find that report.'
        : `Editorial data unavailable (${response.status}).`,
      response.status,
    );
  }
  if (response.headers.get('content-type')?.includes('text/html')) {
    await response.body?.cancel();
    throw new RevisionError('Editorial asset unavailable. Please retry.');
  }
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new ContentError('Editorial response exceeds the size budget.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ContentError('Empty editorial response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ContentError('Editorial response exceeds the size budget.');
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return { value: schema.parse(JSON.parse(new TextDecoder().decode(bytes))), bytes: size };
}
export function createEditorialClient(fetcher: typeof fetch = fetch, root = '/data/editorial/v1') {
  const bodies = new LruCache<ArticleBody>(5, 512 * 1024),
    pages = new LruCache<EditorialPage>(6, 384 * 1024),
    homes = new LruCache<HomeData>(2, 192 * 1024),
    calendars = new LruCache<z.infer<typeof CalendarSchema>>(2, 16 * 1024);
  let manifest: EditorialManifest | undefined,
    manifestUntil = 0,
    sequence = 0;
  function clear() {
    bodies.clear();
    pages.clear();
    homes.clear();
    calendars.clear();
  }
  async function edition(signal: AbortSignal, force = false) {
    if (!force && manifest && Date.now() < manifestUntil) return manifest;
    const request = ++sequence;
    const result = await limitedJson(
      fetcher,
      `${root}/manifest.json`,
      ManifestSchema,
      signal,
      8192,
    );
    signal.throwIfAborted();
    if (request === sequence) {
      if (manifest?.revision !== result.value.revision) clear();
      manifest = result.value;
      manifestUntil = Date.now() + 60000;
    }
    return result.value;
  }
  async function resource<T>(signal: AbortSignal, work: (m: EditorialManifest) => Promise<T>) {
    let m = await edition(signal);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const value = await work(m);
        if (manifest && manifest.revision !== m.revision) throw new RevisionError();
        return value;
      } catch (error) {
        signal.throwIfAborted();
        if (
          attempt === 0 &&
          (error instanceof RevisionError ||
            (error instanceof ContentError && error.status === 404))
        ) {
          m = await edition(signal, true);
          continue;
        }
        throw error;
      }
    }
    throw new ContentError('Editorial deployment changed. Please retry.');
  }
  async function cached<T extends { revision: string }>(
    url: string,
    schema: z.ZodType<T>,
    cache: LruCache<T>,
    signal: AbortSignal,
    m: EditorialManifest,
    limit: number,
  ) {
    const hit = cache.get(url);
    if (hit && hit.revision === m.revision) return hit;
    const result = await limitedJson(fetcher, url, schema, signal, limit);
    signal.throwIfAborted();
    if (result.value.revision !== m.revision)
      throw new RevisionError('Editorial deployment changed. Please retry.');
    if (manifest?.revision === m.revision) cache.set(url, result.value, result.bytes);
    return result.value;
  }
  const api = {
    async page(market: MarketCode, category: EditorialFilter, page: number, signal: AbortSignal) {
      return resource(signal, async (m) => {
        const last = Math.max(1, Math.ceil(m.markets[market].counts[category] / m.pageSize));
        const requested = Math.max(1, Math.min(page, last));
        const result = await cached(
          `${root}/${m.revision}/${market}/pages/${category}/${requested}.json`,
          PageSchema,
          pages,
          signal,
          m,
          128 * 1024,
        );
        if (result.market !== market || result.category !== category || result.page !== requested)
          throw new ContentError('Editorial page mismatch.');
        return result;
      });
    },
    async home(market: MarketCode, now: Date, signal: AbortSignal) {
      return resource(signal, async (m) => {
        const day = marketDay(now, market),
          month = day.slice(0, 7),
          schedule = m.markets[market].home;
        let variant = month < (schedule.firstMonth ?? '') ? schedule.before : schedule.after;
        if (
          schedule.firstMonth &&
          schedule.lastMonth &&
          month >= schedule.firstMonth &&
          month <= schedule.lastMonth
        ) {
          const c = await cached(
            `${root}/${m.revision}/${market}/calendar/${month}.json`,
            CalendarSchema,
            calendars,
            signal,
            m,
            8192,
          );
          if (c.market !== market || c.month !== month || !c.days[day])
            throw new ContentError('Editorial calendar mismatch.');
          variant = c.days[day];
        }
        const result = await cached(
          `${root}/${m.revision}/${market}/home/${variant}.json`,
          HomeDataSchema,
          homes,
          signal,
          m,
          96 * 1024,
        );
        if (result.market !== market) throw new ContentError('Editorial market mismatch.');
        return result;
      });
    },
    async article(slug: string, market: MarketCode, signal: AbortSignal) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
        throw new ContentError('We couldn’t find that report.', 404);
      return resource(signal, async (m) => {
        const result = await cached(
          `${root}/articles/${slug}.json`,
          BodySchema,
          bodies,
          signal,
          m,
          512 * 1024,
        );
        if (
          result.article.slug !== slug ||
          result.article.market !== market ||
          result.meta.slug !== slug ||
          result.meta.market !== market
        )
          throw new ContentError('We couldn’t find that report.', 404);
        return result;
      });
    },
    async locate(slug: string, signal: AbortSignal) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
        throw new ContentError('We couldn’t find that report.', 404);
      const { value } = await limitedJson(
        fetcher,
        `${root}/resolve/${slug}.json`,
        LocatorSchema,
        signal,
        2048,
      );
      if (value.slug !== slug) throw new ContentError('Editorial link mismatch.');
      return value.market;
    },
    clear() {
      clear();
      manifest = undefined;
      manifestUntil = 0;
      sequence++;
    },
    stats() {
      return {
        bodies: bodies.stats(),
        pages: pages.stats(),
        homes: homes.stats(),
        calendars: calendars.stats(),
      };
    },
  };
  return api;
}
export const editorialClient = createEditorialClient();
// The stress build is still a production Vite build. This read-only diagnostic is absent from normal releases.
if (import.meta.env.MODE === 'editorial-test')
  Object.assign(window, { __editorialCacheStats: () => editorialClient.stats() });
