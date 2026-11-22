import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec G B1 / spec H F8: the export's waits, as behaviour. The shared reads (frame facts, picture index) are
 * waited for until cancel or a limit and never aborted (watched-read.test.ts `waitShared`), once per export
 * (`sharedWaits`, spec H F6); the run reads end on a stall, after their size's time, or on cancel
 * (sample-bytes.test.ts, sound-reads.test.ts); a picture request ends when one of its waits does
 * (frame-decoder-limits.test.ts). Here: the clip's own request carries the abort signal it is given.
 */
afterEach(() => vi.unstubAllGlobals());

describe('the clip’s own request', () => {
  it('asks the clip’s address for the range, cookies on this site only, with the signal it is given', async () => {
    const calls: Array<[string, RequestInit]> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => (calls.push([url, init]), new Response(new Uint8Array(10), { status: 206 }))));
    const { footageBytes } = await import('@/components/brand-studio/editor-v2/footage-facts');
    const controller = new AbortController();
    await footageBytes('/media/a.mp4')(0, 9, controller.signal);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('/media/a.mp4');
    expect(calls[0]![1]).toMatchObject({ headers: { Range: 'bytes=0-9' }, credentials: 'same-origin' });
    expect(calls[0]![1].signal).toBe(controller.signal);
  });
});
