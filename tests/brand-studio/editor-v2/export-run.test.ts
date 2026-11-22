import { describe, expect, it } from 'vitest';
import { CodecReclaimed, MAX_RESTARTS, ReclaimedTooOften, isReclaim, restartBudget, restarter, runWithRestarts, whenVisible, type VisibilitySource } from '@/lib/brand-studio/editor-v2/export-run';

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

describe('spec H, F4: one restart budget for the whole export, pictures and sound together', () => {
  it('two restarts for the pictures leave one for the sound; a second for the sound is one too many', async () => {
    const budget = restartBudget();
    let video = 0;
    const pictures = await runWithRestarts(
      async () => {
        video += 1;
        if (video <= 2) throw new CodecReclaimed('video');
        return 'pictures';
      },
      async () => undefined,
      { budget },
    );
    expect(pictures).toEqual({ result: 'pictures', restarts: 2 });
    let sound = 0;
    const outcome = runWithRestarts(
      async () => {
        sound += 1;
        throw new CodecReclaimed('audio');
      },
      async () => undefined,
      { budget },
    );
    await expect(outcome).rejects.toMatchObject({ name: 'ReclaimedTooOften', reclaims: 4, codec: 'audio' });
    expect(sound).toBe(2);
    expect(budget.used).toBe(MAX_RESTARTS);
  });
});

describe('spec H, F6: no restart is announced after a cancel', () => {
  it('reclaimed, but the export was already cancelled: onRestart is not called, the wait answers with the cancel', async () => {
    const controller = new AbortController();
    controller.abort();
    const doc = new FakeDocument();
    const announced: number[] = [];
    const outcome = runWithRestarts(
      async () => {
        throw new CodecReclaimed('video');
      },
      () => whenVisible(doc, controller.signal, () => new Cancelled()),
      { onRestart: (n) => announced.push(n), aborted: () => controller.signal.aborted, cancelled: () => new Cancelled() },
    );
    await expect(outcome).rejects.toBeInstanceOf(Cancelled);
    expect(announced).toEqual([]);
  });
});

describe('spec I, G3: a cancel after the budget is spent is a cancel', () => {
  it('three restarts used, then the person cancels and that attempt ends reclaimed: the export’s cancel, not "gave up"', async () => {
    let cancelledNow = false;
    const announced: Array<[string, number]> = [];
    const restarting = restarter({
      waitVisible: async () => undefined,
      aborted: () => cancelledNow,
      cancelled: () => new Cancelled(),
      announce: (phase, n) => announced.push([phase, n]),
    });
    let video = 0;
    await expect(restarting.run('video', async () => (++video <= MAX_RESTARTS ? Promise.reject(new CodecReclaimed('video')) : 'pictures'))).resolves.toBe('pictures');
    expect(restarting.used).toBe(MAX_RESTARTS);
    cancelledNow = true;
    await expect(restarting.run('audio', async () => Promise.reject(new CodecReclaimed('audio')))).rejects.toBeInstanceOf(Cancelled);
    expect(announced).toHaveLength(MAX_RESTARTS);
    expect(restarting.used).toBe(MAX_RESTARTS);
  });
});

describe('spec H, F4: the export’s restarter (what export-film.ts uses)', () => {
  it('one budget across the pictures and the sound; each restart announced with its part; used is the export’s count', async () => {
    const announced: Array<[string, number]> = [];
    const restarting = restarter({ waitVisible: async () => undefined, aborted: () => false, cancelled: () => new Cancelled(), announce: (phase, n) => announced.push([phase, n]) });
    let video = 0;
    await expect(restarting.run('video', async () => (++video <= 2 ? Promise.reject(new CodecReclaimed('video')) : 'pictures'))).resolves.toBe('pictures');
    await expect(restarting.run('audio', async () => Promise.reject(new CodecReclaimed('audio')))).rejects.toMatchObject({ name: 'ReclaimedTooOften', reclaims: 4 });
    expect(announced).toEqual([['video', 1], ['video', 2], ['audio', 3]]);
    expect(restarting.used).toBe(3);
  });
});
