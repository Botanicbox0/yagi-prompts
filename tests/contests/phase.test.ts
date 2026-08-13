import { describe, expect, it } from 'vitest';
import {
  comparePhaseOrder,
  contestPhase,
  contestTiming,
  daysBetweenUtc,
  PHASE_RAIL_ORDER,
} from '@/lib/contests/phase';

/**
 * PLAN §14.1 — "Phase is derived server-side: upcoming (< starts) / open (starts ≤ now < deadline)
 * / closed (≥ deadline)."
 *
 * The whole value of this module is that the two boundaries are decided ONCE and are not a matter
 * of opinion anywhere else in the codebase: the listing, the detail meta strip, the entry form's
 * server-side deadline check and the placements guard all call it. So the tests stand exactly on
 * the boundaries — one millisecond either side of each — rather than testing "a date in the future"
 * and "a date in the past".
 */

const T = (iso: string) => Date.parse(iso);
const STARTS = '2026-09-01T00:00:00.000Z';
const DEADLINE = '2026-09-30T00:00:00.000Z';
const dates = { startsAt: STARTS, deadlineAt: DEADLINE };

describe('contestPhase boundaries (§14.1)', () => {
  it('is upcoming one millisecond before the start', () => {
    expect(contestPhase(dates, T(STARTS) - 1)).toBe('upcoming');
  });

  it('is OPEN exactly at the start — §14.1 says `starts ≤ now`', () => {
    expect(contestPhase(dates, T(STARTS))).toBe('open');
  });

  it('is open one millisecond before the deadline', () => {
    expect(contestPhase(dates, T(DEADLINE) - 1)).toBe('open');
  });

  it('is CLOSED exactly at the deadline — §14.1 says `≥ deadline`', () => {
    expect(contestPhase(dates, T(DEADLINE))).toBe('closed');
  });

  it('stays closed afterwards', () => {
    expect(contestPhase(dates, T(DEADLINE) + 10 * 24 * 3600_000)).toBe('closed');
  });

  /**
   * Undated drafts. A published contest always has both instants (the DB CHECK sees to that), so
   * these two branches only ever describe a draft inside the admin preview — but the preview has to
   * render something, and "upcoming" / "open" are the honest readings of "not started" / "no end".
   */
  it('treats a missing start as upcoming', () => {
    expect(contestPhase({ startsAt: null, deadlineAt: DEADLINE }, T(STARTS))).toBe('upcoming');
  });

  it('treats a missing deadline as open once it has started', () => {
    expect(contestPhase({ startsAt: STARTS, deadlineAt: null }, T(DEADLINE))).toBe('open');
  });

  it('treats an unparseable date the same as a missing one', () => {
    expect(contestPhase({ startsAt: 'not-a-date', deadlineAt: DEADLINE }, T(STARTS))).toBe(
      'upcoming',
    );
  });
});

describe('daysBetweenUtc — the D-day unit (§14.2)', () => {
  it('counts whole UTC calendar days, not 24h windows', () => {
    // 23:59 on the 14th to 00:01 on the 15th is two minutes and one day.
    expect(daysBetweenUtc('2026-09-15T00:01:00.000Z', T('2026-09-14T23:59:00.000Z'))).toBe(1);
  });

  it('is 0 anywhere inside the same UTC day', () => {
    expect(daysBetweenUtc('2026-09-15T23:59:59.000Z', T('2026-09-15T00:00:00.000Z'))).toBe(0);
  });

  it('goes negative for a past date', () => {
    expect(daysBetweenUtc('2026-09-10T00:00:00.000Z', T('2026-09-15T12:00:00.000Z'))).toBe(-5);
  });

  it('is null when there is nothing to count to', () => {
    expect(daysBetweenUtc(null, T(STARTS))).toBeNull();
  });
});

describe('contestTiming — what the chip renders (§14.2)', () => {
  it('counts to the START while upcoming', () => {
    const timing = contestTiming(dates, T('2026-08-25T12:00:00.000Z'));
    expect(timing.phase).toBe('upcoming');
    expect(timing.daysRemaining).toBe(7);
    expect(timing.dDay).toBe('D-7');
  });

  it('counts to the DEADLINE while open', () => {
    const timing = contestTiming(dates, T('2026-09-27T00:00:00.000Z'));
    expect(timing.phase).toBe('open');
    expect(timing.dDay).toBe('D-3');
  });

  /**
   * D-DAY is "the deadline falls today in UTC", which is the ordinary reading of the convention:
   * a deadline of 23:59 on the 30th reads D-DAY all through the 30th. A deadline set at exactly
   * midnight is the awkward case and it behaves correctly too — at 23:59 on the 29th there really
   * IS one day left, so it reads D-1 (see the assertion below).
   */
  it('says D-DAY on the day the deadline falls, not D-0', () => {
    const endOfDay = { startsAt: STARTS, deadlineAt: '2026-09-30T23:59:00.000Z' };
    const timing = contestTiming(endOfDay, T('2026-09-30T09:00:00.000Z'));
    expect(timing.phase).toBe('open');
    expect(timing.daysRemaining).toBe(0);
    expect(timing.dDay).toBe('D-DAY');
  });

  it('reads D-1 one millisecond before a midnight deadline', () => {
    const timing = contestTiming(dates, T(DEADLINE) - 1);
    expect(timing.phase).toBe('open');
    expect(timing.dDay).toBe('D-1');
  });

  it('has no countdown once closed — the page says 결과 instead', () => {
    const timing = contestTiming(dates, T('2026-10-05T00:00:00.000Z'));
    expect(timing.phase).toBe('closed');
    expect(timing.daysRemaining).toBeNull();
    expect(timing.dDay).toBeNull();
  });

  it('never renders a negative countdown', () => {
    // An undated-start draft cannot produce one, but a hand-edited row could; the chip must not
    // read "D--1" if the phase and the clock ever disagree.
    const timing = contestTiming({ startsAt: null, deadlineAt: null }, T(STARTS));
    expect(timing.dDay).toBeNull();
  });
});

describe('rail ordering (§14.2)', () => {
  it('puts open first, then upcoming, then closed', () => {
    expect(PHASE_RAIL_ORDER).toEqual(['open', 'upcoming', 'closed']);
  });

  const card = (slug: string, startsAt: string | null, deadlineAt: string | null) => ({
    slug,
    startsAt,
    deadlineAt,
  });

  it('orders OPEN by soonest deadline — the one you can still miss', () => {
    const a = card('a', STARTS, '2026-09-20T00:00:00.000Z');
    const b = card('b', STARTS, '2026-09-10T00:00:00.000Z');
    expect([a, b].sort((x, y) => comparePhaseOrder('open', x, y)).map((c) => c.slug)).toEqual([
      'b',
      'a',
    ]);
  });

  it('orders UPCOMING by soonest start', () => {
    const a = card('a', '2026-10-01T00:00:00.000Z', DEADLINE);
    const b = card('b', '2026-09-20T00:00:00.000Z', DEADLINE);
    expect([a, b].sort((x, y) => comparePhaseOrder('upcoming', x, y)).map((c) => c.slug)).toEqual([
      'b',
      'a',
    ]);
  });

  it('orders CLOSED by most recent deadline', () => {
    const a = card('a', STARTS, '2026-08-01T00:00:00.000Z');
    const b = card('b', STARTS, '2026-09-01T00:00:00.000Z');
    expect([a, b].sort((x, y) => comparePhaseOrder('closed', x, y)).map((c) => c.slug)).toEqual([
      'b',
      'a',
    ]);
  });

  it('breaks ties on slug, so a page rendered twice is the same page', () => {
    const a = card('zulu', STARTS, DEADLINE);
    const b = card('alpha', STARTS, DEADLINE);
    expect([a, b].sort((x, y) => comparePhaseOrder('open', x, y)).map((c) => c.slug)).toEqual([
      'alpha',
      'zulu',
    ]);
  });
});
