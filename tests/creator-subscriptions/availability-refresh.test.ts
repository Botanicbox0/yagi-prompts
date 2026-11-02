import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSubscriptionAvailabilityRefresh } from '@/components/twings/subscription-availability';

const ready = { status: 'open', version: 'verified', plans: { creator: { status: 'open' }, premium: { status: 'preparing' } }, editing: 'preparing' };

describe('visible public subscription status refresh', () => {
  let page: EventTarget & { visibilityState: string };
  let browser: EventTarget;
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    browser = new EventTarget();
    vi.stubGlobal('document', page);
    vi.stubGlobal('window', browser);
  });
  afterEach(() => {
    stop?.(); stop = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('refreshes every 60 seconds while visible and pauses network reads while hidden', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ready });
    vi.stubGlobal('fetch', fetcher);
    const changed = vi.fn();
    stop = startSubscriptionAvailabilityRefresh(changed);
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenLastCalledWith(ready);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
    page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('shares one in-flight read across focus, pageshow, and polling and cleans up on unmount', async () => {
    let finish: ((value: { ok: boolean; json: () => Promise<typeof ready> }) => void) | undefined;
    const fetcher = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    const changed = vi.fn();
    stop = startSubscriptionAvailabilityRefresh(changed);
    browser.dispatchEvent(new Event('focus'));
    browser.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const signal = fetcher.mock.calls[0]?.[1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    stop(); stop = undefined;
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    finish?.({ ok: true, json: async () => ready });
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).not.toHaveBeenCalled();
    browser.dispatchEvent(new Event('focus'));
    browser.dispatchEvent(new Event('pageshow'));
    page.dispatchEvent(new Event('visibilitychange'));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('aborts a hidden read and ignores its late response when a visible read returns a pause', async () => {
    let late: ((value: { ok: boolean; json: () => Promise<typeof ready> }) => void) | undefined;
    const paused = { ...ready, status: 'paused', plans: { creator: { status: 'paused' }, premium: { status: 'paused' } } };
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { late = resolve; })).mockResolvedValue({ ok: true, json: async () => paused });
    vi.stubGlobal('fetch', fetcher);
    const changed = vi.fn();
    stop = startSubscriptionAvailabilityRefresh(changed);
    const signal = fetcher.mock.calls[0]?.[1].signal as AbortSignal;
    page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange'));
    expect(signal.aborted).toBe(true);
    page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenCalledExactlyOnceWith(paused);
    late?.({ ok: true, json: async () => ready });
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenCalledExactlyOnceWith(paused);
  });
});
