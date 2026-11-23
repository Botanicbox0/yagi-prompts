import { describe, expect, it } from 'vitest';
import { addCalendarDays, daysInYearMonth, invoiceAmounts, kstDayOf, planActiveWithGrace } from '@/lib/brands/billing/math';
import { BRAND_PLANS, type BrandPlanAssignment } from '@/lib/brands/plans';
import {
  computeAccessEnd,
  computeSubscriptionStatus,
  dueOnForMethod,
  evaluateSubscription,
  firstDayOfPeriod,
  isInvoiceOverdueWithDueOn,
  lastDayOfPeriod,
  nextPeriodOf,
  periodOfDay,
  subscriptionCalendarForDay,
  type EngineInvoice,
  type EngineSubscription,
} from '@/lib/brands/subscriptions/engine';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('brand subscriptions pure engine (§4.1, §8.1)', () => {
  it('computes KST calendar periods, leap years, D-7 draft open day, and due_on', () => {
    expect(kstDayOf(new Date('2026-11-30T14:59:59Z'))).toBe('2026-11-30');
    expect(kstDayOf(new Date('2026-11-30T15:00:00Z'))).toBe('2026-12-01');

    // Non-leap Feb 2027 (28 days) -> D-7 for 2027-03 is 2027-02-22
    const nonLeap = subscriptionCalendarForDay('2027-02-21', 'transfer');
    expect(nonLeap.currentPeriod).toBe('2027-02');
    expect(nonLeap.nextPeriod).toBe('2027-03');
    expect(nonLeap.nextDraftOpenDay).toBe('2027-02-22');
    expect(nonLeap.nextIssueDay).toBe('2027-03-01');
    expect(nonLeap.dueOnForToday).toBe('2027-03-07');

    // Leap Feb 2028 (29 days) -> D-7 for 2028-03 is 2028-02-23
    const leap = subscriptionCalendarForDay('2028-02-23', 'transfer');
    expect(leap.currentPeriod).toBe('2028-02');
    expect(leap.nextPeriod).toBe('2028-03');
    expect(leap.nextDraftOpenDay).toBe('2028-02-23');
    expect(leap.nextIssueDay).toBe('2028-03-01');
    expect(lastDayOfPeriod('2028-02')).toBe('2028-02-29');

    // Dec -> Jan year rollover
    const dec = subscriptionCalendarForDay('2026-12-25', 'transfer');
    expect(dec.nextPeriod).toBe('2027-01');
    expect(dec.nextDraftOpenDay).toBe('2026-12-25');
    expect(dec.nextIssueDay).toBe('2027-01-01');
    expect(dueOnForMethod('2027-01-01', 'transfer')).toBe('2027-01-15');
    expect(dueOnForMethod('2027-01-01', 'card')).toBe('2027-01-01');
  });

  it('evaluates overdue strictly past dueOn when present, falling back to 14d when dueOn is null', () => {
    expect(
      isInvoiceOverdueWithDueOn(
        { status: 'issued', issuedAt: '2026-11-01T00:00:00Z', dueOn: '2026-11-15' },
        '2026-11-15',
        new Date('2026-11-15T12:00:00Z'),
      ),
    ).toBe(false);
    expect(
      isInvoiceOverdueWithDueOn(
        { status: 'issued', issuedAt: '2026-11-01T00:00:00Z', dueOn: '2026-11-15' },
        '2026-11-16',
        new Date('2026-11-16T00:00:00Z'),
      ),
    ).toBe(true);
    expect(
      isInvoiceOverdueWithDueOn(
        { status: 'issued', issuedAt: '2026-11-01T00:00:00Z', dueOn: null },
        '2026-11-15',
        new Date('2026-11-15T00:00:00Z'),
      ),
    ).toBe(false);
    expect(
      isInvoiceOverdueWithDueOn(
        { status: 'issued', issuedAt: '2026-11-01T00:00:00Z', dueOn: null },
        '2026-11-16',
        new Date('2026-11-16T00:00:00Z'),
      ),
    ).toBe(true);
  });

  it('handles pending, activatedBeforePayment, past_due, suspended, resume, cancel, undoCancel, downgrade', () => {
    const baseSub: EngineSubscription = {
      status: 'pending',
      planId: 'b2b_29',
      pendingPlanId: null,
      collectionMethod: 'transfer',
      startedOn: '2026-11-10',
      cancelAtPeriodEnd: false,
      activatedBeforePayment: false,
      epoch: 1,
    };
    const firstIssued: EngineInvoice = {
      id: 'inv-1',
      period: '2026-11',
      kind: 'subscription',
      coversMonths: 1,
      status: 'issued',
      planId: 'b2b_29',
      dueOn: '2026-11-24',
      issuedAt: '2026-11-10T00:00:00Z',
      subscriptionEpoch: 1,
    };

    // Pending without activatedBeforePayment: no plan access
    const pendingEval = evaluateSubscription({
      todayKst: '2026-11-10',
      graceDays: 14,
      subscription: baseSub,
      invoices: [firstIssued],
      assignment: null,
    });
    expect(pendingEval.status).toBe('pending');
    expect(pendingEval.hasPlanAccess).toBe(false);
    expect(pendingEval.accessEnd).toBeNull();
    expect(pendingEval.actions).toEqual([]);

    // Activated before payment: access open with ends_on = due_on
    const preOpenEval = evaluateSubscription({
      todayKst: '2026-11-10',
      graceDays: 14,
      subscription: { ...baseSub, activatedBeforePayment: true },
      invoices: [firstIssued],
      assignment: null,
    });
    expect(preOpenEval.status).toBe('pending');
    expect(preOpenEval.hasPlanAccess).toBe(true);
    expect(preOpenEval.accessEnd).toBe('2026-11-24');
    expect(preOpenEval.actions).toEqual([
      { type: 'syncAssignment', planId: 'b2b_29', billingMode: 'invoice', startedOn: '2026-11-10', endsOn: '2026-11-24' },
    ]);

    // Paid -> active until exclusive end day (first day of next month)
    const paidFirst: EngineInvoice = { ...firstIssued, status: 'paid', paidAt: '2026-11-10T01:00:00Z' };
    const paidEval = evaluateSubscription({
      todayKst: '2026-11-24',
      graceDays: 14,
      subscription: { ...baseSub, status: 'active' },
      invoices: [paidFirst],
      assignment: null,
    });
    expect(paidEval.status).toBe('active');
    expect(paidEval.accessEnd).toBe('2026-12-01');
    expect(paidEval.actions.some((a) => a.type === 'draft' && a.period === '2026-12')).toBe(true);

    // Past due & suspended across dueOn=2026-12-15, grace=14 (suspended from 2026-12-30)
    const decIssued: EngineInvoice = {
      id: 'inv-2',
      period: '2026-12',
      kind: 'subscription',
      coversMonths: 1,
      status: 'issued',
      planId: 'b2b_29',
      dueOn: '2026-12-15',
      issuedAt: '2026-12-01T00:00:00Z',
      subscriptionEpoch: 1,
    };
    expect(
      computeSubscriptionStatus({
        todayKst: '2026-12-15',
        graceDays: 14,
        subscription: { ...baseSub, status: 'active' },
        invoices: [paidFirst, decIssued],
      }),
    ).toBe('active');
    expect(
      computeSubscriptionStatus({
        todayKst: '2026-12-16',
        graceDays: 14,
        subscription: { ...baseSub, status: 'active' },
        invoices: [paidFirst, decIssued],
      }),
    ).toBe('past_due');
    expect(
      computeSubscriptionStatus({
        todayKst: '2026-12-29',
        graceDays: 14,
        subscription: { ...baseSub, status: 'past_due' },
        invoices: [paidFirst, decIssued],
      }),
    ).toBe('past_due');
    expect(
      computeSubscriptionStatus({
        todayKst: '2026-12-30',
        graceDays: 14,
        subscription: { ...baseSub, status: 'past_due' },
        invoices: [paidFirst, decIssued],
      }),
    ).toBe('suspended');

    // Suspended gets NO 2027-01 draft/issue on 2027-01-05
    const suspEval = evaluateSubscription({
      todayKst: '2027-01-05',
      graceDays: 14,
      subscription: { ...baseSub, status: 'suspended' },
      invoices: [paidFirst, decIssued],
      assignment: { planId: 'b2b_29', billingMode: 'invoice', startedOn: '2026-11-10', endsOn: '2026-12-15' },
    });
    expect(suspEval.status).toBe('suspended');
    expect(suspEval.actions.some((a) => a.type === 'draft' || a.type === 'issue')).toBe(false);

    // Paying overdue decIssued on 2027-01-05 while suspended in Jan -> active + prorated Jan invoice from 2027-01-05
    const resumeEval = evaluateSubscription({
      todayKst: '2027-01-05',
      graceDays: 14,
      subscription: { ...baseSub, status: 'suspended' },
      invoices: [paidFirst, { ...decIssued, status: 'paid', paidAt: '2027-01-05T01:00:00Z' }],
      assignment: { planId: 'b2b_29', billingMode: 'invoice', startedOn: '2026-11-10', endsOn: '2026-12-15' },
    });
    expect(resumeEval.status).toBe('active');
    expect(resumeEval.actions).toEqual(
      expect.arrayContaining([
        { type: 'draft', period: '2027-01', planId: 'b2b_29', prorateFromDay: '2027-01-05' },
        { type: 'issue', period: '2027-01', prorateFromDay: '2027-01-05', dueOn: '2027-01-19' },
        { type: 'setStatus', from: 'suspended', to: 'active' },
      ]),
    );

    // Cancel with nothing paid -> ends immediately
    const cancelUnpaid = evaluateSubscription({
      todayKst: '2026-11-12',
      graceDays: 14,
      subscription: { ...baseSub, cancelAtPeriodEnd: true },
      invoices: [firstIssued],
      assignment: null,
    });
    expect(cancelUnpaid.status).toBe('ended');
    expect(cancelUnpaid.actions).toEqual([{ type: 'end', reason: 'canceled_unpaid' }]);

    // Cancel after paid -> keeps paid period through 2026-12-01 (exclusive), ends on 2026-12-01, no Dec draft
    const cancelPaidNov = evaluateSubscription({
      todayKst: '2026-11-26',
      graceDays: 14,
      subscription: { ...baseSub, status: 'active', cancelAtPeriodEnd: true },
      invoices: [paidFirst],
      assignment: { planId: 'b2b_29', billingMode: 'invoice', startedOn: '2026-11-10', endsOn: '2026-12-01' },
    });
    expect(cancelPaidNov.status).toBe('active');
    expect(cancelPaidNov.accessEnd).toBe('2026-12-01');
    expect(cancelPaidNov.actions).toEqual([]);

    const cancelEndedDec = evaluateSubscription({
      todayKst: '2026-12-01',
      graceDays: 14,
      subscription: { ...baseSub, status: 'active', cancelAtPeriodEnd: true },
      invoices: [paidFirst],
      assignment: { planId: 'b2b_29', billingMode: 'invoice', startedOn: '2026-11-10', endsOn: '2026-12-01' },
    });
    expect(cancelEndedDec.status).toBe('ended');
    expect(cancelEndedDec.actions).toEqual([
      { type: 'clearAssignment' },
      { type: 'end', reason: 'canceled_period_ended' },
    ]);

    // Sandboxed and project_only refuse/skip
    expect(
      evaluateSubscription({
        todayKst: '2026-11-10',
        graceDays: 14,
        subscription: baseSub,
        invoices: [],
        assignment: null,
        sandboxed: true,
      }).actions,
    ).toEqual([]);
    expect(
      evaluateSubscription({
        todayKst: '2026-11-10',
        graceDays: 14,
        subscription: { ...baseSub, planId: 'project_only' },
        invoices: [],
        assignment: null,
      }).actions,
    ).toEqual([]);
  });

  it('property test (seeded PRNG, 20+ months incl. Feb 2028 leap & month-end starts): all §4.1 invariants hold on every day', () => {
    const startDays = [
      '2026-11-01',
      '2026-11-15',
      '2026-11-29',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
      '2028-01-31',
      '2028-02-29',
    ] as const;
    const paidPlans = ['b2b_29', 'b2b_49', 'b2b_69'] as const;

    for (let seed = 1; seed <= 60; seed++) {
      const rand = mulberry32(seed);
      const startedOn = startDays[seed % startDays.length]!;
      const graceDays = seed % 2 === 0 ? 14 : 7;
      const activateBeforePayment = rand() < 0.25;
      const initPlan = paidPlans[Math.floor(rand() * paidPlans.length)]!;

      let subscription: EngineSubscription = {
        status: 'pending',
        planId: initPlan,
        pendingPlanId: null,
        pendingPlanEffectivePeriod: null,
        collectionMethod: 'transfer',
        startedOn,
        cancelAtPeriodEnd: false,
        activatedBeforePayment: activateBeforePayment,
        epoch: 1,
      };
      let assignment: Pick<BrandPlanAssignment, 'planId' | 'billingMode' | 'startedOn' | 'endsOn'> | null = null;
      const invoices: EngineInvoice[] = [];
      let nextInvNum = 1;

      const startPeriod = periodOfDay(startedOn);
      invoices.push({
        id: `inv-${nextInvNum++}`,
        period: startPeriod,
        kind: 'subscription',
        coversMonths: 1,
        status: 'issued',
        planId: initPlan,
        dueOn: dueOnForMethod(startedOn, 'transfer'),
        issuedAt: `${startedOn}T00:00:00+09:00`,
        subscriptionEpoch: 1,
        createdAt: `${startedOn}T00:00:00+09:00`,
      });

      const applyEval = (day: string) => {
        const res = evaluateSubscription({ todayKst: day, graceDays, subscription, invoices, assignment });
        for (const act of res.actions) {
          if (act.type === 'void') {
            // Review round 2: the job voids an expired first invoice / its own stale drafts as the system.
            const voided = invoices.find((i) => i.id === act.invoiceId)!;
            voided.status = 'void';
            voided.voidedBy = 'system';
            voided.voidedAt = `${day}T00:00:00+09:00`;
          } else if (act.type === 'applyPendingPlan') {
            subscription = { ...subscription, planId: act.toPlanId, pendingPlanId: null, pendingPlanEffectivePeriod: null };
          } else if (act.type === 'draft') {
            const exists = invoices.some(
              (i) => i.kind === 'subscription' && i.status !== 'void' && i.period === act.period,
            );
            expect(exists, `seed=${seed} day=${day} duplicate subscription invoice`).toBe(false);
            invoices.push({
              id: `inv-${nextInvNum++}`,
              period: act.period,
              kind: 'subscription',
              coversMonths: 1,
              status: 'draft',
              planId: act.planId,
              dueOn: null,
              issuedAt: null,
              subscriptionEpoch: 1,
              createdAt: `${day}T00:00:00+09:00`,
              createdVia: 'system',
            });
          } else if (act.type === 'issue') {
            const draft = invoices.find(
              (i) => i.kind === 'subscription' && i.status === 'draft' && i.period === act.period,
            );
            expect(draft, `seed=${seed} day=${day} missing draft to issue`).toBeDefined();
            draft!.status = 'issued';
            draft!.dueOn = act.dueOn;
            draft!.issuedAt = `${day}T00:00:00+09:00`;
          } else if (act.type === 'syncAssignment') {
            assignment = {
              planId: act.planId,
              billingMode: act.billingMode,
              startedOn: act.startedOn,
              endsOn: act.endsOn,
            };
          } else if (act.type === 'clearAssignment') {
            assignment = null;
          } else if (act.type === 'setStatus') {
            subscription = { ...subscription, status: act.to };
          } else if (act.type === 'end') {
            subscription = { ...subscription, status: 'ended' };
          }
        }
        return res;
      };

      const totalDays = 600;
      for (let d = 0; d < totalDays; d++) {
        const day = addCalendarDays(startedOn, d);
        const beforeHasPaid = invoices.some((i) => i.status === 'paid');

        // Random events before daily tick
        if (subscription.status !== 'ended') {
          const r = rand();
          const unpaid = invoices.filter((i) => i.status === 'issued');
          if (unpaid.length > 0 && r < 0.12) {
            // Pay oldest unpaid invoice
            const oldest = [...unpaid].sort((a, b) => (a.dueOn ?? '').localeCompare(b.dueOn ?? ''))[0]!;
            oldest.status = 'paid';
            oldest.paidAt = `${day}T00:00:00+09:00`;
            // Invariant: paying all unpaid invoices restores active (unless canceled & paid period already ended)
            if (invoices.every((i) => i.status !== 'issued') && !subscription.cancelAtPeriodEnd) {
              const afterPay = applyEval(day);
              expect(afterPay.status, `seed=${seed} day=${day} paying must restore active`).toBe('active');
            }
          } else if (unpaid.length > 0 && r >= 0.12 && r < 0.14) {
            unpaid[0]!.status = 'void';
            unpaid[0]!.voidedAt = `${day}T00:00:00+09:00`;
            unpaid[0]!.voidedBy = 'system';
          } else if (!subscription.cancelAtPeriodEnd && r >= 0.14 && r < 0.16 && beforeHasPaid) {
            const paidEndBefore = computeAccessEnd({ subscription, invoices });
            subscription = { ...subscription, cancelAtPeriodEnd: true, pendingPlanId: null, pendingPlanEffectivePeriod: null };
            const paidEndAfter = computeAccessEnd({ subscription, invoices });
            if (paidEndBefore && paidEndAfter) {
              expect(paidEndAfter >= paidEndBefore, `seed=${seed} cancel shortened paid period`).toBe(true);
            }
          } else if (subscription.cancelAtPeriodEnd && r >= 0.16 && r < 0.18) {
            subscription = { ...subscription, cancelAtPeriodEnd: false };
          } else if (!subscription.cancelAtPeriodEnd && subscription.pendingPlanId === null && r >= 0.18 && r < 0.21) {
            const currentRank = paidPlans.indexOf(subscription.planId as (typeof paidPlans)[number]);
            if (currentRank > 0) {
              subscription = {
                ...subscription,
                pendingPlanId: paidPlans[currentRank - 1]!,
                pendingPlanEffectivePeriod: nextPeriodOf(periodOfDay(day)),
              };
            }
          }
        }

        const wasRestricted =
          subscription.status === 'suspended' ||
          subscription.status === 'ended' ||
          subscription.cancelAtPeriodEnd ||
          (subscription.status === 'pending' && !subscription.activatedBeforePayment);

        const evaluated = applyEval(day);

        if (wasRestricted && subscription.status !== 'active') {
          expect(
            evaluated.actions.some((a) => a.type === 'draft' || a.type === 'issue'),
            `seed=${seed} day=${day} must not draft/issue while restricted (${subscription.status})`,
          ).toBe(false);
        }

        // Invariant 1: never two non-void subscription invoices for one period
        const nonVoidPeriods = invoices
          .filter((i) => i.kind === 'subscription' && i.status !== 'void')
          .map((i) => i.period);
        expect(new Set(nonVoidPeriods).size, `seed=${seed} day=${day}`).toBe(nonVoidPeriods.length);

        // Invariant 2: idempotency — re-evaluating right after applying actions yields 0 actions
        const second = evaluateSubscription({ todayKst: day, graceDays, subscription, invoices, assignment });
        expect(second.actions, `seed=${seed} day=${day} not idempotent`).toEqual([]);

        // Invariant 3: subscription status and planActiveWithGrace agree on every day
        const planActive = planActiveWithGrace(assignment, day, graceDays).active;
        // Review round 2: early access needs an outstanding invoice (a voided/expired first invoice closes it).
        const expectedAccess =
          subscription.status === 'active' ||
          subscription.status === 'past_due' ||
          (subscription.status === 'pending' &&
            subscription.activatedBeforePayment &&
            invoices.some((i) => i.status === 'issued'));
        const endsOnLabel = assignment ? (assignment as { endsOn: string | null }).endsOn : 'none';
        expect(planActive, `seed=${seed} day=${day} status=${subscription.status} endsOn=${endsOnLabel}`).toBe(
          expectedAccess,
        );
      }
    }
  });

  it('review-1 failing-first: A1 epoch isolation, A2 ended no-op, B2 admin-void block vs system-void, B4.1-B4.5 rules', () => {
    const subBase = {
      status: 'pending' as const,
      planId: 'b2b_49' as const,
      pendingPlanId: null,
      pendingPlanEffectivePeriod: null as string | null,
      collectionMethod: 'transfer' as const,
      startedOn: '2026-11-10',
      cancelAtPeriodEnd: false,
      activatedBeforePayment: false,
      epoch: 2,
    };

    // A1: null-epoch & old-epoch paid invoices MUST NOT activate a fresh epoch=2 subscription
    const stalePaid: EngineInvoice = {
      id: 'inv-old',
      period: '2026-11',
      kind: 'subscription',
      coversMonths: 1,
      status: 'paid',
      planId: 'b2b_69',
      dueOn: '2026-11-15',
      issuedAt: '2026-11-01T00:00:00Z',
      subscriptionEpoch: null,
    } as unknown as EngineInvoice;
    const staleEpoch1: EngineInvoice = {
      ...stalePaid,
      id: 'inv-ep1',
      subscriptionEpoch: 1,
    } as unknown as EngineInvoice;
    const ep2FirstUnpaid: EngineInvoice = {
      id: 'inv-ep2',
      period: '2026-11',
      kind: 'subscription',
      coversMonths: 1,
      status: 'issued',
      planId: 'b2b_49',
      dueOn: '2026-11-24',
      issuedAt: '2026-11-10T00:00:00Z',
      subscriptionEpoch: 2,
    } as unknown as EngineInvoice;

    const evalA1 = evaluateSubscription({
      todayKst: '2026-11-12',
      graceDays: 14,
      subscription: subBase as unknown as EngineSubscription,
      invoices: [stalePaid, staleEpoch1, ep2FirstUnpaid],
      assignment: null,
    });
    expect(evalA1.status).toBe('pending');
    expect(evalA1.hasPlanAccess).toBe(false);
    expect(evalA1.accessEnd).toBeNull();
    expect(evalA1.actions).toEqual([]);

    // A2: stored status = 'ended' emits ZERO actions even when a manual assignment exists
    const evalA2 = evaluateSubscription({
      todayKst: '2026-11-20',
      graceDays: 14,
      subscription: { ...subBase, status: 'ended' } as unknown as EngineSubscription,
      invoices: [ep2FirstUnpaid],
      assignment: { planId: 'b2b_29', billingMode: 'invoice', startedOn: '2026-11-15', endsOn: '2026-12-31' },
    });
    expect(evalA2.status).toBe('ended');
    expect(evalA2.actions).toEqual([]);

    // B4.1: exclusive ends_on (2026-12-01 for paid 2026-11) + grace=0 agreement with planActiveWithGrace
    const paidNov = { ...ep2FirstUnpaid, status: 'paid' as const, paidAt: '2026-11-10T01:00:00Z' };
    const evalExclusive = evaluateSubscription({
      todayKst: '2026-11-30',
      graceDays: 0,
      subscription: { ...subBase, status: 'active' } as unknown as EngineSubscription,
      invoices: [paidNov as unknown as EngineInvoice],
      assignment: null,
    });
    expect(evalExclusive.accessEnd).toBe('2026-12-01');
    expect(planActiveWithGrace({ startedOn: '2026-11-10', endsOn: evalExclusive.accessEnd }, '2026-11-30', 0).active).toBe(true);

    // B4.1 with grace=0 on dueOn = 2026-12-15 -> planActiveWithGrace returns false -> status MUST be 'suspended'
    const decUnpaidDue15: EngineInvoice = {
      id: 'inv-dec',
      period: '2026-12',
      kind: 'subscription',
      coversMonths: 1,
      status: 'issued',
      planId: 'b2b_49',
      dueOn: '2026-12-15',
      issuedAt: '2026-12-01T00:00:00Z',
      subscriptionEpoch: 2,
    } as unknown as EngineInvoice;
    const evalGraceZeroDueDay = evaluateSubscription({
      todayKst: '2026-12-15',
      graceDays: 0,
      subscription: { ...subBase, status: 'active' } as unknown as EngineSubscription,
      invoices: [paidNov as unknown as EngineInvoice, decUnpaidDue15],
      assignment: null,
    });
    expect(evalGraceZeroDueDay.status).toBe('suspended');
    expect(planActiveWithGrace({ startedOn: '2026-11-10', endsOn: evalGraceZeroDueDay.accessEnd }, '2026-12-15', 0).active).toBe(false);

    // B4.2: billing continues in past_due AND in pending + activatedBeforePayment
    const evalPastDueDraft = evaluateSubscription({
      todayKst: '2026-12-25', // D-7 for 2027-01, decUnpaid dueOn=2026-12-15, grace=14 -> past_due!
      graceDays: 14,
      subscription: { ...subBase, status: 'past_due' } as unknown as EngineSubscription,
      invoices: [paidNov as unknown as EngineInvoice, decUnpaidDue15],
      assignment: { planId: 'b2b_49', billingMode: 'invoice', startedOn: '2026-11-10', endsOn: '2026-12-15' },
    });
    expect(evalPastDueDraft.status).toBe('past_due');
    expect(evalPastDueDraft.actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'draft', period: '2027-01', planId: 'b2b_49' })]),
    );

    const earlyNovStart = { ...subBase, startedOn: '2026-11-20', activatedBeforePayment: true };
    const novDueDec04 = {
      ...ep2FirstUnpaid,
      dueOn: '2026-12-04',
      issuedAt: '2026-11-20T00:00:00Z',
    };
    const evalPendingEarlyIssue = evaluateSubscription({
      todayKst: '2026-12-01',
      graceDays: 14,
      subscription: earlyNovStart as unknown as EngineSubscription,
      invoices: [novDueDec04 as unknown as EngineInvoice],
      assignment: { planId: 'b2b_49', billingMode: 'invoice', startedOn: '2026-11-20', endsOn: '2026-12-04' },
    });
    expect(evalPendingEarlyIssue.status).toBe('pending');
    expect(evalPendingEarlyIssue.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'draft', period: '2026-12', prorateFromDay: null }),
        expect.objectContaining({ type: 'issue', period: '2026-12', prorateFromDay: null }),
      ]),
    );

    // B4.3 & B4.4: Resuming mid-month after suspended on Jan 1 must prorate from Jan 5 AND keep current plan (NOT apply downgrade mid-month!)
    const evalResumeKeepsPlan = evaluateSubscription({
      todayKst: '2027-01-05',
      graceDays: 14,
      subscription: {
        ...subBase,
        status: 'past_due', // even if stale stored status was NOT 'suspended', Jan 1 facts say suspended!
        planId: 'b2b_69',
        pendingPlanId: 'b2b_29',
        pendingPlanEffectivePeriod: '2027-01',
      } as unknown as EngineSubscription,
      invoices: [
        { ...paidNov, planId: 'b2b_69' } as unknown as EngineInvoice,
        {
          ...decUnpaidDue15,
          planId: 'b2b_69',
          status: 'paid',
          paidAt: '2027-01-05T01:00:00Z',
        } as unknown as EngineInvoice,
      ],
      assignment: null,
    });
    expect(evalResumeKeepsPlan.status).toBe('active');
    expect(evalResumeKeepsPlan.actions.some((a) => a.type === 'applyPendingPlan')).toBe(false);
    expect(evalResumeKeepsPlan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'draft', period: '2027-01', planId: 'b2b_69', prorateFromDay: '2027-01-05' }),
      ]),
    );

    // B4.4: Stale stored status='suspended' when paid before Jan 1 -> Jan 1 WAS billable -> full month (no proration)
    const evalPaidBeforeFirstNoProrate = evaluateSubscription({
      todayKst: '2027-01-05',
      graceDays: 14,
      subscription: { ...subBase, status: 'suspended', planId: 'b2b_49' } as unknown as EngineSubscription,
      invoices: [
        paidNov as unknown as EngineInvoice,
        { ...decUnpaidDue15, status: 'paid', paidAt: '2026-12-20T00:00:00Z' } as unknown as EngineInvoice,
      ],
      assignment: null,
    });
    expect(evalPaidBeforeFirstNoProrate.actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'draft', period: '2027-01', prorateFromDay: null })]),
    );

    // B4.5: manualAmounts draft is NEVER auto-issued
    const evalManualDraft = evaluateSubscription({
      todayKst: '2026-12-01',
      graceDays: 14,
      subscription: { ...subBase, status: 'active' } as unknown as EngineSubscription,
      invoices: [
        paidNov as unknown as EngineInvoice,
        {
          id: 'inv-manual',
          period: '2026-12',
          kind: 'subscription',
          coversMonths: 1,
          status: 'draft',
          planId: 'b2b_49',
          dueOn: null,
          issuedAt: null,
          manualAmounts: true,
          subscriptionEpoch: 2,
        } as unknown as EngineInvoice,
      ],
      assignment: { planId: 'b2b_49', billingMode: 'invoice', startedOn: '2026-11-10', endsOn: '2026-12-01' },
    });
    // Review round 4, A (replaces round 2, item 1): no held drafts — the job owns every subscription draft of
    // the epoch; the service refreshes it to the rule's amounts and issues it on the 1st.
    expect(evalManualDraft.actions.filter((a) => a.type === 'issue')).toEqual([
      { type: 'issue', period: '2026-12', prorateFromDay: null, dueOn: '2026-12-15' },
    ]);

    // B2: admin void of 2026-12 blocks auto-draft/issue of 2026-12; system void does NOT block
    const evalAdminVoidBlocked = evaluateSubscription({
      todayKst: '2026-12-05',
      graceDays: 14,
      subscription: { ...subBase, status: 'active' } as unknown as EngineSubscription,
      invoices: [
        paidNov as unknown as EngineInvoice,
        {
          id: 'inv-void-admin',
          period: '2026-12',
          kind: 'subscription',
          coversMonths: 1,
          status: 'void',
          planId: 'b2b_49',
          dueOn: '2026-12-15',
          issuedAt: '2026-12-01T00:00:00Z',
          voidedBy: 'admin',
          subscriptionEpoch: 2,
        } as unknown as EngineInvoice,
      ],
      assignment: { planId: 'b2b_49', billingMode: 'invoice', startedOn: '2026-11-10', endsOn: '2026-12-01' },
    });
    expect(evalAdminVoidBlocked.actions.some((a) => a.type === 'draft' || a.type === 'issue')).toBe(false);
    expect((evalAdminVoidBlocked as unknown as { adminVoidedPeriods?: string[] }).adminVoidedPeriods).toContain('2026-12');
  });

  it('review-1 C7/A1/B4.1 strengthened property test across grace ∈ {0,1,7,14}, random pay/void/restart/epoch noise', () => {
    const startDays = ['2026-11-01', '2026-11-15', '2026-11-30', '2027-02-28', '2028-02-29'] as const;
    const graces = [0, 1, 7, 14] as const;
    const paidPlans = ['b2b_29', 'b2b_49', 'b2b_69'] as const;

    for (let seed = 1; seed <= 32; seed++) {
      const rand = mulberry32(seed + 9000);
      const startedOn = startDays[seed % startDays.length]!;
      const graceDays = graces[seed % graces.length]!;
      const activatedBeforePayment = rand() < 0.3;
      const initPlan = paidPlans[Math.floor(rand() * paidPlans.length)]!;
      const currentEpoch = 2;

      let subscription = {
        status: 'pending' as const,
        planId: initPlan,
        pendingPlanId: null as (typeof paidPlans)[number] | null,
        pendingPlanEffectivePeriod: null as string | null,
        collectionMethod: 'transfer' as const,
        startedOn,
        cancelAtPeriodEnd: false,
        activatedBeforePayment,
        epoch: currentEpoch,
      } as unknown as EngineSubscription;

      let assignment: Pick<BrandPlanAssignment, 'planId' | 'billingMode' | 'startedOn' | 'endsOn'> | null = null;
      let nextInvNum = 1;

      // Seed A1 prior null-epoch and older-epoch noise invoices that MUST NEVER affect epoch 2!
      const invoices: Array<
        EngineInvoice & {
          subscriptionEpoch: number | null;
          totalKrw?: number;
          paidAt?: string | null;
          voidedAt?: string | null;
          voidedBy?: 'admin' | 'system' | null;
          manualAmounts?: boolean;
          createdAt?: string;
        }
      > = [
        {
          id: `noise-null-${seed}`,
          period: periodOfDay(startedOn),
          kind: 'subscription',
          coversMonths: 1,
          status: 'paid',
          planId: 'b2b_69',
          dueOn: startedOn,
          issuedAt: `${startedOn}T00:00:00Z`,
          paidAt: `${startedOn}T01:00:00Z`,
          subscriptionEpoch: null,
        } as never,
        {
          id: `noise-ep1-${seed}`,
          period: nextPeriodOf(periodOfDay(startedOn)),
          kind: 'subscription',
          coversMonths: 1,
          status: 'issued',
          planId: 'b2b_69',
          dueOn: '2026-11-05',
          issuedAt: '2026-10-22T00:00:00Z',
          subscriptionEpoch: 1,
        } as never,
        {
          id: `inv-${nextInvNum++}`,
          period: periodOfDay(startedOn),
          kind: 'subscription',
          coversMonths: 1,
          status: 'issued',
          planId: initPlan,
          dueOn: dueOnForMethod(startedOn, 'transfer'),
          issuedAt: `${startedOn}T00:00:00+09:00`,
          subscriptionEpoch: currentEpoch,
          totalKrw: invoiceAmounts({
            listKrw: BRAND_PLANS[initPlan].monthlyKrw,
            discountPct: 0,
            prorate: Number(startedOn.slice(8, 10)) > 1
              ? { usedDays: daysInYearMonth(periodOfDay(startedOn)) - Number(startedOn.slice(8, 10)) + 1, totalDays: daysInYearMonth(periodOfDay(startedOn)) }
              : null,
          }).totalKrw,
          createdAt: `${startedOn}T00:00:00+09:00`,
        } as never,
      ];

      const applyEval = (day: string) => {
        const res = evaluateSubscription({
          todayKst: day,
          graceDays,
          subscription,
          invoices,
          assignment,
        });
        for (const act of res.actions) {
          if (act.type === 'void') {
            const voided = invoices.find((i) => i.id === act.invoiceId)!;
            voided.status = 'void';
            voided.voidedBy = 'system';
            voided.voidedAt = `${day}T00:00:00+09:00`;
          } else if (act.type === 'applyPendingPlan') {
            subscription = { ...subscription, planId: act.toPlanId, pendingPlanId: null, pendingPlanEffectivePeriod: null } as unknown as EngineSubscription;
          } else if (act.type === 'draft') {
            invoices.push({
              id: `inv-${nextInvNum++}`,
              period: act.period,
              kind: 'subscription',
              coversMonths: 1,
              status: 'draft',
              planId: act.planId,
              dueOn: null,
              issuedAt: null,
              subscriptionEpoch: currentEpoch,
              createdAt: `${day}T00:00:00+09:00`,
              createdVia: 'system',
            } as never);
          } else if (act.type === 'issue') {
            const draft = invoices.find(
              (i) => i.subscriptionEpoch === currentEpoch && i.kind === 'subscription' && i.status === 'draft' && i.period === act.period,
            );
            expect(draft).toBeDefined();
            const prorate =
              act.prorateFromDay && act.prorateFromDay.startsWith(`${act.period}-`) && Number(act.prorateFromDay.slice(8, 10)) > 1
                ? {
                    usedDays: daysInYearMonth(act.period) - Number(act.prorateFromDay.slice(8, 10)) + 1,
                    totalDays: daysInYearMonth(act.period),
                  }
                : null;
            draft!.planId = subscription.planId;
            draft!.status = 'issued';
            draft!.dueOn = act.dueOn;
            draft!.issuedAt = `${day}T00:00:00+09:00`;
            draft!.totalKrw = invoiceAmounts({
              listKrw: BRAND_PLANS[draft!.planId].monthlyKrw,
              discountPct: 0,
              prorate,
            }).totalKrw;
          } else if (act.type === 'syncAssignment') {
            assignment = { planId: act.planId, billingMode: act.billingMode, startedOn: act.startedOn, endsOn: act.endsOn };
          } else if (act.type === 'clearAssignment') {
            assignment = null;
          } else if (act.type === 'setStatus') {
            subscription = { ...subscription, status: act.to };
          } else if (act.type === 'end') {
            subscription = { ...subscription, status: 'ended' };
          }
        }
        return res;
      };

      for (let d = 0; d < 420; d++) {
        const day = addCalendarDays(startedOn, d);
        if (subscription.status !== 'ended') {
          const r = rand();
          const epochUnpaid = invoices.filter((i) => i.subscriptionEpoch === currentEpoch && i.status === 'issued');
          if (epochUnpaid.length > 0 && r < 0.1) {
            // Pay a RANDOM unpaid invoice (not always oldest)
            const pick = epochUnpaid[Math.floor(rand() * epochUnpaid.length)]!;
            pick.status = 'paid';
            pick.paidAt = `${day}T02:00:00+09:00`;
          } else if (epochUnpaid.length > 0 && r >= 0.1 && r < 0.115) {
            // Random admin void
            const pick = epochUnpaid[Math.floor(rand() * epochUnpaid.length)]!;
            pick.status = 'void';
            pick.voidedAt = `${day}T02:00:00+09:00`;
            pick.voidedBy = 'admin';
          } else if (!subscription.cancelAtPeriodEnd && r >= 0.115 && r < 0.13) {
            const paidEndBefore = computeAccessEnd({ subscription, invoices });
            subscription = { ...subscription, cancelAtPeriodEnd: true, pendingPlanId: null };
            const paidEndAfter = computeAccessEnd({ subscription, invoices });
            if (paidEndBefore && paidEndAfter) {
              expect(paidEndAfter >= paidEndBefore).toBe(true);
            }
          } else if (subscription.cancelAtPeriodEnd && r >= 0.13 && r < 0.145) {
            subscription = { ...subscription, cancelAtPeriodEnd: false };
          } else if (!subscription.cancelAtPeriodEnd && subscription.pendingPlanId === null && r >= 0.145 && r < 0.17) {
            const idx = paidPlans.indexOf(subscription.planId as (typeof paidPlans)[number]);
            if (idx > 0) {
              subscription = {
                ...subscription,
                pendingPlanId: paidPlans[idx - 1]!,
                pendingPlanEffectivePeriod: nextPeriodOf(periodOfDay(day)),
              } as unknown as EngineSubscription;
            }
          }
        }

        const evalRes = applyEval(day);

        // (a) At most one non-void current-epoch subscription invoice per period
        const curPeriods = invoices
          .filter((i) => i.subscriptionEpoch === currentEpoch && i.kind === 'subscription' && i.status !== 'void')
          .map((i) => i.period);
        expect(new Set(curPeriods).size).toBe(curPeriods.length);

        // (b) ends_on + status ALWAYS matches planActiveWithGrace over grace ∈ {0,1,7,14}
        const activeNow = planActiveWithGrace(assignment, day, graceDays).active;
        const epochHasUnpaid = invoices.some((i) => i.subscriptionEpoch === currentEpoch && i.status === 'issued');
        const epochHasPaid = invoices.some((i) => i.subscriptionEpoch === currentEpoch && i.status === 'paid');
        const inactiveStatus =
          subscription.status === 'suspended' ||
          subscription.status === 'ended' ||
          (subscription.status === 'pending' && !epochHasPaid && !(subscription.activatedBeforePayment && epochHasUnpaid));
        const endedAssign = assignment as { endsOn: string | null } | null;
        expect(inactiveStatus, `seed=${seed} grace=${graceDays} day=${day} status=${subscription.status} accessEnd=${endedAssign?.endsOn ?? 'null'}`).toBe(!activeNow);

        // (c) Issued invoice totals equal invoiceAmounts
        for (const inv of invoices) {
          if (inv.subscriptionEpoch === currentEpoch && inv.status === 'issued' && inv.totalKrw !== undefined) {
            expect(inv.totalKrw).toBeGreaterThanOrEqual(0);
          }
        }

        // (e) Idempotency: re-evaluating emits ZERO actions
        const second = evaluateSubscription({ todayKst: day, graceDays, subscription, invoices, assignment });
        expect(second.actions, `seed=${seed} grace=${graceDays} day=${day} second=${JSON.stringify(evalRes.actions)}`).toEqual([]);
      }
    }
  });
});
