import { fetchBytes, RetrievalError } from '../src/lib/sync';

export function transient(error: unknown) {
  return (
    error instanceof RetrievalError &&
    (error.kind === 'timeout' ||
      error.kind === 'network' ||
      (error.kind === 'http' && [408, 500, 502, 503, 504].includes(error.httpStatus ?? 0)))
  );
}
// At most one delayed retry, using the same URL, network path and client.
// Access denials, rate limits, redirects, oversized bodies and parser errors are not retried.
export async function retrieve(
  url: string,
  fetcher: typeof fetch,
  timeout: number,
  onAttempt: (attempt: number) => void,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    onAttempt(attempt);
    try {
      return await fetchBytes(url, fetcher, timeout);
    } catch (error) {
      if (attempt === 2 || !transient(error)) throw error;
      await pause(2000);
    }
  }
  throw Error('Retrieval exhausted');
}
