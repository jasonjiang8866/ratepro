import { createHash } from 'node:crypto';

// Read-only investigation. Observe the original request; never change its headers,
// network path, redirect policy or retry budget. Never log cookies or raw bodies.
const headerNames = [
  'server',
  'content-type',
  'content-length',
  'date',
  'via',
  'x-cache',
  'cf-ray',
  'cf-mitigated',
  'x-amz-cf-id',
  'x-amz-cf-pop',
  'x-request-id',
  'retry-after',
] as const;
const MAX_ERROR_SAMPLE = 8192;
export interface HttpEvidence {
  url: string;
  attemptedAt: string;
  elapsedMs: number;
  status?: number;
  headers?: Record<string, string>;
  errorSample?: { bytes: number; sha256: string; markers: string[] };
  transportError?: string;
}
export function diagnosticFetch(
  records: HttpEvidence[],
  fetcher: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const started = Date.now();
    const record: HttpEvidence = {
      url: String(input),
      attemptedAt: new Date(started).toISOString(),
      elapsedMs: 0,
    };
    records.push(record);
    try {
      const response = await fetcher(input, init);
      record.status = response.status;
      record.headers = Object.fromEntries(
        headerNames.flatMap((name) => {
          const value = response.headers.get(name);
          return value === null
            ? []
            : [[name, value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 256)]];
        }),
      );
      // The collector discards unsuccessful bodies. Consume only a bounded prefix
      // for reproducible denial fingerprints, then cancel; successful bodies stay untouched.
      if (!response.ok && response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (size < MAX_ERROR_SAMPLE) {
            const { done, value } = await reader.read();
            if (done) break;
            const part = value.subarray(0, MAX_ERROR_SAMPLE - size);
            chunks.push(part);
            size += part.length;
          }
          const bytes = Buffer.concat(chunks);
          const text = bytes.toString('utf8');
          record.errorSample = {
            bytes: size,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            markers: [
              'Access Denied',
              'Request blocked',
              'CloudFront',
              'Connection Unsuccessful',
              'captcha',
            ].filter((marker) => text.toLowerCase().includes(marker.toLowerCase())),
          };
        } catch {
          /* Diagnostic read failure must not hide the original HTTP status. */
        } finally {
          try {
            await reader.cancel();
          } catch {
            /* Preserve the original status. */
          }
          reader.releaseLock();
        }
      }
      return response;
    } catch (error) {
      // Do not include error messages/causes which can contain environment URLs.
      record.transportError =
        error instanceof Error && /^(TimeoutError|AbortError|TypeError)$/.test(error.name)
          ? error.name
          : 'Error';
      throw error;
    } finally {
      record.elapsedMs = Date.now() - started;
    }
  };
}
