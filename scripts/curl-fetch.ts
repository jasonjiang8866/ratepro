import { execFile } from 'node:child_process';
import { MAX_BYTES } from '../src/lib/data';
import { RetrievalError } from '../src/lib/sync';

// UOB succeeds with curl where Node returned HTTP 500. Maybank's local curl
// success does not establish GitHub availability: HTTP/1.1 still timed out there.
// No proxy, cookie, custom UA or TLS override.
export const curlFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (
    ![
      'https://www.maybank2u.com.sg/en/rates/rates-sora.page',
      'https://www.uob.com.sg/personal/borrow/property-loans/about-sora.page',
    ].includes(url)
  )
    throw new RetrievalError('Unexpected curl URL', 'response');
  const output = await new Promise<Buffer>((resolve, reject) => {
    execFile(
      'curl',
      [
        ...(url.includes('maybank2u.com.sg') ? ['--http1.1'] : []),
        '--silent',
        '--show-error',
        '--max-time',
        '30',
        '--max-filesize',
        String(MAX_BYTES),
        '--proto',
        '=https',
        '--write-out',
        '\n%{http_code}',
        url,
      ],
      {
        encoding: 'buffer',
        maxBuffer: MAX_BYTES + 512,
        timeout: 35000,
        signal: init?.signal ?? undefined,
      },
      (error, stdout) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const code = String(error.code);
        reject(
          new RetrievalError(
            code === '28' || error.name === 'AbortError'
              ? 'Request timed out'
              : `curl transport failed (exit ${code})`,
            code === '28' || error.name === 'AbortError'
              ? 'timeout'
              : ['5', '6', '7', '18', '52', '56'].includes(code)
                ? 'network'
                : 'response',
          ),
        );
      },
    );
  });
  const status = Number(output.subarray(-3).toString());
  if (!Number.isInteger(status) || status < 200 || status > 599)
    throw new RetrievalError('Invalid curl HTTP response', 'response');
  if (status >= 300 && status < 400) throw new RetrievalError('Redirect rejected', 'response');
  return new Response(new Uint8Array(output.subarray(0, -4)), { status });
};
