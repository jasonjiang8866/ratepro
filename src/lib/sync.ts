import { SOURCES, FeedSchema, type Cache, type Feed, type SourceStatus } from './schema';
import { mergeFeed, MAX_BYTES, REFRESH_INTERVAL } from './data';
import { browserPage, parsers } from './parsers';
export async function fetchText(url: string, fetcher: typeof fetch = fetch): Promise<string> {
  const res = await fetcher(url, {
    signal: AbortSignal.timeout(12000),
    credentials: 'omit',
    cache: 'no-cache',
    redirect: 'error',
  });
  if (!res.ok) throw Error(`HTTP ${res.status}`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw Error('Response too large');
  // Bound streamed responses too, including those without Content-Length.
  if (!res.body) throw Error('Empty response');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw Error('Response too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(bytes);
}
export async function synchronize(
  cache: Cache,
  force = false,
  fetcher: typeof fetch = fetch,
  onSnapshot?: (cache: Cache) => void,
): Promise<{ cache: Cache; message: string }> {
  const now = new Date().toISOString();
  if (!force && cache.lastAttempt && Date.now() - Date.parse(cache.lastAttempt) < REFRESH_INTERVAL)
    return {
      cache,
      message: 'Using your saved rates. Automatic checks run at most every 6 hours.',
    };
  let next = { ...cache, lastAttempt: now };
  let feedOK = false;
  const errors: string[] = [];
  try {
    const feed = FeedSchema.parse(JSON.parse(await fetchText('/data/rates.json', fetcher)));
    next = { ...mergeFeed(next, feed, now), lastFeedCheck: now, lastAttempt: now };
    feedOK = true;
    // Render and persist the same-origin snapshot before slow cross-origin requests finish.
    onSnapshot?.(next);
  } catch {
    errors.push('Published feed unavailable');
  }
  // All sources are allowlisted public pages; no credentials or proxy are used.
  const results = await Promise.all(
    SOURCES.map(async (source) => {
      try {
        const offers = parsers[source.id](
          browserPage(await fetchText(source.url, fetcher)),
          now,
          'browser',
        );
        return {
          offers,
          status: {
            sourceId: source.id,
            attemptedAt: now,
            successAt: now,
            status: 'ok',
            message: 'Read directly from the public source',
          } as SourceStatus,
        };
      } catch {
        return {
          offers: [],
          status: {
            sourceId: source.id,
            attemptedAt: now,
            successAt: next.sources.find((s) => s.sourceId === source.id)?.successAt,
            status: 'error',
            message:
              'Direct browser check unavailable (CORS, network or page format). Last observation retained.',
          } as SourceStatus,
        };
      }
    }),
  );
  const direct: Feed = {
    version: 1,
    generatedAt: now,
    offers: results.flatMap((r) => r.offers),
    sources: results.map((r) => r.status),
  };
  next = { ...mergeFeed(next, direct, now), lastAttempt: now };
  const count = results.filter((r) => r.status.status === 'ok').length;
  return {
    cache: next,
    message: count
      ? `Checked ${count} public source${count === 1 ? '' : 's'} directly. ${SOURCES.length - count} unavailable.`
      : feedOK
        ? 'Published snapshot checked. Direct source access unavailable; observation dates are shown below.'
        : `${errors.join('. ')}. Showing saved data; retry when online.`,
  };
}
