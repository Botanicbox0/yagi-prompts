import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveMailer } from '@/lib/notify/mailer-live';

/**
 * Release review L3: the deadline on the brand receipt is a real AbortSignal. This pins that the
 * pinned resend SDK forwards it to the HTTP request (its PostOptions type does not declare it), so
 * an SDK upgrade that drops the passthrough fails here. `fetch` is stubbed; nothing leaves the machine.
 */
describe('live mailer abort signal', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const message = { to: 'brand@example.test', subject: 's', html: '<p>h</p>', text: 't', idempotencyKey: 'k:1', unsubscribeUrl: 'https://twings.app/ko/campaigns' };

  it('passes the signal to fetch and reports an aborted send as not sent', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return new Response(JSON.stringify({ id: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const mailer = createLiveMailer({ apiKey: 're_test_placeholder_key', from: 'TWINGS <hello@example.test>' });

    const controller = new AbortController();
    controller.abort();
    const aborted = await mailer.send({ ...message, signal: controller.signal });
    expect(calls[0]?.signal).toBe(controller.signal);
    expect(aborted.ok).toBe(false);

    const sent = await mailer.send(message);
    expect(sent).toEqual({ ok: true, id: 'x' });
    expect(calls[1]?.signal).toBeUndefined();
  });
});
