import { describe, expect, it } from 'vitest';
import { planActiveWithGrace } from '@/lib/brands/billing/math';
import type { BrandPlanAssignment } from '@/lib/brands/plans';
import {
  currentRun,
  cycleStartingOn,
  dueOnForInvoice,
  evaluateSubscription,
  firstInvoiceExpiryDay,
  type EngineInvoice,
  type EngineSubscription,
} from '@/lib/brands/subscriptions/engine';

/**
 * B1c-2: engine table tests on plan-start-day cycles (replaces the calendar-month table of B1a). Each case names the
 * rule of docs/BRAND-RECURRING-BILLING.md §5.8 / the B1c-2 brief it pins.
 */

const sub = (over: Partial<EngineSubscription> = {}): EngineSubscription => ({
  status: 'active',
  planId: 'b2b_69',
  pendingPlanId: null,
  pendingPlanEffectivePeriod: null,
  collectionMethod: 'transfer',
  startedOn: '2027-01-17',
  cancelAtPeriodEnd: false,
  activatedBeforePayment: false,
  epoch: 1,
  ...over,
});

let n = 0;
const inv = (status: EngineInvoice['status'], cycle: [string, string] | null, over: Partial<EngineInvoice> = {}): EngineInvoice => ({
  id: `inv-${++n}`,
  period: (cycle?.[0] ?? '2027-01-17').slice(0, 7),
  kind: 'subscription',
  coversMonths: 1,
  status,
  planId: 'b2b_69',
  dueOn: status === 'draft' ? null : cycle ? addDays(cycle[0], 14) : '2027-01-31',
  issuedAt: status === 'draft' ? null : `${cycle?.[0] ?? '2027-01-17'}T09:00:00+09:00`,
  paidAt: status === 'paid' ? `${cycle?.[0] ?? '2027-01-17'}T12:00:00+09:00` : null,
  createdAt: `${cycle?.[0] ?? '2027-01-17'}T08:00:00+09:00`,
  createdVia: 'system',
  subscriptionEpoch: 1,
  cycleStart: cycle?.[0] ?? null,
  cycleEnd: cycle?.[1] ?? null,
  ...over,
});

function addDays(day: string, d: number): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

const assignment = (startedOn: string, endsOn: string): Pick<BrandPlanAssignment, 'planId' | 'billingMode' | 'startedOn' | 'endsOn'> => ({
  planId: 'b2b_69',
  billingMode: 'invoice',
  startedOn,
  endsOn,
});

describe('brand subscription engine on billing cycles (B1c-2)', () => {
  it('rule 1 + 3: month-end clamp returns to the anchor day; due = max(issue day, cycle start) + 14; no first-invoice exception', () => {
    expect(cycleStartingOn('2027-01-31', '2027-02-28')).toEqual({ start: '2027-02-28', end: '2027-03-31' });
    expect(cycleStartingOn('2027-01-31', '2027-03-31')).toEqual({ start: '2027-03-31', end: '2027-04-30' });
    expect(dueOnForInvoice({ issueDay: '2027-02-17', cycleStart: '2027-02-17', method: 'transfer' })).toBe('2027-03-03');
    expect(dueOnForInvoice({ issueDay: '2027-02-10', cycleStart: '2027-02-17', method: 'transfer' })).toBe('2027-03-03');
    expect(dueOnForInvoice({ issueDay: '2027-02-20', cycleStart: '2027-02-17', method: 'transfer' })).toBe('2027-03-06');
    expect(dueOnForInvoice({ issueDay: '2026-11-25', method: 'transfer' })).toBe('2026-12-09');
    expect(firstInvoiceExpiryDay('2026-11-24')).toBe('2026-12-09');
  });

  it('rule 4: a paid first invoice without a cycle starts cycle 0 on its paid day (assignment from that day)', () => {
    const first = inv('paid', null, { paidAt: '2026-11-20T12:00:00+09:00', issuedAt: '2026-11-10T09:00:00+09:00' });
    const res = evaluateSubscription({ todayKst: '2026-11-27', graceDays: 14, subscription: sub({ status: 'pending', startedOn: '2026-11-10' }), invoices: [first], assignment: null });
    expect(res.actions[0]).toEqual({ type: 'setInvoiceCycle', invoiceId: first.id, cycleStart: '2026-11-20', cycleEnd: '2026-12-20' });
    expect(res.actions).toContainEqual({ type: 'syncAssignment', planId: 'b2b_69', billingMode: 'invoice', startedOn: '2026-11-20', endsOn: '2026-12-20' });
    expect(res.status).toBe('active');
  });

  it('rule 4: an unpaid first invoice gives no access and expires when today > due + 14; early access never expires', () => {
    const first = inv('issued', null, { dueOn: '2026-11-24', issuedAt: '2026-11-10T09:00:00+09:00' });
    const dec8 = evaluateSubscription({ todayKst: '2026-12-08', graceDays: 14, subscription: sub({ status: 'pending', startedOn: '2026-11-10' }), invoices: [first], assignment: null });
    expect(dec8.actions).toEqual([]);
    expect(dec8.accessEnd).toBeNull();
    expect(dec8.firstInvoicePending).toEqual({ invoiceId: first.id, dueOn: '2026-11-24', expiresOn: '2026-12-09' });
    const dec9 = evaluateSubscription({ todayKst: '2026-12-09', graceDays: 14, subscription: sub({ status: 'pending', startedOn: '2026-11-10' }), invoices: [first], assignment: null });
    expect(dec9.actions).toEqual([{ type: 'void', invoiceId: first.id, period: first.period, cycleStart: null, reason: 'first_invoice_expired' }]);
    const early = inv('issued', ['2026-11-10', '2026-12-10'], { dueOn: '2026-11-24' });
    const earlyDec9 = evaluateSubscription({ todayKst: '2026-12-09', graceDays: 14, subscription: sub({ status: 'pending', startedOn: '2026-11-10', activatedBeforePayment: true }), invoices: [early], assignment: assignment('2026-11-10', '2026-11-24') });
    expect(earlyDec9.actions.some((a) => a.type === 'void')).toBe(false);
  });

  it('rule 6: D-7 draft and boundary issue for anchor 31 across February (full price, no proration fields)', () => {
    const paid = inv('paid', ['2027-01-31', '2027-02-28']);
    const feb20 = evaluateSubscription({ todayKst: '2027-02-20', graceDays: 14, subscription: sub({ startedOn: '2027-01-31' }), invoices: [paid], assignment: assignment('2027-01-31', '2027-02-28') });
    expect(feb20.actions.filter((a) => a.type === 'draft')).toEqual([]);
    const feb21 = evaluateSubscription({ todayKst: '2027-02-21', graceDays: 14, subscription: sub({ startedOn: '2027-01-31' }), invoices: [paid], assignment: assignment('2027-01-31', '2027-02-28') });
    expect(feb21.actions.filter((a) => a.type === 'draft')).toEqual([{ type: 'draft', cycleStart: '2027-02-28', cycleEnd: '2027-03-31', period: '2027-02', planId: 'b2b_69' }]);
    const draft = inv('draft', ['2027-02-28', '2027-03-31'], { createdAt: '2027-02-21T08:00:00+09:00' });
    const feb28 = evaluateSubscription({ todayKst: '2027-02-28', graceDays: 14, subscription: sub({ startedOn: '2027-01-31' }), invoices: [paid, draft], assignment: assignment('2027-01-31', '2027-02-28') });
    expect(feb28.actions.filter((a) => a.type === 'issue')).toEqual([{ type: 'issue', cycleStart: '2027-02-28', period: '2027-02', dueOn: '2027-03-14' }]);
    expect(feb28.status).toBe('active');
  });

  it('rule 6: past_due on the boundary issues the cycle; suspended does not', () => {
    const paid = inv('paid', ['2027-01-17', '2027-02-17']);
    const febUnpaid = inv('issued', ['2027-02-17', '2027-03-17'], { dueOn: '2027-03-03' });
    const pastDue = evaluateSubscription({ todayKst: '2027-03-17', graceDays: 30, subscription: sub({ status: 'past_due' }), invoices: [paid, febUnpaid], assignment: assignment('2027-01-17', '2027-03-03') });
    expect(pastDue.actions.filter((a) => a.type === 'issue')).toEqual([{ type: 'issue', cycleStart: '2027-03-17', period: '2027-03', dueOn: '2027-03-31' }]);
    const suspended = evaluateSubscription({ todayKst: '2027-03-17', graceDays: 7, subscription: sub({ status: 'suspended' }), invoices: [paid, febUnpaid], assignment: assignment('2027-01-17', '2027-03-03') });
    expect(suspended.actions.filter((a) => a.type === 'draft' || a.type === 'issue')).toEqual([]);
  });

  it('rule 8: paying while suspended restarts on the paid date (new anchor); the old draft is voided; the gap is not billed', () => {
    const paid = inv('paid', ['2027-01-17', '2027-02-17']);
    const febPaidLate = inv('paid', ['2027-02-17', '2027-03-17'], { dueOn: '2027-03-03', paidAt: '2027-03-25T09:00:00+09:00' });
    const staleDraft = inv('draft', ['2027-03-17', '2027-04-17'], { createdAt: '2027-03-10T08:00:00+09:00' });
    const res = evaluateSubscription({ todayKst: '2027-03-25', graceDays: 7, subscription: sub({ status: 'suspended' }), invoices: [paid, febPaidLate, staleDraft], assignment: assignment('2027-01-17', '2027-03-03') });
    expect(res.actions.filter((a) => a.type === 'void' || a.type === 'draft' || a.type === 'issue')).toEqual([
      { type: 'void', invoiceId: staleDraft.id, period: staleDraft.period, cycleStart: '2027-03-17', reason: 'stale_system_draft' },
      { type: 'draft', cycleStart: '2027-03-25', cycleEnd: '2027-04-25', period: '2027-03', planId: 'b2b_69' },
      { type: 'issue', cycleStart: '2027-03-25', period: '2027-03', dueOn: '2027-04-08' },
    ]);
    expect(res.actions).toContainEqual({ type: 'syncAssignment', planId: 'b2b_69', billingMode: 'invoice', startedOn: '2027-03-25', endsOn: '2027-04-08' });
    // Paid while only past_due (before suspension): nothing restarts.
    const pastDuePaid = inv('paid', ['2027-02-17', '2027-03-17'], { dueOn: '2027-03-03', paidAt: '2027-03-06T09:00:00+09:00' });
    const keep = evaluateSubscription({ todayKst: '2027-03-06', graceDays: 14, subscription: sub({ status: 'past_due' }), invoices: [paid, pastDuePaid], assignment: assignment('2027-01-17', '2027-03-03') });
    expect(keep.actions.filter((a) => a.type === 'issue' || a.type === 'draft')).toEqual([]);
    expect(keep.actions).toContainEqual({ type: 'syncAssignment', planId: 'b2b_69', billingMode: 'invoice', startedOn: '2027-01-17', endsOn: '2027-03-17' });
  });

  it('rule 9: an admin void of an issued cycle after a paid one waives it (covered, never billed); voiding a draft waives nothing', () => {
    const paid = inv('paid', ['2027-01-17', '2027-02-17']);
    const febVoided = inv('void', ['2027-02-17', '2027-03-17'], { voidedBy: 'admin', voidedAt: '2027-02-20T09:00:00+09:00' });
    const res = evaluateSubscription({ todayKst: '2027-03-01', graceDays: 0, subscription: sub(), invoices: [paid, febVoided], assignment: assignment('2027-01-17', '2027-03-17') });
    expect(res.waivedCycles).toEqual(['2027-02-17']);
    expect(res.accessEnd).toBe('2027-03-17');
    expect(res.actions.filter((a) => a.type === 'issue')).toEqual([]);
    expect(currentRun([paid, febVoided])?.lastEnd).toBe('2027-03-17');
    const draftVoided = inv('void', ['2027-02-17', '2027-03-17'], { voidedBy: 'admin', voidedAt: '2027-02-12T09:00:00+09:00', issuedAt: null, dueOn: null });
    const redraft = evaluateSubscription({ todayKst: '2027-02-12', graceDays: 14, subscription: sub(), invoices: [paid, draftVoided], assignment: assignment('2027-01-17', '2027-02-17') });
    expect(redraft.actions.filter((a) => a.type === 'draft')).toEqual([{ type: 'draft', cycleStart: '2027-02-17', cycleEnd: '2027-03-17', period: '2027-02', planId: 'b2b_69' }]);
  });

  it('rule 10: a downgrade is drafted for its first cycle and applies on that cycle start; cancel ends after the paid cycle', () => {
    const paid = inv('paid', ['2027-01-17', '2027-02-17']);
    const down = sub({ pendingPlanId: 'b2b_29', pendingPlanEffectivePeriod: '2027-02' });
    const feb10 = evaluateSubscription({ todayKst: '2027-02-10', graceDays: 14, subscription: down, invoices: [paid], assignment: assignment('2027-01-17', '2027-02-17') });
    expect(feb10.actions.filter((a) => a.type === 'draft')).toEqual([{ type: 'draft', cycleStart: '2027-02-17', cycleEnd: '2027-03-17', period: '2027-02', planId: 'b2b_29' }]);
    expect(feb10.actions.some((a) => a.type === 'applyPendingPlan')).toBe(false);
    const draft = inv('draft', ['2027-02-17', '2027-03-17'], { planId: 'b2b_29', createdAt: '2027-02-10T08:00:00+09:00' });
    const feb17 = evaluateSubscription({ todayKst: '2027-02-17', graceDays: 14, subscription: down, invoices: [paid, draft], assignment: assignment('2027-01-17', '2027-02-17') });
    expect(feb17.actions[0]).toEqual({ type: 'applyPendingPlan', fromPlanId: 'b2b_69', toPlanId: 'b2b_29' });
    expect(feb17.actions).toContainEqual({ type: 'issue', cycleStart: '2027-02-17', period: '2027-02', dueOn: '2027-03-03' });
    const canceled = evaluateSubscription({ todayKst: '2027-02-16', graceDays: 14, subscription: sub({ cancelAtPeriodEnd: true }), invoices: [paid], assignment: assignment('2027-01-17', '2027-02-17') });
    expect(canceled.status).toBe('active');
    expect(canceled.actions.filter((a) => a.type === 'draft' || a.type === 'issue')).toEqual([]);
    const ended = evaluateSubscription({ todayKst: '2027-02-17', graceDays: 14, subscription: sub({ cancelAtPeriodEnd: true }), invoices: [paid], assignment: assignment('2027-01-17', '2027-02-17') });
    expect(ended.status).toBe('ended');
  });

  // Replaces the B1a engine table's kept edges (review-1 A1/A2/B4.1/B4.5/B2, round 3 item 2, item 10 (b)) on cycles.
  it('rule 11 edges kept from B1a: epoch isolation, ended is inert, grace 0, the job issues admin drafts, system void waives nothing, older-epoch cycles, legacy due fallback', () => {
    // A1: paid invoices of another epoch (or none) never activate a fresh epoch.
    const otherEpoch = inv('paid', ['2027-01-17', '2027-02-17'], { subscriptionEpoch: 1 });
    const nullEpoch = inv('paid', ['2026-12-17', '2027-01-17'], { subscriptionEpoch: null });
    const a1 = evaluateSubscription({ todayKst: '2027-01-20', graceDays: 14, subscription: sub({ status: 'pending', epoch: 2 }), invoices: [otherEpoch, nullEpoch], assignment: null });
    expect(a1).toMatchObject({ status: 'pending', hasPlanAccess: false, accessEnd: null, actions: [] });

    // A2: an ended subscription emits nothing, even with an assignment left.
    const paid = inv('paid', ['2027-01-17', '2027-02-17']);
    const a2 = evaluateSubscription({ todayKst: '2027-02-20', graceDays: 14, subscription: sub({ status: 'ended' }), invoices: [paid], assignment: assignment('2027-01-17', '2027-02-17') });
    expect(a2.status).toBe('ended');
    expect(a2.actions).toEqual([]);

    // B4.1: ends_on is exclusive and the engine status agrees with planActiveWithGrace at grace 0.
    const febUnpaid = inv('issued', ['2027-02-17', '2027-03-17'], { dueOn: '2027-03-03' });
    const mar2 = evaluateSubscription({ todayKst: '2027-03-02', graceDays: 0, subscription: sub({ status: 'active' }), invoices: [paid, febUnpaid], assignment: assignment('2027-01-17', '2027-03-03') });
    expect(mar2).toMatchObject({ status: 'active', accessEnd: '2027-03-03' });
    expect(planActiveWithGrace({ startedOn: '2027-01-17', endsOn: mar2.accessEnd }, '2027-03-02', 0).active).toBe(true);
    const mar3 = evaluateSubscription({ todayKst: '2027-03-03', graceDays: 0, subscription: sub({ status: 'active' }), invoices: [paid, febUnpaid], assignment: assignment('2027-01-17', '2027-03-03') });
    expect(mar3.status).toBe('suspended');
    expect(planActiveWithGrace({ startedOn: '2027-01-17', endsOn: mar3.accessEnd }, '2027-03-03', 0).active).toBe(false);

    // Grace 0 on the boundary: the only gap is the cycle being issued -> issue it and stay active.
    const febDraft = inv('draft', ['2027-02-17', '2027-03-17'], { createdAt: '2027-02-10T08:00:00+09:00' });
    const grace0 = evaluateSubscription({ todayKst: '2027-02-17', graceDays: 0, subscription: sub(), invoices: [paid, febDraft], assignment: assignment('2027-01-17', '2027-02-17') });
    expect(grace0.actions).toContainEqual({ type: 'issue', cycleStart: '2027-02-17', period: '2027-02', dueOn: '2027-03-03' });
    expect(grace0.status).toBe('active');

    // B4.5 / round 4 A: a draft created by an admin with manual amounts is still the job's and is issued on the boundary.
    const adminDraft = inv('draft', ['2027-02-17', '2027-03-17'], { createdVia: 'admin', manualAmounts: true, createdAt: '2027-02-12T08:00:00+09:00' });
    const b45 = evaluateSubscription({ todayKst: '2027-02-17', graceDays: 14, subscription: sub(), invoices: [paid, adminDraft], assignment: assignment('2027-01-17', '2027-02-17') });
    expect(b45.actions.filter((a) => a.type === 'issue')).toEqual([{ type: 'issue', cycleStart: '2027-02-17', period: '2027-02', dueOn: '2027-03-03' }]);

    // B2: a SYSTEM void of an issued cycle waives nothing (the job bills the cycle again); only an admin void waives.
    const sysVoided = inv('void', ['2027-02-17', '2027-03-17'], { voidedBy: 'system', voidedAt: '2027-02-20T09:00:00+09:00' });
    const b2 = evaluateSubscription({ todayKst: '2027-02-20', graceDays: 14, subscription: sub(), invoices: [paid, sysVoided], assignment: assignment('2027-01-17', '2027-03-03') });
    expect(b2.waivedCycles).toEqual([]);
    expect(b2.adminVoidedCycles).toEqual([]);
    expect(b2.actions.filter((a) => a.type === 'draft' || a.type === 'issue')).toEqual([
      { type: 'draft', cycleStart: '2027-02-17', cycleEnd: '2027-03-17', period: '2027-02', planId: 'b2b_69' },
      { type: 'issue', cycleStart: '2027-02-17', period: '2027-02', dueOn: '2027-03-06' },
    ]);

    // Round 3 item 2: a cycle an older epoch's invoice occupies is never drafted and is reported.
    const older = evaluateSubscription({
      todayKst: '2027-02-12',
      graceDays: 14,
      subscription: sub({ epoch: 2 }),
      invoices: [inv('paid', ['2027-01-17', '2027-02-17'], { subscriptionEpoch: 2 })],
      assignment: assignment('2027-01-17', '2027-02-17'),
      olderEpochCycles: [{ start: '2027-02-17', end: '2027-03-17' }],
    });
    expect(older.actions.filter((a) => a.type === 'draft' || a.type === 'issue')).toEqual([]);
    expect(older.blockedByOlderEpoch).toEqual(['2027-02-17']);

    // Item 10 (b): the oldest unpaid is chosen by due date; a legacy row without due_on falls back to issue day + 14.
    const legacy = inv('issued', ['2027-02-17', '2027-03-17'], { dueOn: null, issuedAt: '2027-02-12T09:00:00+09:00' });
    const legacyRes = evaluateSubscription({ todayKst: '2027-02-20', graceDays: 14, subscription: sub(), invoices: [paid, legacy], assignment: assignment('2027-01-17', '2027-02-26') });
    expect(legacyRes.oldestUnpaid?.id).toBe(legacy.id);
    expect(legacyRes.accessEnd).toBe('2027-02-26');
  });

  it('a draft without a cycle, or of a cycle that ended unbilled while not billable, is voided by the system', () => {
    const paid = inv('paid', ['2027-01-17', '2027-02-17']);
    const febUnpaid = inv('issued', ['2027-02-17', '2027-03-17'], { dueOn: '2027-03-03' });
    const marDraft = inv('draft', ['2027-03-17', '2027-04-17'], { createdAt: '2027-03-10T08:00:00+09:00' });
    const res = evaluateSubscription({ todayKst: '2027-04-17', graceDays: 7, subscription: sub({ status: 'suspended' }), invoices: [paid, febUnpaid, marDraft], assignment: assignment('2027-01-17', '2027-03-03') });
    expect(res.actions.filter((a) => a.type === 'void')).toEqual([{ type: 'void', invoiceId: marDraft.id, period: marDraft.period, cycleStart: '2027-03-17', reason: 'stale_system_draft' }]);
  });
});
