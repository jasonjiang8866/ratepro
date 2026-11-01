import { describe, it, expect, vi } from 'vitest';
import { diagnosticFetch, type HttpEvidence } from '../scripts/hdb-diagnostics';
import { retrieve } from '../scripts/retrieval';
import { fetchBytes } from '../src/lib/sync';
import { MAX_BYTES } from '../src/lib/data';

describe('read-only HTTP evidence', () => {
  it('preserves the original request and successful body without capturing secrets', async () => {
    const records: HttpEvidence[] = [];
    const response = new Response('table', { headers: { server: 'edge', 'set-cookie': 'secret' } });
    const upstream = vi.fn().mockResolvedValue(response);
    const init = { redirect: 'error' as const, credentials: 'omit' as const };
    const result = await diagnosticFetch(records, upstream)('https://example.test', init);
    expect(upstream).toHaveBeenCalledExactlyOnceWith('https://example.test', init);
    expect(result).toBe(response);
    expect(await result.text()).toBe('table');
    expect(records[0].headers).toEqual({
      server: 'edge',
      'content-type': 'text/plain;charset=UTF-8',
    });
    expect(JSON.stringify(records)).not.toContain('secret');
    expect(records[0].errorSample).toBeUndefined();
  });
  it('bounds and cancels denial bodies, retains status, and never retries 403', async () => {
    const records: HttpEvidence[] = [];
    const cancel = vi.fn();
    const upstream = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('Access Denied ' + 'x'.repeat(20000)));
          },
          cancel,
        }),
        { status: 403, headers: { 'x-request-id': 'trace-123', 'set-cookie': 'secret' } },
      ),
    );
    const pause = vi.fn();
    await expect(
      retrieve('https://example.test', diagnosticFetch(records, upstream), 1000, () => {}, pause),
    ).rejects.toMatchObject({ kind: 'http', httpStatus: 403 });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(records[0].errorSample).toMatchObject({ bytes: 8192, markers: ['Access Denied'] });
    expect(records[0].errorSample?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(records[0].headers).toEqual({ 'x-request-id': 'trace-123' });
    expect(JSON.stringify(records)).not.toContain('xxxx');
  });
  it('does not replace an HTTP denial with a diagnostic body-read error', async () => {
    const records: HttpEvidence[] = [];
    const body = new ReadableStream({
      start(c) {
        c.error(Error('body failed'));
      },
    });
    const upstream = vi.fn().mockResolvedValue(new Response(body, { status: 403 }));
    await expect(
      fetchBytes('https://example.test', diagnosticFetch(records, upstream)),
    ).rejects.toMatchObject({ kind: 'http', httpStatus: 403 });
    expect(records[0].status).toBe(403);
  });
  it('does not retry a known 403 when body cancellation fails without diagnostics', async () => {
    const body = new ReadableStream({
      cancel() {
        throw Error('cleanup failed');
      },
    });
    const upstream = vi.fn().mockResolvedValue(new Response(body, { status: 403 }));
    const pause = vi.fn();
    await expect(
      retrieve('https://example.test', upstream, 1000, () => {}, pause),
    ).rejects.toMatchObject({ kind: 'http', httpStatus: 403 });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });
  it('does not retry an oversized stream when cancellation also fails', async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(MAX_BYTES + 1));
      },
      cancel() {
        throw Error('cleanup failed');
      },
    });
    const upstream = vi.fn().mockResolvedValue(new Response(body));
    const pause = vi.fn();
    await expect(
      retrieve('https://example.test', upstream, 1000, () => {}, pause),
    ).rejects.toMatchObject({ kind: 'response', message: 'Response too large' });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });
  it('preserves transport errors without logging their potentially sensitive messages', async () => {
    const records: HttpEvidence[] = [];
    const error = new TypeError('secret proxy address');
    const upstream = vi.fn().mockRejectedValue(error);
    await expect(diagnosticFetch(records, upstream)('https://example.test')).rejects.toBe(error);
    expect(records[0].transportError).toBe('TypeError');
    expect(JSON.stringify(records)).not.toContain('secret');
  });
});
