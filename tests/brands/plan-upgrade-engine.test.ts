import { describe, expect, it } from 'vitest';
import { cycleContaining, cycleStartAt } from '@/lib/brands/billing/cycle';
import { daysInYearMonth as daysIn } from '@/lib/brands/billing/math';
import type { BrandPlanAssignment } from '@/lib/brands/plans';
import { currentRun, evaluateSubscription, type EngineInvoice, type EngineSubscription } from '@/lib/brands/subscriptions/engine';

/**
 * B1c-3 (notes: B1c3-brief.md §2): the engine accepts an upgrade-truncated cycle. An upgrade cuts the paid cycle to the
 * upgrade day and starts a new cycle (a new anchor) on that day; a cycle shorter than its anchor's cycle therefore ends
 * a run, and the cycle that starts on its end starts the next run.
 */

const sub = (over: Partial<EngineSubscription> = {}): EngineSubscription => ({
  status: 'active',
  planId: 'b2b_49',
  pendingPlanId: null,
  pendingPlanEffectivePeriod: null,
  collectionMethod: 'transfer',
  startedOn: '2026-10-17',
  cancelAtPeriodEnd: false,
  activatedBeforePayment: false,
  epoch: 1,
  ...over,
});

let n = 0;
const inv = (status: EngineInvoice['status'], cycle: [string, string], over: Partial<EngineInvoice> = {}): EngineInvoice => ({
  id: `inv-${++n}`,
  period: cycle[0].slice(0, 7),
  kind: 'subscription',
  coversMonths: 1,
  status,
  planId: 'b2b_29',
  dueOn: status === 'draft' ? null : addDays(cycle[0], 14),
  issuedAt: status === 'draft' ? null : `${cycle[0]}T09:00:00+09:00`,
  paidAt: status === 'paid' ? `${cycle[0]}T12:00:00+09:00` : null,
  createdAt: `${cycle[0]}T08:00:00+09:00`,
  createdVia: 'system',
  subscriptionEpoch: 1,
  cycleStart: cycle[0],
  cycleEnd: cycle[1],
  ...over,
});

function addDays(day: string, d: number): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

const assignment = (planId: BrandPlanAssignment['planId'], startedOn: string, endsOn: string) => ({
  planId,
  billingMode: 'invoice' as const,
  startedOn,
  endsOn,
});

describe('engine × plan upgrade (B1c-3)', () => {
  // Oct 17 → Nov 17 paid; Nov 17 → Dec 17 paid and cut to Nov 25 by an upgrade; Nov 25 → Dec 25 the upgrade invoice.
  const oct = () => inv('paid', ['2026-10-17', '2026-11-17']);
  const novCut = () => inv('paid', ['2026-11-17', '2026-11-25']);
  const upgrade = (status: EngineInvoice['status'] = 'issued') =>
    inv(status, ['2026-11-25', '2026-12-25'], { planId: 'b2b_49', issuedAt: '2026-11-25T10:00:00+09:00', createdAt: '2026-11-25T10:00:00+09:00', dueOn: '2026-12-09', paidAt: status === 'paid' ? '2026-11-26T10:00:00+09:00' : null });

  it('a truncated cycle ends the run: the cycle starting on its end is the new anchor', () => {
    expect(currentRun([oct(), novCut(), upgrade()], '2026-11-25')).toEqual({
      anchor: '2026-11-25',
      lastEnd: '2026-12-25',
      cycles: [{ start: '2026-11-25', end: '2026-12-25' }],
    });
    // Before the upgrade day the old run is still the current one (the cut cycle is its last).
    expect(currentRun([oct(), novCut(), upgrade()], '2026-11-24')).toMatchObject({ anchor: '2026-10-17', lastEnd: '2026-11-25' });
  });

  it('runs without a truncated cycle are unchanged (anchor 31 across February, contiguous chain)', () => {
    const jan = inv('paid', ['2027-01-31', '2027-02-28']);
    const feb = inv('paid', ['2027-02-28', '2027-03-31']);
    const mar = inv('issued', ['2027-03-31', '2027-04-30']);
    expect(currentRun([jan, feb, mar], '2027-04-05')).toEqual({
      anchor: '2027-01-31',
      lastEnd: '2027-04-30',
      cycles: [
        { start: '2027-01-31', end: '2027-02-28' },
        { start: '2027-02-28', end: '2027-03-31' },
        { start: '2027-03-31', end: '2027-04-30' },
      ],
    });
  });

  it('after the upgrade: anchor and plan assignment start on the upgrade day; access to the new due date; nothing billed', () => {
    const res = evaluateSubscription({
      todayKst: '2026-11-25',
      graceDays: 14,
      subscription: sub(),
      invoices: [oct(), novCut(), upgrade()],
      assignment: assignment('b2b_49', '2026-11-25', '2026-12-09'),
    });
    expect(res.cycle).toMatchObject({
      anchor: '2026-11-25',
      currentCycle: { start: '2026-11-25', end: '2026-12-25' },
      nextCycle: { start: '2026-12-25', end: '2027-01-25' },
      nextDraftDay: '2026-12-18',
    });
    expect(res.status).toBe('active');
    expect(res.accessEnd).toBe('2026-12-09');
    expect(res.actions).toEqual([]);
  });

  it('on the upgrade day with only the cut cycle, the engine bills [today, one month) at the subscription plan, due today + 14', () => {
    const res = evaluateSubscription({
      todayKst: '2026-11-25',
      graceDays: 14,
      subscription: sub(),
      invoices: [oct(), novCut()],
      assignment: assignment('b2b_49', '2026-11-25', '2026-11-25'),
    });
    expect(res.actions).toContainEqual({ type: 'draft', cycleStart: '2026-11-25', cycleEnd: '2026-12-25', period: '2026-11', planId: 'b2b_49' });
    expect(res.actions).toContainEqual({ type: 'issue', cycleStart: '2026-11-25', period: '2026-11', dueOn: '2026-12-09' });
    expect(res.actions).toContainEqual({ type: 'syncAssignment', planId: 'b2b_49', billingMode: 'invoice', startedOn: '2026-11-25', endsOn: '2026-12-09' });
  });

  it('the next cycle follows the new anchor: D-7 draft on Dec 18, issue on Dec 25', () => {
    const paidUpgrade = upgrade('paid');
    const d7 = evaluateSubscription({
      todayKst: '2026-12-18',
      graceDays: 14,
      subscription: sub(),
      invoices: [oct(), novCut(), paidUpgrade],
      assignment: assignment('b2b_49', '2026-11-25', '2026-12-25'),
    });
    expect(d7.actions).toEqual([{ type: 'draft', cycleStart: '2026-12-25', cycleEnd: '2027-01-25', period: '2026-12', planId: 'b2b_49' }]);
    const boundary = evaluateSubscription({
      todayKst: '2026-12-25',
      graceDays: 14,
      subscription: sub(),
      invoices: [oct(), novCut(), paidUpgrade, inv('draft', ['2026-12-25', '2027-01-25'], { planId: 'b2b_49', createdAt: '2026-12-18T09:00:00+09:00' })],
      assignment: assignment('b2b_49', '2026-11-25', '2026-12-25'),
    });
    expect(boundary.actions).toContainEqual({ type: 'issue', cycleStart: '2026-12-25', period: '2026-12', dueOn: '2027-01-08' });
  });

  it('currentRun agrees with a slow reference (full date math) on random runs with and without an upgrade cut', () => {
    let seed = 20261124 >>> 0;
    const random = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
    const reference = (cycles: { start: string; end: string }[], today: string) => {
      const sorted = [...cycles].sort((a, b) => a.start.localeCompare(b.start));
      const ends = new Set(sorted.map((c) => c.end));
      const cut = (anchor: string, c: { start: string; end: string }) => {
        const natural = cycleContaining(anchor, c.start);
        return natural !== null && c.end < natural.end;
      };
      const queue = sorted.filter((c) => !ends.has(c.start));
      const runs: { anchor: string; chain: { start: string; end: string }[] }[] = [];
      for (let i = 0; i < queue.length; i += 1) {
        const chain = [queue[i]!];
        for (;;) {
          const next = sorted.find((c) => c.start === chain.at(-1)!.end);
          if (!next) break;
          if (cut(queue[i]!.start, chain.at(-1)!)) {
            queue.push(next);
            break;
          }
          chain.push(next);
        }
        runs.push({ anchor: queue[i]!.start, chain });
      }
      runs.sort((a, b) => a.anchor.localeCompare(b.anchor));
      const started = runs.filter((r) => r.anchor <= today);
      const r = (started.length > 0 ? started : runs.slice(0, 1)).at(-1)!;
      return { anchor: r.anchor, lastEnd: r.chain.at(-1)!.end, cycles: r.chain };
    };
    let cuts = 0;
    for (let run = 0; run < 1500; run += 1) {
      const month = `${2026 + int(0, 2)}-${String(int(1, 12)).padStart(2, '0')}`;
      const anchor = cycleStartAt(`${month}-01`, 0).slice(0, 8) + String(Math.min([1, 15, 17, 28, 29, 30, 31][int(0, 6)]!, daysIn(month))).padStart(2, '0');
      const cycles: [string, string][] = [];
      const count = int(1, 8);
      for (let i = 0; i < count; i += 1) cycles.push([cycleStartAt(anchor, i), cycleStartAt(anchor, i + 1)]);
      if (random() < 0.6) {
        const j = int(0, count - 1);
        const [s, e] = cycles[j]!;
        const length = Math.round((Date.parse(`${e}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / 86_400_000);
        const u = addDays(s, int(1, length - 1));
        cycles.splice(j, cycles.length - j, [s, u]);
        for (let i = 0; i < int(0, 4); i += 1) cycles.push([cycleStartAt(u, i), cycleStartAt(u, i + 1)]);
        cuts += 1;
      }
      const invoices = cycles.map((c) => inv('paid', c));
      const today = addDays(cycles[0]![0], int(-5, 300));
      const expected = reference(cycles.map(([start, end]) => ({ start, end })), today);
      expect(currentRun(invoices, today), `${anchor} ${JSON.stringify(cycles)} @${today}`).toEqual(expected);
    }
    expect(cuts).toBeGreaterThan(700);
  });

  it('non-payment after an upgrade: past_due after the due date, suspended after grace, nothing of the old plan comes back', () => {
    const at = (todayKst: string) =>
      evaluateSubscription({
        todayKst,
        graceDays: 7,
        subscription: sub(),
        invoices: [oct(), novCut(), upgrade()],
        assignment: assignment('b2b_49', '2026-11-25', '2026-12-09'),
      });
    expect(at('2026-12-10').status).toBe('past_due');
    const suspended = at('2026-12-17');
    expect(suspended.status).toBe('suspended');
    expect(suspended.hasPlanAccess).toBe(false);
    expect(suspended.cycle.anchor).toBe('2026-11-25');
  });
});
