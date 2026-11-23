import { describe, expect, it } from 'vitest';
import {
  cycleContaining,
  cycleDays,
  cycleStartAt,
  cycleWindow,
  kstDayStartUtc,
  nextCycleStart,
} from '@/lib/brands/billing/cycle';
import { addCalendarDays, daysInYearMonth, kstDayOf } from '@/lib/brands/billing/math';

/**
 * B1c-1 §1: the billing cycle is one month from the plan start day (founder decision 2026-11-24). A start day the
 * month lacks becomes that month's last day and comes back in the next month that has it (Stripe's documented
 * behaviour, https://docs.stripe.com/billing/subscriptions/billing-cycle). Dates are KST calendar dates.
 */
describe('cycleStartAt', () => {
  it('anchor on the 31st: Jan 31 → Feb 28 (2027) → Mar 31 → Apr 30; Feb 29 in a leap year', () => {
    expect([0, 1, 2, 3, 4].map((i) => cycleStartAt('2027-01-31', i))).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
    expect([0, 1, 2].map((i) => cycleStartAt('2028-01-31', i))).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  it('anchors on the 29th and 30th', () => {
    expect([0, 1, 2].map((i) => cycleStartAt('2027-01-30', i))).toEqual(['2027-01-30', '2027-02-28', '2027-03-30']);
    expect([0, 1, 2].map((i) => cycleStartAt('2027-01-29', i))).toEqual(['2027-01-29', '2027-02-28', '2027-03-29']);
    expect([0, 1, 2].map((i) => cycleStartAt('2028-01-29', i))).toEqual(['2028-01-29', '2028-02-29', '2028-03-29']);
  });

  it('Feb 29 2028 anchor → Feb 28 2029 → Mar 29 2029; a December anchor rolls the year', () => {
    expect(cycleStartAt('2028-02-29', 12)).toBe('2029-02-28');
    expect(cycleStartAt('2028-02-29', 13)).toBe('2029-03-29');
    expect([0, 1, 2].map((i) => cycleStartAt('2026-12-17', i))).toEqual(['2026-12-17', '2027-01-17', '2027-02-17']);
  });

  it('refuses an invalid anchor or index', () => {
    expect(() => cycleStartAt('2026-02-30', 0)).toThrow();
    expect(() => cycleStartAt('2026-11-17', -1)).toThrow();
    expect(() => cycleStartAt('2026-11-17', 1.5)).toThrow();
  });
});

describe('cycleContaining / nextCycleStart', () => {
  it('the 17th: the cycle runs 17th to the 16th of the next month', () => {
    expect(cycleContaining('2026-11-17', '2026-11-17')).toEqual({ index: 0, start: '2026-11-17', end: '2026-12-17' });
    expect(cycleContaining('2026-11-17', '2026-12-16')).toEqual({ index: 0, start: '2026-11-17', end: '2026-12-17' });
    expect(cycleContaining('2026-11-17', '2026-12-17')).toEqual({ index: 1, start: '2026-12-17', end: '2027-01-17' });
    expect(cycleContaining('2026-11-17', '2026-11-16')).toBeNull();
    expect(nextCycleStart('2026-11-17', '2026-11-30')).toBe('2026-12-17');
    expect(nextCycleStart('2026-11-17', '2026-11-01')).toBe('2026-11-17');
  });

  it('month-end clamp: Feb 28 to Mar 31 is one cycle for a 31st anchor', () => {
    expect(cycleContaining('2027-01-31', '2027-03-30')).toEqual({ index: 1, start: '2027-02-28', end: '2027-03-31' });
    expect(cycleDays({ start: '2027-02-28', end: '2027-03-31' })).toBe(31);
    expect(cycleDays({ start: '2027-01-31', end: '2027-02-28' })).toBe(28);
  });

  it('the KST boundary: 14:59:59Z is still the previous KST day, 15:00:00Z the next', () => {
    const anchor = '2026-11-17';
    expect(cycleContaining(anchor, kstDayOf(new Date('2026-12-16T14:59:59Z')))!.index).toBe(0);
    expect(cycleContaining(anchor, kstDayOf(new Date('2026-12-16T15:00:00Z')))!.index).toBe(1);
    const w = cycleWindow({ start: '2026-11-17', end: '2026-12-17' });
    expect(w.start.toISOString()).toBe('2026-11-16T15:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-12-16T15:00:00.000Z');
    expect(kstDayStartUtc('2026-12-01').toISOString()).toBe('2026-11-30T15:00:00.000Z');
  });
});

/** Seeded PRNG (mulberry32): deterministic, no dependency. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property: random anchors, 60 cycles each', () => {
  it('cycles are contiguous, 28–31 days, start on min(anchor day, month length), and cycleContaining agrees for every day', () => {
    const random = prng(20261124);
    const anchors = ['2027-01-31', '2028-02-29', '2027-01-29', '2027-01-30', '2026-12-31'];
    for (let i = 0; i < 40; i++) {
      const y = 2026 + Math.floor(random() * 4);
      const m = 1 + Math.floor(random() * 12);
      const period = `${y}-${String(m).padStart(2, '0')}`;
      const d = 1 + Math.floor(random() * daysInYearMonth(period));
      anchors.push(`${period}-${String(d).padStart(2, '0')}`);
    }
    let days = 0;
    for (const anchor of anchors) {
      const anchorDay = Number(anchor.slice(8, 10));
      let previousEnd: string | null = null;
      for (let index = 0; index < 60; index++) {
        const start = cycleStartAt(anchor, index);
        const end = cycleStartAt(anchor, index + 1);
        if (previousEnd !== null) expect(start, `${anchor} #${index}`).toBe(previousEnd); // no gap, no overlap
        expect(Number(start.slice(8, 10))).toBe(Math.min(anchorDay, daysInYearMonth(start.slice(0, 7))));
        const length = cycleDays({ start, end });
        expect(length).toBeGreaterThanOrEqual(28);
        expect(length).toBeLessThanOrEqual(31);
        for (let day = start; day < end; day = addCalendarDays(day, 1)) {
          expect(cycleContaining(anchor, day)).toEqual({ index, start, end });
          days += 1;
        }
        previousEnd = end;
      }
    }
    expect(days).toBeGreaterThan(80_000);
  });
});
