import { describe, expect, it } from 'vitest';
import { CodecReclaimed, MAX_RESTARTS, ReclaimedTooOften, isReclaim, runWithRestarts, whenVisible, type VisibilitySource } from '@/lib/brand-studio/editor-v2/export-run';

/**
 * Spec G, A2: a hidden page's encoder taken back by the browser (QuotaExceededError, measured in A1) ends the
 * attempt; the export waits until the page is visible and runs again from frame 0, at most three times.
 */
class FakeDocument implements VisibilitySource {
  visibilityState: DocumentVisibilityState = 'hidden';
  private listeners = new Set<() => void>();
  addEventListener(_: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.add(listener as () => void);
  }
  removeEventListener(_: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.delete(listener as () => void);
  }
  show() {
    this.visibilityState = 'visible';
    for (const listener of [...this.listeners]) listener();
  }
  get waiting() {
    return this.listeners.size;
  }
}

class Cancelled extends Error {}

describe('an export whose encoder the browser took back starts again once the page is visible', () => {
  it('a reclaim once: the second attempt is the result, after waiting for the page to be visible', async () => {
    const doc = new FakeDocument();
    const seen: string[] = [];
    const run = runWithRestarts(
      async (restarts) => {
        seen.push(`attempt ${restarts} ${doc.visibilityState}`);
        if (restarts === 0) throw new CodecReclaimed('video');
        return 'file';
      },
      () => whenVisible(doc, undefined, () => new Cancelled()),
      { onRestart: (n) => seen.push(`restart ${n}`) },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(doc.waiting).toBe(1);
    doc.show();
    await expect(run).resolves.toEqual({ result: 'file', restarts: 1 });
    expect(seen).toEqual(['attempt 0 hidden', 'restart 1', 'attempt 1 visible']);
    expect(doc.waiting).toBe(0);
  });

  it('reclaimed four times: it gives up after three restarts and says how many times', async () => {
    let attempts = 0;
    const outcome = runWithRestarts(
      async () => {
        attempts += 1;
        throw new CodecReclaimed('video');
      },
      async () => undefined,
    );
    await expect(outcome).rejects.toBeInstanceOf(ReclaimedTooOften);
    await expect(outcome).rejects.toMatchObject({ reclaims: 4, codec: 'video' });
    expect(attempts).toBe(MAX_RESTARTS + 1);
  });

  it('cancelled while it waits for the page: it ends at once, cancelled, and does not start again', async () => {
    const doc = new FakeDocument();
    const controller = new AbortController();
    let attempts = 0;
    const run = runWithRestarts(
      async () => {
        attempts += 1;
        throw new CodecReclaimed('video');
      },
      () => whenVisible(doc, controller.signal, () => new Cancelled()),
    );
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(run).rejects.toBeInstanceOf(Cancelled);
    expect(attempts).toBe(1);
    expect(doc.waiting).toBe(0);
  });

  it('any other error is not retried', async () => {
    let attempts = 0;
    const failure = new Error('the encoder failed');
    await expect(
      runWithRestarts(
        async () => {
          attempts += 1;
          throw failure;
        },
        async () => undefined,
      ),
    ).rejects.toBe(failure);
    expect(attempts).toBe(1);
  });

  it('only a QuotaExceededError is a reclaim', () => {
    expect(isReclaim(new DOMException('Codec reclaimed due to inactivity.', 'QuotaExceededError'))).toBe(true);
    expect(isReclaim(new DOMException("Cannot call 'encode' on a closed codec.", 'InvalidStateError'))).toBe(false);
    expect(isReclaim(new Error('QuotaExceededError'))).toBe(false);
    expect(isReclaim(null)).toBe(false);
  });

  it('a visible page is not waited for', async () => {
    const doc = new FakeDocument();
    doc.visibilityState = 'visible';
    await expect(whenVisible(doc, undefined, () => new Cancelled())).resolves.toBeUndefined();
    expect(doc.waiting).toBe(0);
  });
});
