import { SOURCES, FeedSchema, type Cache, type Feed, type SourceStatus } from './schema';
import { mergeFeed, MAX_BYTES, REFRESH_INTERVAL } from './data';
import { browserPage, parsers } from './parsers';
export async function fetchText(
  url: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 12000,
): Promise<string> {
  return new TextDecoder().decode(await fetchBytes(url, fetcher, timeoutMs));
}
export class RetrievalError extends Error {
  constructor(
    message: string,
    public kind: 'http' | 'timeout' | 'network' | 'response',
    public httpStatus?: number,
  ) {
    super(message);
  }
}
export async function fetchBytes(
  url: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 12000,
): Promise<Uint8Array> {
  try {
    const res = await fetcher(url, {
      signal: AbortSignal.timeout(timeoutMs),
      credentials: 'omit',
      cache: 'no-cache',
      redirect: 'error',
    });
    if (!res.ok) {
      // Cleanup failure must not turn a known HTTP denial/size rejection into
      // a retryable network failure.
      await res.body?.cancel().catch(() => {});
      throw new RetrievalError(`HTTP ${res.status}`, 'http', res.status);
    }
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) {
      // Cleanup failure must not turn a known HTTP denial/size rejection into
      // a retryable network failure.
      await res.body?.cancel().catch(() => {});
      throw new RetrievalError('Response too large', 'response');
    }
    // Bound streamed responses too, including those without Content-Length.
    if (!res.body) throw new RetrievalError('Empty response', 'response');
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) throw new RetrievalError('Response too large', 'response');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    return bytes;
  } catch (error) {
    if (error instanceof RetrievalError) throw error;
    if (error instanceof Error && /TimeoutError|AbortError/.test(error.name))
      throw new RetrievalError('Request timed out', 'timeout');
    const cause =
      error instanceof Error ? String((error.cause as Error | undefined)?.message ?? '') : '';
    if (/redirect|certificate|TLS/i.test(cause))
      throw new RetrievalError('Redirect or TLS response rejected', 'response');
    throw new RetrievalError('Network request failed', 'network');
  }
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
    next = {
      ...mergeFeed(next, feed, now),
      lastFeedCheck: now,
      lastAttempt: now,
      ...(!next.snapshotGeneratedAt ||
      Date.parse(feed.generatedAt) >= Date.parse(next.snapshotGeneratedAt)
        ? { snapshotGeneratedAt: feed.generatedAt, publishedSources: feed.sources }
        : {}),
    };
    feedOK = true;
    // Render and persist the same-origin snapshot before slow cross-origin requests finish.
    onSnapshot?.(next);
  } catch {
    errors.push('Published feed unavailable');
  }
  // All sources are allowlisted public pages; no credentials or proxy are used.
  const results = await Promise.all(
    SOURCES.filter((source) => !('collectorOnly' in source && source.collectorOnly)).map(
      async (source) => {
        try {
          const offers = parsers[source.id as keyof typeof parsers](
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
              successAt: next.browserSources?.find((s) => s.sourceId === source.id)?.successAt,
              status: 'error',
              message:
                'Direct browser check unavailable (CORS, network or page format). Last observation retained.',
            } as SourceStatus,
          };
        }
      },
    ),
  );
  const direct: Feed = {
    version: 1,
    generatedAt: now,
    offers: results.flatMap((r) => r.offers),
    sources: results.map((r) => r.status),
  };
  next = { ...mergeFeed(next, direct, now), lastAttempt: now, browserSources: direct.sources };
  const count = results.filter((r) => r.status.status === 'ok').length;
  return {
    cache: next,
    message: count
      ? `Checked ${count} public source${count === 1 ? '' : 's'} directly. ${SOURCES.filter((s) => !('collectorOnly' in s)).length - count} unavailable. PDF observations use the published snapshot.`
      : feedOK
        ? 'Published snapshot checked. Direct source access unavailable; observation dates are shown below.'
        : `${errors.join('. ')}. Showing saved data; retry when online.`,
  };
}
