import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PULSE_FAST_MS, PULSE_QUIET_AFTER_MS, PULSE_SLOW_MS, changedParts, startPulse, type PulseAnswer } from '@/components/brand-rooms/pulse';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §11 — the open screen's pulse, driven with fake timers: the first answer is
 * only a baseline, a moved part is handed over (and only that part), a hidden tab asks nothing and asks at
 * once when shown, ten quiet minutes slow it to 15 seconds and a change makes it quick again, and a door
 * that says "not here" stops it for good while a passing failure does not.
 */
type Stamp = { chat: string; reviews: string };

let visible = true;
beforeEach(() => {
  vi.useFakeTimers();
  visible = true;
  // The tests run without a DOM: a document that only knows whether it is visible.
  const doc = new EventTarget() as EventTarget & { visibilityState: string };
  Object.defineProperty(doc, 'visibilityState', { get: () => (visible ? 'visible' : 'hidden') });
  vi.stubGlobal('document', doc);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function harness(answers: Array<PulseAnswer<Stamp> | Error>) {
  const reads: number[] = [];
  const changes: Array<string[]> = [];
  let stopped = 0;
  let i = 0;
  const stop = startPulse<Stamp>({
    read: async () => {
      reads.push(Date.now());
      const next = answers[Math.min(i, answers.length - 1)]!;
      i += 1;
      if (next instanceof Error) throw next;
      return next;
    },
    onChange: (changed) => changes.push(changed),
    onStop: () => {
      stopped += 1;
    },
    visible: () => visible,
  });
  return { reads, changes, stop, stopped: () => stopped };
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

const ok = (chat: string, reviews: string): PulseAnswer<Stamp> => ({ ok: true, stamp: { chat, reviews } });

describe('the pulse', () => {
  it('reads at once as a baseline, then every 5 seconds, and hands over only the parts that moved', async () => {
    const h = harness([ok('c1', 'r1'), ok('c1', 'r1'), ok('c1', 'r2'), ok('c2', 'r2')]);
    await advance(0);
    expect(h.reads.length).toBe(1);
    expect(h.changes).toEqual([]);
    await advance(PULSE_FAST_MS);
    expect(h.reads.length).toBe(2);
    expect(h.reads[1]! - h.reads[0]!).toBe(PULSE_FAST_MS);
    expect(h.changes).toEqual([]);
    await advance(PULSE_FAST_MS);
    expect(h.changes).toEqual([['reviews']]);
    await advance(PULSE_FAST_MS);
    expect(h.changes).toEqual([['reviews'], ['chat']]);
    h.stop();
  });

  it('asks nothing while the tab is hidden and asks at once when it is shown', async () => {
    const h = harness([ok('c', 'r'), ok('c', 'r2')]);
    await advance(0);
    visible = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(PULSE_FAST_MS * 10);
    expect(h.reads.length).toBe(1);
    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(0);
    expect(h.reads.length).toBe(2);
    expect(h.changes).toEqual([['reviews']]);
    h.stop();
  });

  it('slows to 15 seconds after ten quiet minutes and speeds up after a change', async () => {
    let n: number;
    const answers: Array<PulseAnswer<Stamp>> = [];
    for (let k = 0; k < 400; k += 1) answers.push(ok('c', 'r'));
    const h = harness(answers);
    await advance(0);
    await advance(PULSE_QUIET_AFTER_MS);
    const atQuiet = h.reads.length;
    await advance(PULSE_FAST_MS);
    // Past ten minutes: the next read waits 15 seconds.
    const gaps = h.reads.slice(atQuiet - 1).map((t, i, all) => (i ? t - all[i - 1]! : 0)).slice(1);
    expect(gaps.every((g) => g === PULSE_SLOW_MS || g === PULSE_FAST_MS)).toBe(true);
    await advance(PULSE_SLOW_MS * 3);
    const tail = h.reads.slice(-3);
    expect(tail[2]! - tail[1]!).toBe(PULSE_SLOW_MS);
    n = h.reads.length;
    h.stop();
    expect(n).toBeGreaterThan(100);
  });

  it('comes back to 5 seconds after a change', async () => {
    const answers: Array<PulseAnswer<Stamp>> = [];
    for (let k = 0; k < 130; k += 1) answers.push(ok('c', 'r'));
    answers.push(ok('c', 'moved'));
    for (let k = 0; k < 20; k += 1) answers.push(ok('c', 'moved'));
    const h = harness(answers);
    await advance(0);
    await advance(PULSE_QUIET_AFTER_MS + PULSE_SLOW_MS * 12);
    expect(h.changes).toEqual([['reviews']]);
    const before = h.reads.length;
    await advance(PULSE_FAST_MS);
    expect(h.reads.length).toBe(before + 1);
    h.stop();
  });

  it('stops for good on "not here", and keeps going after a passing failure', async () => {
    const h = harness([ok('c', 'r'), new Error('network'), { ok: false, stop: false }, ok('c', 'r'), { ok: false, stop: true }, ok('x', 'y')]);
    await advance(0);
    for (let k = 0; k < 4; k += 1) await advance(PULSE_FAST_MS);
    expect(h.reads.length).toBe(5);
    expect(h.stopped()).toBe(1);
    await advance(PULSE_FAST_MS * 10);
    expect(h.reads.length).toBe(5);
    expect(h.changes).toEqual([]);
    h.stop();
  });

  it('stops when the screen goes away', async () => {
    const h = harness([ok('c', 'r')]);
    await advance(0);
    h.stop();
    await advance(PULSE_FAST_MS * 5);
    expect(h.reads.length).toBe(1);
  });

  it('compares parts, a missing part counting as moved', () => {
    expect(changedParts({ a: '1', b: '2' }, { a: '1', b: '3' })).toEqual(['b']);
    expect(changedParts({ a: '1' }, { a: '1', b: null })).toEqual([]);
    expect(changedParts({ a: '1' }, { a: '1', b: 'x' })).toEqual(['b']);
  });
});
