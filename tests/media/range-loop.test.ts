import { describe, expect, it } from 'vitest';
import { RANGE_LOOP_SLACK, rangeLoopReducer, rangeLoopSeek, type RangeLoop } from '@/lib/media/range-loop';

/**
 * docs/PERSONAL-STUDIO.md §3.4.4 (T1a) — tapping a fixed part replays its range: seek to `from`, play, jump back at
 * `to`. Tapping it again, tapping a normal beat or pressing pause clears the loop.
 */

const hair = { type: 'tap', id: 'hair', from: 3, to: 6 } as const;

describe('rangeLoopReducer', () => {
  it('sets a loop on a tap', () => {
    expect(rangeLoopReducer(null, hair)).toEqual({ id: 'hair', from: 3, to: 6 });
  });

  it('clears it when the same part is tapped again', () => {
    expect(rangeLoopReducer(rangeLoopReducer(null, hair), hair)).toBeNull();
  });

  it('moves to another part on its tap', () => {
    const next = rangeLoopReducer(rangeLoopReducer(null, hair), { type: 'tap', id: 'product', from: 0.5, to: 2 });
    expect(next).toEqual({ id: 'product', from: 0.5, to: 2 });
  });

  it('clears on a beat tap, on pause and on reset', () => {
    const on = rangeLoopReducer(null, hair);
    expect(rangeLoopReducer(on, { type: 'beat' })).toBeNull();
    expect(rangeLoopReducer(on, { type: 'pause' })).toBeNull();
    expect(rangeLoopReducer(on, { type: 'reset' })).toBeNull();
    expect(rangeLoopReducer(null, { type: 'pause' })).toBeNull();
  });

  it('refuses a tap with no start', () => {
    expect(rangeLoopReducer(null, { type: 'tap', id: 'sound', from: Number.NaN, to: null })).toBeNull();
  });
});

describe('rangeLoopSeek', () => {
  const loop: RangeLoop = { id: 'hair', from: 3, to: 6 };

  it('leaves playback alone inside the range', () => {
    for (const t of [3, 4.2, 5.9]) expect(rangeLoopSeek(loop, t), String(t)).toBeNull();
    expect(rangeLoopSeek(loop, 3 - RANGE_LOOP_SLACK + 0.01)).toBeNull();
  });

  it('wraps to `from` at `to` and after it', () => {
    expect(rangeLoopSeek(loop, 6)).toBe(3);
    expect(rangeLoopSeek(loop, 7.5)).toBe(3);
  });

  it('brings playback back when the clip itself loops to the start', () => {
    expect(rangeLoopSeek(loop, 0.04)).toBe(3);
  });

  it('never wraps a mark with no end, and nothing without a loop', () => {
    expect(rangeLoopSeek({ id: 'sound', from: 2, to: null }, 9)).toBeNull();
    expect(rangeLoopSeek(null, 9)).toBeNull();
    expect(rangeLoopSeek(loop, Number.NaN)).toBeNull();
  });
});
