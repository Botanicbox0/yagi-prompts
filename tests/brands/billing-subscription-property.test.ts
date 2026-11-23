import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  daysInYearMonth,
  invoiceAmounts,
  planActiveWithGrace,
  type PaidBrandPlanId,
} from '@/lib/brands/billing/math';
import { BRAND_PLANS, type BrandBillingMode } from '@/lib/brands/plans';
import {
  dueOnForInvoice,
  dueOnForMethod,
  evaluateSubscription,
  findAdminVoidedPeriods,
  firstInvoiceExpiryDay,
  firstInvoiceRuleApplies,
  invoicesAsOfDay,
  pendingPlanCarriedByInvoice,
  periodsHeldByOlderEpoch,
  firstDayOfPeriod,
  lastDayOfPeriod,
  nextPeriodOf,
  periodOfDay,
  subscriptionCalendarForDay,
  subscriptionNeedsReissue,
  wasBillableOnDay,
  type BrandSubscriptionStatus,
  type EngineInvoice,
  type EngineSubscription,
} from '@/lib/brands/subscriptions/engine';

/**
 * Review rounds 1 and 2 (C7, A1, B2, B4; round 2 items 1, 3, 4, 8, 10): a day-by-day simulation of one
 * organization's subscription that drives the pure engine exactly like the service does (apply every returned
 * action) and mixes in what admins and customers do: pay a RANDOM unpaid invoice, admin void (waives a month
 * after a paid one), cancel / undo, downgrade / clear, reissue, restart after the end, and (rounds 4–5) only what
 * admins can still do to a subscribed organization's invoices: memo edits, voids of drafts and issued invoices,
 * mark paid (also an on-time first payment recorded late), plus refused attempts (create a draft, change
 * amounts, issue by hand) that must change nothing, and flag-off interludes that leave null-epoch drafts behind.
 * Every issued invoice comes from the job or a reissue and is amount-checked. On EVERY simulated day it checks:
 *
 *   (a) at most one non-void subscription invoice per period (the database's unique index is global);
 *   (b) the plan assignment equals rule B4.1 + waived/held coverage, computed independently from the invoices;
 *   (B4.1) status suspended/ended/pending-without-access <=> planActiveWithGrace false (grace 0/1/7/14);
 *   (c) every invoice the job or a reissue issues equals invoiceAmounts for the plan, discount and proration
 *       in force on its issue day (proration/plan from an independent oracle: the status recorded on the 1st);
 *       (round 4) a downgrade is in force on every day of a period whose invoice carries it; a late-recorded
 *       on-time first payment is accepted and yields a full next month; no access on an uncovered day;
 *   (d) a cancel never ends access before the paid period's end;
 *   (e) applying the returned actions and evaluating again yields no actions;
 *   (A1) null-epoch and older-epoch invoices never change the engine's output;
 *   (B2) an admin-voided period is never drafted or issued by the engine itself;
 *   (round 2) never `suspended` while nothing is owed; access never comes back by time alone; a subscription
 *       with nothing paid and nothing open is never billed; the next month's draft opens exactly on D-7 —
 *       never on D-8, always by D-7 — at the plan in force for that month;
 *   (§4.1) no billing while restricted; paying every unpaid invoice restores `active`.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Assignment = { planId: PaidBrandPlanId; billingMode: BrandBillingMode; startedOn: string; endsOn: string | null } | null;

interface SimInvoice extends EngineInvoice {
  totalKrw: number;
  prorateFromDay: string | null;
}

const PLANS: readonly PaidBrandPlanId[] = ['b2b_29', 'b2b_49', 'b2b_69'];
const GRACES = [0, 1, 7, 14] as const;
const START_DAYS = [
  '2026-11-01',
  '2026-11-15',
  '2026-11-29',
  '2026-11-30',
  '2026-12-31',
  '2027-01-31',
  '2027-02-28',
  '2027-12-25',
  '2028-01-31',
  '2028-02-29',
] as const;

const stampAt = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00+09:00`;

function prorateFrom(fromDay: string | null, period: string): { usedDays: number; totalDays: number } | null {
  if (!fromDay || !fromDay.startsWith(`${period}-`)) return null;
  const day = Number(fromDay.slice(8, 10));
  if (day <= 1) return null;
  const totalDays = daysInYearMonth(period);
  return { usedDays: totalDays - day + 1, totalDays };
}

function totalFor(planId: PaidBrandPlanId, discountPct: number, fromDay: string | null, period: string): number {
  return invoiceAmounts({ listKrw: BRAND_PLANS[planId].monthlyKrw, discountPct, prorate: prorateFrom(fromDay, period) })
    .totalKrw;
}

function effectiveFrom(sub: EngineSubscription): string {
  return sub.pendingPlanEffectivePeriod ?? nextPeriodOf(periodOfDay(sub.startedOn));
}

/** Round 4, A: every subscription draft of the epoch is the job's (admins cannot create one or change amounts). */
const engineOwned = (inv: EngineInvoice) => inv.status === 'draft';

describe('brand subscription engine — property simulation (rounds 1 and 2)', () => {
  it('holds every invariant on every day over 18+ months for grace 0/1/7/14, random events and restarts', () => {
    const counts = {
      days: 0,
      issuedChecked: 0,
      restarts: 0,
      adminVoids: 0,
      waivedDays: 0,
      reissues: 0,
      cancels: 0,
      restoredFromSuspended: 0,
      gapResumes: 0,
      expired: 0,
      needsReissueDays: 0,
      memoEdits: 0,
      refusedAttempts: 0,
      cancelChecks: 0,
      nullEpochVoids: 0,
      expiryChecks: 0,
      lateFirstPaid: 0,
      downgradesApplied: 0,
      uncoveredChecks: 0,
      d7Drafts: 0,
    };

    for (let seed = 1; seed <= 48; seed++) {
      const rand = mulberry32(seed * 7919);
      const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
      const graceDays = GRACES[seed % GRACES.length]!;
      const discountPct = seed % 3 === 0 ? 20 : 0;
      const firstStart = START_DAYS[seed % START_DAYS.length]!;
      const payChance = [0.1, 0.03, 0.012][Math.floor(seed / 4) % 3]!;

      let nextId = 1;
      const invoices: SimInvoice[] = [];
      let assignment: Assignment = null;
      let sub: EngineSubscription = {
        status: 'pending',
        planId: pick(PLANS),
        pendingPlanId: null,
        pendingPlanEffectivePeriod: null,
        collectionMethod: 'transfer',
        startedOn: firstStart,
        cancelAtPeriodEnd: false,
        activatedBeforePayment: rand() < 0.3,
        epoch: 3,
      };
      const history = new Map<string, { status: string; basis: boolean; epoch: number }>();
      let prevActive = false;

      const epochInvoices = () => invoices.filter((i) => i.subscriptionEpoch === sub.epoch);

      // A1 noise: invoices that are NOT of the current epoch and must never change the engine's output. Since
      // round 3 the service adopts null-epoch invoices from the epoch's start month on, and an older epoch's
      // non-void invoice holds its month, so non-void noise sits before the first start; void noise anywhere.
      const noise: EngineInvoice[] = [];
      for (let k = 0; k < 6; k++) {
        const status = pick(['paid', 'void', 'issued', 'draft'] as const);
        const offset = status === 'void' ? Math.floor(rand() * 500) - 30 : -Math.floor(rand() * 300) - 35;
        const period = periodOfDay(addCalendarDays(`${periodOfDay(firstStart)}-01`, offset));
        const issuedDay = `${period}-01`;
        noise.push({
          id: `noise-${seed}-${k}`,
          period,
          kind: 'subscription',
          coversMonths: 1,
          status,
          planId: pick(PLANS),
          dueOn: status === 'draft' ? null : addCalendarDays(issuedDay, 14),
          issuedAt: status === 'draft' ? null : stampAt(issuedDay, 9),
          paidAt: status === 'paid' ? stampAt(issuedDay, 12) : null,
          voidedAt: status === 'void' ? stampAt(issuedDay, 12) : null,
          voidedBy: status === 'void' ? pick(['admin', 'system'] as const) : null,
          createdAt: stampAt(issuedDay, 8),
          createdVia: pick(['admin', 'system'] as const),
          subscriptionEpoch: pick([null, 1, 2] as const),
        });
      }

      const newInvoice = (over: Partial<SimInvoice> & Pick<SimInvoice, 'period' | 'status' | 'planId'>): SimInvoice => {
        const inv: SimInvoice = {
          id: `inv-${seed}-${nextId++}`,
          kind: 'subscription',
          coversMonths: 1,
          dueOn: null,
          issuedAt: null,
          paidAt: null,
          voidedAt: null,
          voidedBy: null,
          createdAt: null,
          subscriptionEpoch: sub.epoch,
          manualAmounts: false,
          createdVia: 'system',
          totalKrw: 0,
          prorateFromDay: null,
          ...over,
        };
        invoices.push(inv);
        return inv;
      };

      const startEpoch = (day: string) => {
        const period = periodOfDay(day);
        // Round 3, item 1: a first invoice without early access is due inside its month.
        const dueOn = sub.activatedBeforePayment
          ? dueOnForMethod(day, 'transfer')
          : dueOnForInvoice({ issueDay: day, period, method: 'transfer', firstInvoiceWithoutEarlyAccess: { startedOn: day } });
        newInvoice({
          period,
          status: 'issued',
          planId: sub.planId,
          dueOn,
          issuedAt: stampAt(day, 10),
          createdAt: stampAt(day, 10),
          createdVia: 'admin',
          totalKrw: totalFor(sub.planId as PaidBrandPlanId, discountPct, day, period),
          prorateFromDay: day,
        });
        assignment = sub.activatedBeforePayment
          ? { planId: sub.planId as PaidBrandPlanId, billingMode: 'invoice', startedOn: day, endsOn: dueOn }
          : null;
      };
      startEpoch(firstStart);

      // Independent oracle for B4.4 / B4.3: billable on the 1st of `period`, read from the status the
      // simulation RECORDED on that day (not recomputed by the engine).
      const billableOnFirstOracle = (period: string, today: string, before: EngineSubscription, todayBillable: boolean): boolean => {
        const day1 = firstDayOfPeriod(period);
        if (day1 < before.startedOn) return false;
        if (today === day1) return todayBillable;
        const h = history.get(day1);
        if (!h || h.epoch !== before.epoch) return false;
        return h.status === 'active' || h.status === 'past_due' || (h.status === 'pending' && h.basis);
      };

      const checkIssued = (
        inv: SimInvoice,
        today: string,
        before: EngineSubscription,
        label: string,
        todayBillable = true,
        expectedDue = dueOnForInvoice({ issueDay: today, period: inv.period, method: 'transfer' }),
      ) => {
        const billableFirst = billableOnFirstOracle(inv.period, today, before, todayBillable);
        const expectedFrom = billableFirst ? null : today;
        const pendingApplies =
          billableFirst &&
          before.pendingPlanId !== null &&
          before.pendingPlanId !== before.planId &&
          inv.period >= effectiveFrom(before);
        const expectedPlan = (pendingApplies ? before.pendingPlanId : before.planId) as PaidBrandPlanId;
        expect(inv.planId, `${label} plan in force`).toBe(expectedPlan);
        expect(inv.totalKrw, `${label} amount`).toBe(totalFor(expectedPlan, discountPct, expectedFrom, inv.period));
        expect(inv.dueOn, `${label} due`).toBe(expectedDue);
        counts.issuedChecked += 1;
      };

      const evaluate = (today: string, withNoise: boolean) =>
        evaluateSubscription({
          todayKst: today,
          graceDays,
          subscription: sub,
          invoices: withNoise ? [...invoices, ...noise] : invoices,
          assignment,
          olderEpochPeriods: periodsHeldByOlderEpoch(sub, invoices),
        });

      // Mirrors `refreshFutureSubscriptionDrafts` (round 4): the job's drafts of future months follow the plan
      // that will be in force for them when a downgrade is scheduled or cleared.
      const refreshFutureDrafts = (today: string) => {
        for (const inv of epochInvoices()) {
          if (inv.status !== 'draft' || inv.period <= periodOfDay(today)) continue;
          const plan = (sub.pendingPlanId !== null && inv.period >= effectiveFrom(sub) ? sub.pendingPlanId : sub.planId) as PaidBrandPlanId;
          inv.planId = plan;
          inv.prorateFromDay = null;
          inv.totalKrw = totalFor(plan, discountPct, null, inv.period);
        }
      };

      const voidAs = (inv: SimInvoice, today: string, by: 'admin' | 'system') => {
        inv.status = 'void';
        inv.voidedAt = stampAt(today, 9);
        inv.voidedBy = by;
      };

      const lastDay = addCalendarDays(firstStart, 560);
      for (let today: string = firstStart; today <= lastDay; today = addCalendarDays(today, 1)) {
        const currentPeriod = periodOfDay(today);
        const cal = subscriptionCalendarForDay(today);
        let paidToday = false;
        let lateFirstPaidToday = false;
        let eventToday = today === sub.startedOn; // the start itself opens early access
        const paidCoverEndAtDayStart = (() => {
          const ends = epochInvoices().filter((i) => i.status === 'paid').map((i) => firstDayOfPeriod(nextPeriodOf(i.period)));
          return ends.length > 0 ? ends.sort().at(-1)! : null;
        })();
        const unpaidAtDayStart = epochInvoices().some((i) => i.status === 'issued');

        if (sub.status === 'ended') {
          const anyTaken = invoices.some((i) => i.kind === 'subscription' && i.status !== 'void' && i.period >= currentPeriod);
          if (!anyTaken && rand() < 0.03) {
            counts.restarts += 1;
            eventToday = true;
            sub = {
              status: 'pending',
              planId: pick(PLANS),
              pendingPlanId: null,
              pendingPlanEffectivePeriod: null,
              collectionMethod: 'transfer',
              startedOn: today,
              cancelAtPeriodEnd: false,
              activatedBeforePayment: rand() < 0.3,
              epoch: sub.epoch + 1,
            };
            startEpoch(today);
          }
        } else {
          const r = rand();
          const epoch = epochInvoices();
          const open = epoch.filter((i) => i.status === 'issued');
          const voidable = epoch.filter((i) => i.status === 'issued' || i.status === 'draft');
          const ownDrafts = epoch.filter(engineOwned);
          // Round 4, B3 / C (c): the first invoice (no early access, nothing paid) was paid on time but the admin
          // records it only after its month ended (up to 7 days later), with the real paid date.
          const firstLate = epoch.find(
            (i) =>
              i.status === 'issued' &&
              !sub.activatedBeforePayment &&
              !epoch.some((x) => x.status === 'paid') &&
              i.period < currentPeriod &&
              today < firstInvoiceExpiryDay(i.period),
          );
          if (firstLate && rand() < 0.1) {
            const issueDay = firstLate.issuedAt!.slice(0, 10);
            const span = Math.max(0, Math.round((Date.parse(firstLate.dueOn!) - Date.parse(issueDay)) / 86_400_000));
            const paidDay = addCalendarDays(issueDay, Math.floor(rand() * (span + 1)));
            expect(paidDay <= firstLate.dueOn!, 'late-recorded payment after due').toBe(true);
            firstLate.status = 'paid';
            firstLate.paidAt = stampAt(paidDay, 9);
            paidToday = true;
            lateFirstPaidToday = true;
            eventToday = true;
            counts.lateFirstPaid += 1;
            // The facts as of the 1st now include that payment (the oracle reads the corrected fact).
            const day1 = firstDayOfPeriod(currentPeriod);
            if (day1 >= sub.startedOn && !sub.cancelAtPeriodEnd) history.set(day1, { status: 'active', basis: true, epoch: sub.epoch });
          } else if (r < payChance && open.length > 0) {
            const inv = pick(open);
            inv.status = 'paid';
            inv.paidAt = stampAt(today, 9);
            paidToday = true;
            eventToday = true;
          } else if (r >= 0.2 && r < 0.212 && voidable.length > 0) {
            voidAs(pick(voidable), today, 'admin');
            counts.adminVoids += 1;
            eventToday = true;
          } else if (r >= 0.212 && r < 0.216 && !sub.cancelAtPeriodEnd) {
            // Mirrors `cancelSubscription` (round 2, item 4): nothing paid -> every unpaid invoice and draft is
            // voided by the system; something paid -> future drafts and the job's own current-month draft.
            counts.cancels += 1;
            eventToday = true;
            const hasPaid = epoch.some((i) => i.status === 'paid');
            // Round 4, B1: a downgrade an issued or paid invoice already carries survives the cancel.
            const carried = pendingPlanCarriedByInvoice(sub, invoices, today);
            if (carried !== null) {
              sub = { ...sub, planId: carried };
              counts.downgradesApplied += 1;
            }
            for (const inv of epoch) {
              if (!hasPaid) {
                if (inv.status === 'draft' || inv.status === 'issued') voidAs(inv, today, 'system');
              } else if (inv.status === 'issued' && inv.period > currentPeriod) {
                voidAs(inv, today, 'system'); // round 5, A5 guard
              } else if (inv.status === 'draft' && (inv.period > currentPeriod || (inv.period === currentPeriod && engineOwned(inv)))) {
                voidAs(inv, today, 'system');
              }
            }
            sub = { ...sub, cancelAtPeriodEnd: true, pendingPlanId: null, pendingPlanEffectivePeriod: null };
          } else if (r >= 0.216 && r < 0.236 && sub.cancelAtPeriodEnd) {
            sub = { ...sub, cancelAtPeriodEnd: false };
            eventToday = true;
          } else if (r >= 0.236 && r < 0.26 && !sub.cancelAtPeriodEnd && sub.pendingPlanId === null) {
            const rank = PLANS.indexOf(sub.planId as PaidBrandPlanId);
            if (rank > 0) {
              sub = { ...sub, pendingPlanId: PLANS[Math.floor(rand() * rank)]!, pendingPlanEffectivePeriod: nextPeriodOf(currentPeriod) };
              refreshFutureDrafts(today);
            }
          } else if (r >= 0.26 && r < 0.268 && sub.pendingPlanId !== null) {
            sub = { ...sub, pendingPlanId: null, pendingPlanEffectivePeriod: null };
            refreshFutureDrafts(today);
          } else if (r >= 0.268 && r < 0.33 && !sub.cancelAtPeriodEnd) {
            // Mirrors `reissueSubscriptionPeriod`: this month voided by an admin, or nothing paid and nothing open.
            const live = epoch.some((i) => i.status !== 'void' && i.period === currentPeriod);
            const allowed =
              !live &&
              (findAdminVoidedPeriods(epoch).includes(currentPeriod) || subscriptionNeedsReissue(sub, invoices));
            if (allowed) {
              const before = { ...sub };
              // A subscription with nothing paid and nothing open is not billable (no access basis).
              const reissueBillableToday = !subscriptionNeedsReissue(sub, invoices);
              const billableFirst = wasBillableOnDay({ targetDay: firstDayOfPeriod(currentPeriod), graceDays, subscription: sub, invoices });
              const fromDay = billableFirst ? null : today;
              const applies =
                billableFirst && sub.pendingPlanId !== null && sub.pendingPlanId !== sub.planId && currentPeriod >= effectiveFrom(sub);
              if (applies) sub = { ...sub, planId: sub.pendingPlanId!, pendingPlanId: null, pendingPlanEffectivePeriod: null };
              // Nothing paid and no early access: a first invoice (it expires after its month), due inside it.
              const firstInvoiceRule = firstInvoiceRuleApplies(sub, invoices);
              const reissueDue = dueOnForInvoice({
                issueDay: today,
                period: currentPeriod,
                method: 'transfer',
                ...(firstInvoiceRule ? { firstInvoiceWithoutEarlyAccess: { startedOn: sub.startedOn } } : {}),
              });
              const reissued = newInvoice({
                period: currentPeriod,
                status: 'issued',
                planId: sub.planId,
                dueOn: reissueDue,
                issuedAt: stampAt(today, 9),
                createdAt: stampAt(today, 9),
                createdVia: 'admin',
                totalKrw: totalFor(sub.planId as PaidBrandPlanId, discountPct, fromDay, currentPeriod),
                prorateFromDay: fromDay,
              });
              counts.reissues += 1;
              eventToday = true;
              checkIssued(reissued, today, before, `seed=${seed} grace=${graceDays} day=${today} reissue`, reissueBillableToday, reissueDue);
            }
          } else if (r >= 0.33 && r < 0.345 && ownDrafts.length > 0) {
            // Round 4, A2: a memo-only edit of the job's draft — allowed, changes nothing the job decides.
            counts.memoEdits += 1;
          } else if (r >= 0.345 && r < 0.375) {
            // Round 5, A / C (a): an admin tries to create a subscription draft, change a draft's amounts or issue
            // one by hand. The service refuses each (integration tests); here: the state must not change at all.
            const snapshot = JSON.stringify([invoices, sub, assignment]);
            counts.refusedAttempts += 1;
            expect(JSON.stringify([invoices, sub, assignment]), 'refused admin action changed state').toBe(snapshot);
          } else if (r >= 0.375 && r < 0.385) {
            // Round 4, A4 / round 5: a flag-off interlude leaves a null-epoch draft for this or next month (the
            // reconcile voids it). Issued leftovers are covered by integration tests: their amounts are an
            // admin's, and here every issued invoice must pass the amount check (C c).
            const period = rand() < 0.5 ? currentPeriod : cal.nextPeriod;
            const taken = invoices.some((i) => i.kind === 'subscription' && i.status !== 'void' && i.period === period);
            if (!taken && period >= periodOfDay(sub.startedOn)) {
              const issued = false;
              newInvoice({
                period,
                status: issued ? 'issued' : 'draft',
                planId: sub.planId,
                createdAt: stampAt(today, 9),
                issuedAt: null,
                dueOn: null,
                createdVia: null,
                subscriptionEpoch: null,
                totalKrw: totalFor(sub.planId as PaidBrandPlanId, 0, null, period),
              });
              eventToday = true;
            }
          }
        }

        // Round 4, A4: before the engine the service voids null-epoch DRAFTS from the epoch's start month on (as
        // the system) and adopts null-epoch issued/paid invoices, writing a missing due date by the usual rule.
        if (sub.status !== 'ended') {
          const startPeriod = periodOfDay(sub.startedOn);
          const nullEpoch = invoices.filter(
            (i) => i.subscriptionEpoch === null && i.kind === 'subscription' && i.status !== 'void' && i.period >= startPeriod,
          );
          for (const inv of [...nullEpoch].sort((a, b) => Number(b.status === 'paid') - Number(a.status === 'paid'))) {
            if (inv.status === 'draft') {
              voidAs(inv, today, 'system');
              counts.nullEpochVoids += 1;
              continue;
            }
            // Issued null-epoch leftovers (adopted with a due date) are covered by integration tests.
            throw new Error(`unexpected null-epoch ${inv.status} invoice in the simulation`);
          }
        }
        const before: EngineSubscription = { ...sub };
        const nothingUnpaidBefore = !epochInvoices().some((i) => i.status === 'issued');
        // Round 3, item 7b + round 4, B3: a never-paid first invoice without early access MUST be voided on its
        // expiry day (the 8th day after its month) — and never before.
        const mustExpire = epochInvoices().filter(
          (i) =>
            sub.status !== 'ended' &&
            !sub.activatedBeforePayment &&
            i.status === 'issued' &&
            today >= firstInvoiceExpiryDay(i.period) &&
            !epochInvoices().some((x) => x.status === 'paid'),
        );
        const paidEndBefore = (() => {
          const ends = epochInvoices().filter((i) => i.status === 'paid').map((i) => firstDayOfPeriod(nextPeriodOf(i.period)));
          return ends.length > 0 ? ends.sort().at(-1)! : null;
        })();
        const result = evaluate(today, false);
        const label = `seed=${seed} grace=${graceDays} day=${today} status=${sub.status}`;

        expect(evaluate(today, true), `${label} A1 noise changed the output`).toEqual(result);
        for (const inv of mustExpire) {
          expect(
            result.actions.some((a) => a.type === 'void' && a.invoiceId === inv.id && a.reason === 'first_invoice_expired'),
            `${label} first invoice ${inv.period} not expired`,
          ).toBe(true);
          expect(inv.dueOn! <= lastDayOfPeriod(inv.period), `${label} first invoice due after its month`).toBe(true);
          counts.expiryChecks += 1;
        }

        const blockedBefore = new Set(findAdminVoidedPeriods(epochInvoices()));
        const needsReissueBefore = sub.status !== 'ended' && subscriptionNeedsReissue(sub, invoices);
        for (const action of result.actions) {
          if (action.type === 'draft' || action.type === 'issue') {
            expect(blockedBefore.has(action.period), `${label} engine touched admin-voided ${action.period}`).toBe(false);
            expect(needsReissueBefore, `${label} billed with nothing paid and nothing open`).toBe(false);
          }
          if (action.type === 'draft' && action.period === cal.nextPeriod) {
            expect(today >= cal.nextDraftOpenDay, `${label} next-month draft before D-7`).toBe(true);
            const expectedPlan = action.planId;
            const applied = result.actions.find((a) => a.type === 'applyPendingPlan');
            const planAfterApply = applied && applied.type === 'applyPendingPlan' ? applied.toPlanId : before.planId;
            const pendingAfter = applied ? null : before.pendingPlanId;
            const expected =
              pendingAfter !== null && pendingAfter !== planAfterApply && cal.nextPeriod >= effectiveFrom(before)
                ? pendingAfter
                : planAfterApply;
            expect(expectedPlan, `${label} next-month draft plan`).toBe(expected);
            counts.d7Drafts += 1;
          }
        }

        for (const action of result.actions) {
          if (action.type === 'void') {
            const inv = invoices.find((i) => i.id === action.invoiceId)!;
            expect(inv.subscriptionEpoch, `${label} void outside the epoch`).toBe(sub.epoch);
            if (action.reason === 'first_invoice_expired') {
              expect(inv.status === 'issued' && !sub.activatedBeforePayment && today >= firstInvoiceExpiryDay(inv.period), `${label} expired early`).toBe(true);
              counts.expired += 1;
            } else {
              expect(engineOwned(inv) && inv.period < currentPeriod, `${label} voided a draft it does not own`).toBe(true);
            }
            voidAs(inv, today, 'system');
          } else if (action.type === 'applyPendingPlan') {
            sub = { ...sub, planId: action.toPlanId, pendingPlanId: null, pendingPlanEffectivePeriod: null };
            counts.downgradesApplied += 1;
          } else if (action.type === 'draft') {
            newInvoice({
              period: action.period,
              status: 'draft',
              planId: action.planId,
              createdAt: stampAt(today, 10),
              createdVia: 'system',
              totalKrw: totalFor(action.planId, discountPct, action.prorateFromDay, action.period),
              prorateFromDay: action.prorateFromDay,
            });
          } else if (action.type === 'issue') {
            const draft = epochInvoices().find((i) => i.status === 'draft' && i.period === action.period);
            expect(draft, `${label} issue without a draft`).toBeDefined();
            expect(engineOwned(draft!), `${label} the job issued a draft it does not own`).toBe(true);
            draft!.planId = sub.planId;
            draft!.prorateFromDay = action.prorateFromDay;
            draft!.totalKrw = totalFor(sub.planId as PaidBrandPlanId, discountPct, action.prorateFromDay, action.period);
            draft!.status = 'issued';
            draft!.dueOn = action.dueOn;
            draft!.issuedAt = stampAt(today, 10);
            checkIssued(draft!, today, before, `${label} period=${action.period}`);
          } else if (action.type === 'syncAssignment') {
            assignment = { planId: action.planId, billingMode: action.billingMode, startedOn: action.startedOn, endsOn: action.endsOn };
          } else if (action.type === 'clearAssignment') {
            assignment = null;
          } else if (action.type === 'setStatus') {
            sub = { ...sub, status: action.to };
          } else if (action.type === 'end') {
            sub = { ...sub, status: 'ended' };
          }
        }

        const after = `${label}->${sub.status} assignment=${JSON.stringify(assignment)}`;

        // Round 4, C (a): a downgrade is in force on every day of a period whose issued or paid invoice carries it.
        if (sub.status !== 'ended' && sub.pendingPlanId !== null) {
          const carriedAfter = epochInvoices().find(
            (i) =>
              (i.status === 'issued' || i.status === 'paid') &&
              i.period >= effectiveFrom(sub) &&
              i.period <= currentPeriod &&
              i.planId === sub.pendingPlanId,
          );
          expect(carriedAfter, `${after} downgrade carried by ${carriedAfter?.period} not in force`).toBeUndefined();
        }
        // Round 4, C (c): an on-time first payment recorded late is accepted and the month is billed in full.
        if (lateFirstPaidToday && sub.status !== 'ended' && !sub.cancelAtPeriodEnd) {
          const cur = epochInvoices().find((i) => i.period === currentPeriod && i.status !== 'void');
          if (cur && cur.issuedAt?.startsWith(today)) {
            expect(cur.prorateFromDay, `${after} late-recorded first payment: month not billed in full`).toBeNull();
          }
        }

        // (a)
        const nonVoid = invoices.filter((i) => i.kind === 'subscription' && i.status !== 'void').map((i) => i.period);
        expect(new Set(nonVoid).size, `${after} duplicate period`).toBe(nonVoid.length);

        // (e)
        expect(evaluate(today, false).actions, `${after} not idempotent`).toEqual([]);
        expect(evaluate(today, true).actions, `${after} not idempotent with noise`).toEqual([]);

        // Independent B4.1 + round-2 coverage oracle.
        const epoch = epochInvoices();
        const paidPeriods = epoch.filter((i) => i.status === 'paid').map((i) => i.period);
        const earliestPaid = paidPeriods.length > 0 ? [...paidPeriods].sort()[0]! : null;
        const latestOf = (period: string) =>
          [...epoch.filter((i) => i.period === period)].sort((x, y) => (x.createdAt ?? '').localeCompare(y.createdAt ?? '') || x.id.localeCompare(y.id)).at(-1);
        const periods = [...new Set(epoch.map((i) => i.period))];
        // Round 3, item 4: waived only when an admin voided the month AFTER it was issued.
        const waived = periods.filter((p) => {
          const last = latestOf(p);
          return last?.status === 'void' && last.voidedBy === 'admin' && last.issuedAt !== null && earliestPaid !== null && earliestPaid < p;
        });
        const coverEnds = [...paidPeriods, ...waived].map((p) => firstDayOfPeriod(nextPeriodOf(p)));
        const coverageEnd = coverEnds.length > 0 ? coverEnds.sort().at(-1)! : null;
        const unpaid = epoch.filter((i) => i.status === 'issued');
        const oldestDue = unpaid.length > 0 ? unpaid.map((i) => i.dueOn!).sort()[0]! : null;
        // Early access needs an ISSUED invoice.
        const basis = paidPeriods.length > 0 || (sub.activatedBeforePayment && epoch.some((i) => i.status === 'issued'));
        history.set(today, { status: sub.status, basis, epoch: sub.epoch });
        if (waived.includes(currentPeriod)) counts.waivedDays += 1;

        if (sub.status === 'ended' || !basis) {
          expect(assignment, `${after} assignment must be absent`).toBeNull();
        } else {
          const expectedEnd = oldestDue ?? coverageEnd;
          if (expectedEnd === null) {
            expect(assignment, `${after} no anchor -> no assignment`).toBeNull();
          } else {
            expect(assignment, `${after} B4.1 ends_on`).toEqual({
              planId: sub.planId,
              billingMode: 'invoice',
              startedOn: sub.startedOn < expectedEnd ? sub.startedOn : addCalendarDays(expectedEnd, -1),
              endsOn: expectedEnd,
            });
          }
        }
        if (assignment) expect(assignment.endsOn! > assignment.startedOn, `${after} ends_on after started_on`).toBe(true);

        const active = planActiveWithGrace(assignment, today, graceDays).active;
        // Round 4, C (e): no access on a day not covered by a paid or waived period, an unpaid invoice within due +
        // grace (with a payment before, or early access).
        if (active) {
          const coveredByPayment = coverageEnd !== null && today < coverageEnd;
          const withinUnpaid =
            (paidPeriods.length > 0 || sub.activatedBeforePayment) &&
            unpaid.some((i) => planActiveWithGrace({ startedOn: '0001-01-01', endsOn: i.dueOn! }, today, graceDays).active);
          expect(coveredByPayment || withinUnpaid, `${after} access on an uncovered day`).toBe(true);
          counts.uncoveredChecks += 1;
        }
        const inactiveStatus = sub.status === 'suspended' || sub.status === 'ended' || (sub.status === 'pending' && !basis);
        expect(inactiveStatus, `${after} status vs planActiveWithGrace`).toBe(!active);
        if (!inactiveStatus) {
          const overdue = unpaid.some((i) => today > i.dueOn!);
          expect(sub.status === 'past_due', `${after} past_due iff an unpaid invoice is overdue`).toBe(overdue);
          if (!overdue) expect(sub.status === 'pending', `${after} pending iff nothing paid`).toBe(paidPeriods.length === 0);
        }

        // (round 2) never suspended while nothing is owed; never back by time alone; needs-reissue never billed.
        if (sub.status === 'suspended') expect(unpaid.length, `${after} suspended with nothing owed`).toBeGreaterThan(0);
        if (!prevActive && active && sub.epoch === before.epoch) {
          expect(eventToday, `${after} access came back without any event`).toBe(true);
        }
        prevActive = active;
        if (sub.status !== 'ended' && subscriptionNeedsReissue(sub, invoices, today)) {
          counts.needsReissueDays += 1;
          expect(sub.status, `${after} needs-reissue must be pending`).toBe('pending');
          expect(assignment, `${after} needs-reissue has no access`).toBeNull();
        }

        // D-7: "always by D-7" — once D-7 has come, a billable subscription has next month's invoice.
        const billableAfter =
          !sub.cancelAtPeriodEnd &&
          (sub.status === 'active' || sub.status === 'past_due' || (sub.status === 'pending' && basis));
        if (billableAfter && today >= cal.nextDraftOpenDay && !findAdminVoidedPeriods(epoch).includes(cal.nextPeriod)) {
          expect(
            epoch.some((i) => i.period === cal.nextPeriod && i.status !== 'void'),
            `${after} next month not drafted by D-7`,
          ).toBe(true);
        }

        // (§4.1) no billing while restricted.
        const restricted = sub.status === 'suspended' || sub.status === 'ended' || sub.cancelAtPeriodEnd || (sub.status === 'pending' && !basis);
        if (restricted) {
          expect(result.actions.some((a) => a.type === 'draft' || a.type === 'issue'), `${after} billed while restricted`).toBe(false);
        }

        // Round 5, C (b): after a cancel nothing unpaid exists for a later month (a paid one would extend the end).
        if (sub.cancelAtPeriodEnd || (sub.status === 'ended' && before.status !== 'ended')) {
          const later = epochInvoices().filter((i) => i.period > currentPeriod && i.status !== 'void' && i.status !== 'paid');
          expect(later.map((i) => i.period), `${after} later month left after a cancel`).toEqual([]);
          counts.cancelChecks += 1;
        }

        // (d)
        if (sub.cancelAtPeriodEnd && coverageEnd !== null && today < coverageEnd && unpaid.length === 0) {
          expect(sub.status, `${after} cancel shortened the paid period`).not.toBe('ended');
          expect(active, `${after} cancel closed access early`).toBe(true);
          expect(assignment?.endsOn, `${after} cancel moved ends_on`).toBe(coverageEnd);
        }

        // (§4.1) paying every unpaid invoice restores `active`.
        if (paidToday && nothingUnpaidBefore && before.status !== 'ended' && !before.cancelAtPeriodEnd && !blockedBefore.has(currentPeriod)) {
          expect(sub.status, `${after} payment did not restore active`).toBe('active');
          if (before.status === 'suspended') counts.restoredFromSuspended += 1;
          if (paidEndBefore !== null && paidEndBefore < firstDayOfPeriod(currentPeriod)) counts.gapResumes += 1;
        }

        counts.days += 1;
      }
    }

    // Coverage of the scenarios above (fixed seeds, so these counts are deterministic).
    expect(counts.days).toBeGreaterThan(48 * 500);
    expect(counts.issuedChecked).toBeGreaterThan(400);
    expect(counts.restarts).toBeGreaterThan(5);
    expect(counts.adminVoids).toBeGreaterThan(30);
    expect(counts.waivedDays).toBeGreaterThan(20);
    expect(counts.reissues).toBeGreaterThan(3);
    expect(counts.cancels).toBeGreaterThan(20);
    expect(counts.restoredFromSuspended).toBeGreaterThan(10);
    expect(counts.gapResumes).toBeGreaterThan(3);
    expect(counts.expired).toBeGreaterThan(3);
    expect(counts.needsReissueDays).toBeGreaterThan(20);
    expect(counts.memoEdits).toBeGreaterThan(10);
    expect(counts.refusedAttempts).toBeGreaterThan(100);
    expect(counts.cancelChecks).toBeGreaterThan(100);
    expect(counts.nullEpochVoids).toBeGreaterThan(5);
    expect(counts.expiryChecks).toBeGreaterThan(3);
    expect(counts.lateFirstPaid).toBeGreaterThan(3);
    expect(counts.downgradesApplied).toBeGreaterThan(10);
    expect(counts.uncoveredChecks).toBeGreaterThan(1000);
    expect(counts.d7Drafts).toBeGreaterThan(100);
  });

  it('table: billing decisions at the edges the reviews named (B4.1–B4.4, B2, rounds 2–4)', () => {
    const sub = (over: Partial<EngineSubscription> = {}): EngineSubscription => ({
      status: 'active',
      planId: 'b2b_69',
      pendingPlanId: null,
      pendingPlanEffectivePeriod: null,
      collectionMethod: 'transfer',
      startedOn: '2026-10-01',
      cancelAtPeriodEnd: false,
      activatedBeforePayment: false,
      epoch: 1,
      ...over,
    });
    const inv = (period: string, status: EngineInvoice['status'], over: Partial<EngineInvoice> = {}): EngineInvoice => ({
      id: `inv-${period}-${status}`,
      period,
      kind: 'subscription',
      coversMonths: 1,
      status,
      planId: 'b2b_69',
      dueOn: status === 'draft' ? null : `${period}-15`,
      issuedAt: status === 'draft' ? null : `${period}-01T09:00:00+09:00`,
      paidAt: status === 'paid' ? `${period}-05T09:00:00+09:00` : null,
      createdAt: `${period}-01T08:00:00+09:00`,
      createdVia: 'system',
      subscriptionEpoch: 1,
      ...over,
    });
    const paidOct = inv('2026-10', 'paid');
    const paidNov = inv('2026-11', 'paid');
    const anchor = { planId: 'b2b_69' as const, billingMode: 'invoice' as const, startedOn: '2026-10-01', endsOn: '2026-12-01' };
    const decDraft = inv('2026-12', 'draft', { createdAt: '2026-11-24T08:00:00+09:00' });

    // Grace 0 on the 1st: the only gap is the month being issued -> issue a full month and stay active.
    const g0 = evaluateSubscription({ todayKst: '2026-12-01', graceDays: 0, subscription: sub(), invoices: [paidOct, paidNov, decDraft], assignment: anchor });
    expect(g0.actions).toEqual([
      { type: 'issue', period: '2026-12', prorateFromDay: null, dueOn: '2026-12-15' },
      { type: 'syncAssignment', planId: 'b2b_69', billingMode: 'invoice', startedOn: '2026-10-01', endsOn: '2026-12-15' },
    ]);
    expect(g0.status).toBe('active');

    // Round 4, A (replaces the round 2/3 held drafts): every subscription draft of the epoch is the job's — a
    // draft created via an admin path or with manual amounts (only possible from before round 4 or a flag-off
    // edit) is issued on the 1st like the job's own (the service refreshes it to the rule's amounts).
    for (const draft of [inv('2026-12', 'draft', { createdVia: 'admin' }), inv('2026-12', 'draft', { manualAmounts: true })]) {
      const res = evaluateSubscription({ todayKst: '2026-12-01', graceDays: 0, subscription: sub(), invoices: [paidOct, paidNov, draft], assignment: anchor });
      expect(res.actions.filter((a) => a.type === 'issue')).toEqual([{ type: 'issue', period: '2026-12', prorateFromDay: null, dueOn: '2026-12-15' }]);
      expect(res.status).toBe('active');
      expect(res.accessEnd).toBe('2026-12-15');
    }

    // Round 3, item 4: an admin voiding a DRAFT waives nothing — the job drafts the month again (D-7 window and on
    // the 1st), and December is billed normally.
    const decDraftVoided = inv('2026-12', 'void', { voidedBy: 'admin', voidedAt: '2026-11-26T09:00:00+09:00', issuedAt: null, dueOn: null, createdAt: '2026-11-24T08:00:00+09:00' });
    const redraft = evaluateSubscription({ todayKst: '2026-11-26', graceDays: 14, subscription: sub(), invoices: [paidOct, paidNov, decDraftVoided], assignment: anchor });
    expect(redraft.actions.filter((a) => a.type === 'draft')).toEqual([{ type: 'draft', period: '2026-12', planId: 'b2b_69', prorateFromDay: null }]);
    expect(redraft.waivedPeriods).toEqual([]);
    const redraftDec1 = evaluateSubscription({ todayKst: '2026-12-01', graceDays: 14, subscription: sub(), invoices: [paidOct, paidNov, decDraftVoided], assignment: anchor });
    expect(redraftDec1.actions.filter((a) => a.type === 'draft' || a.type === 'issue')).toEqual([
      { type: 'draft', period: '2026-12', planId: 'b2b_69', prorateFromDay: null },
      { type: 'issue', period: '2026-12', prorateFromDay: null, dueOn: '2026-12-15' },
    ]);
    expect(redraftDec1.waivedPeriods).toEqual([]);

    // Round 4, B1: a downgrade follows the invoice that carries it, whoever issued it — applied once its month
    // has started (Jan 5 after a hand-issue), not before (Dec 28), and kept by the plan assignment.
    const downSub = sub({ pendingPlanId: 'b2b_29', pendingPlanEffectivePeriod: '2027-01' });
    const paidDec = inv('2026-12', 'paid');
    const janIssued = inv('2027-01', 'issued', { planId: 'b2b_29', dueOn: '2027-01-15', issuedAt: '2026-12-28T09:00:00+09:00', createdAt: '2026-12-25T08:00:00+09:00' });
    const dec28 = evaluateSubscription({ todayKst: '2026-12-28', graceDays: 14, subscription: downSub, invoices: [paidOct, paidNov, paidDec, janIssued], assignment: { ...anchor, endsOn: '2027-01-01' } });
    expect(dec28.actions.some((a) => a.type === 'applyPendingPlan')).toBe(false);
    const jan5 = evaluateSubscription({ todayKst: '2027-01-05', graceDays: 14, subscription: downSub, invoices: [paidOct, paidNov, paidDec, janIssued], assignment: { ...anchor, endsOn: '2027-01-01' } });
    expect(jan5.actions[0]).toEqual({ type: 'applyPendingPlan', fromPlanId: 'b2b_69', toPlanId: 'b2b_29' });
    expect(jan5.actions).toContainEqual({ type: 'syncAssignment', planId: 'b2b_29', billingMode: 'invoice', startedOn: '2026-10-01', endsOn: '2027-01-15' });

    // Round 3, item 2: a month an OLDER epoch's non-void invoice occupies is never drafted, is reported as
    // blocked, and counts as unpaid like a held draft once it starts (no free month).
    for (const [day, status, accessEnd, drafts] of [
      ['2026-11-25', 'active', '2026-12-01', []],
      ['2026-12-01', 'active', '2026-12-15', []],
      ['2026-12-16', 'past_due', '2026-12-15', []],
    ] as const) {
      const res = evaluateSubscription({
        todayKst: day,
        graceDays: 14,
        subscription: sub(),
        invoices: [paidOct, paidNov, inv('2026-12', 'issued', { id: 'older-dec', subscriptionEpoch: 0 })],
        assignment: anchor,
        olderEpochPeriods: ['2026-12'],
      });
      expect(res.status, day).toBe(status);
      expect(res.accessEnd, day).toBe(accessEnd);
      expect(res.blockedByOlderEpoch, day).toEqual(['2026-12']);
      expect(res.actions.filter((a) => a.type === 'draft' || a.type === 'issue'), day).toEqual(drafts);
    }

    // Round 3, item 1 + round 4, B3: a first invoice without early access is due inside its month and expires only
    // after a 7-day recording margin (Dec 8); an on-time payment recorded late counts from its paid date.
    expect(dueOnForInvoice({ issueDay: '2026-11-25', period: '2026-11', method: 'transfer', firstInvoiceWithoutEarlyAccess: { startedOn: '2026-11-25' } })).toBe('2026-11-30');
    expect(dueOnForInvoice({ issueDay: '2026-11-03', period: '2026-11', method: 'transfer', firstInvoiceWithoutEarlyAccess: { startedOn: '2026-11-03' } })).toBe('2026-11-17');
    expect(dueOnForInvoice({ issueDay: '2026-11-25', period: '2026-11', method: 'transfer' })).toBe('2026-12-09');
    const firstNov = inv('2026-11', 'issued', { dueOn: '2026-11-30', issuedAt: '2026-11-25T09:00:00+09:00' });
    const pendingSub = sub({ status: 'pending', startedOn: '2026-11-25' });
    for (const day of ['2026-11-30', '2026-12-01', '2026-12-07']) {
      const res = evaluateSubscription({ todayKst: day, graceDays: 14, subscription: pendingSub, invoices: [firstNov], assignment: null });
      expect(res.actions.some((a) => a.type === 'void'), day).toBe(false);
    }
    const dec8 = evaluateSubscription({ todayKst: '2026-12-08', graceDays: 14, subscription: pendingSub, invoices: [firstNov], assignment: null });
    expect(dec8.actions).toEqual([{ type: 'void', invoiceId: firstNov.id, period: '2026-11', reason: 'first_invoice_expired' }]);
    // Paid Nov 30, recorded Dec 1: billable on Dec 1 from the facts -> a full December due Dec 15, access open.
    const paidOnTime = { ...firstNov, status: 'paid' as const, paidAt: '2026-11-30T00:00:00+09:00' };
    const recordedDec1 = evaluateSubscription({ todayKst: '2026-12-01', graceDays: 14, subscription: pendingSub, invoices: [paidOnTime], assignment: null });
    expect(recordedDec1.actions.filter((a) => a.type === 'draft' || a.type === 'issue')).toEqual([
      { type: 'draft', period: '2026-12', planId: 'b2b_69', prorateFromDay: null },
      { type: 'issue', period: '2026-12', prorateFromDay: null, dueOn: '2026-12-15' },
    ]);
    expect(recordedDec1.status).toBe('active');
    // Paid Dec 3, recorded Dec 5: December starts on the paid day.
    const paidLate = { ...firstNov, status: 'paid' as const, paidAt: '2026-12-03T00:00:00+09:00' };
    const recordedDec5 = evaluateSubscription({ todayKst: '2026-12-05', graceDays: 14, subscription: pendingSub, invoices: [paidLate], assignment: null });
    expect(recordedDec5.actions.filter((a) => a.type === 'draft' || a.type === 'issue')).toEqual([
      { type: 'draft', period: '2026-12', planId: 'b2b_69', prorateFromDay: '2026-12-03' },
      { type: 'issue', period: '2026-12', prorateFromDay: '2026-12-03', dueOn: '2026-12-19' },
    ]);

    // Round 4, B2: the facts as of a day come from each row's own timestamps — an invoice issued on Jan 5 was a
    // draft on Jan 1, a payment recorded with paid date Dec 3 counts from Dec 3, a void from its void day.
    const janLate = inv('2027-01', 'issued', { issuedAt: '2027-01-05T09:00:00+09:00', dueOn: '2027-01-19', createdAt: '2026-12-25T08:00:00+09:00' });
    expect(invoicesAsOfDay([janLate], '2027-01-01')[0]).toMatchObject({ status: 'draft', dueOn: null, issuedAt: null });
    expect(invoicesAsOfDay([janLate], '2027-01-05')[0]).toMatchObject({ status: 'issued', dueOn: '2027-01-19' });
    const decPaidLate = inv('2026-12', 'paid', { issuedAt: '2026-12-01T09:00:00+09:00', paidAt: '2026-12-03T00:00:00+09:00' });
    expect(invoicesAsOfDay([decPaidLate], '2026-12-02')[0]).toMatchObject({ status: 'issued', paidAt: null });
    expect(invoicesAsOfDay([decPaidLate], '2026-12-03')[0]).toMatchObject({ status: 'paid' });

    // Round 3, item 3: hand- and job-issued invoices are due max(issue day, 1st of their month) + 14.
    expect(dueOnForInvoice({ issueDay: '2026-11-03', period: '2026-12', method: 'transfer' })).toBe('2026-12-15');
    expect(dueOnForInvoice({ issueDay: '2026-12-04', period: '2026-12', method: 'transfer' })).toBe('2026-12-18');
    expect(dueOnForInvoice({ issueDay: '2026-12-04', period: '2026-11', method: 'transfer' })).toBe('2026-12-18');

    // The job missed the 1st and runs on the 3rd: still a full month (billable on the 1st, from the facts).
    const late = evaluateSubscription({ todayKst: '2026-12-03', graceDays: 0, subscription: sub(), invoices: [paidOct, paidNov], assignment: anchor });
    expect(late.actions.filter((a) => a.type === 'draft' || a.type === 'issue')).toEqual([
      { type: 'draft', period: '2026-12', planId: 'b2b_69', prorateFromDay: null },
      { type: 'issue', period: '2026-12', prorateFromDay: null, dueOn: '2026-12-17' },
    ]);

    // D-7 exactly: nothing on D-8, a draft at the plan in force on D-7.
    const d8 = evaluateSubscription({ todayKst: '2026-11-23', graceDays: 14, subscription: sub({ pendingPlanId: 'b2b_29', pendingPlanEffectivePeriod: '2026-12' }), invoices: [paidOct, paidNov], assignment: anchor });
    expect(d8.actions.some((a) => a.type === 'draft')).toBe(false);
    const d7 = evaluateSubscription({ todayKst: '2026-11-24', graceDays: 14, subscription: sub({ pendingPlanId: 'b2b_29', pendingPlanEffectivePeriod: '2026-12' }), invoices: [paidOct, paidNov], assignment: anchor });
    expect(d7.actions.filter((a) => a.type === 'draft')).toEqual([{ type: 'draft', period: '2026-12', planId: 'b2b_29', prorateFromDay: null }]);

    // A due downgrade applies only with that full-month invoice, on the period's 1st (B4.3).
    const down = evaluateSubscription({
      todayKst: '2026-12-01',
      graceDays: 14,
      subscription: sub({ pendingPlanId: 'b2b_29', pendingPlanEffectivePeriod: '2026-12' }),
      invoices: [paidOct, paidNov, inv('2026-12', 'draft', { planId: 'b2b_29' })],
      assignment: anchor,
    });
    expect(down.actions.slice(0, 2)).toEqual([
      { type: 'applyPendingPlan', fromPlanId: 'b2b_69', toPlanId: 'b2b_29' },
      { type: 'issue', period: '2026-12', prorateFromDay: null, dueOn: '2026-12-15' },
    ]);

    // Suspended for an unpaid October, November never billed, October paid on Dec 5: active again, December
    // prorated from the 5th, the pending downgrade waits for January (B4.3, B4.4).
    const resumed = evaluateSubscription({
      todayKst: '2026-12-05',
      graceDays: 14,
      subscription: sub({ status: 'suspended', pendingPlanId: 'b2b_29', pendingPlanEffectivePeriod: '2026-11' }),
      invoices: [inv('2026-10', 'paid', { paidAt: '2026-12-05T09:00:00+09:00' })],
      assignment: { ...anchor, endsOn: '2026-10-15' },
    });
    expect(resumed.status).toBe('active');
    expect(resumed.actions).toEqual([
      { type: 'draft', period: '2026-12', planId: 'b2b_69', prorateFromDay: '2026-12-05' },
      { type: 'issue', period: '2026-12', prorateFromDay: '2026-12-05', dueOn: '2026-12-19' },
      { type: 'syncAssignment', planId: 'b2b_69', billingMode: 'invoice', startedOn: '2026-10-01', endsOn: '2026-12-19' },
      { type: 'setStatus', from: 'suspended', to: 'active' },
    ]);

    // Still unpaid past grace -> suspended, nothing billed even on the 1st.
    const stillSuspended = evaluateSubscription({
      todayKst: '2026-12-01',
      graceDays: 14,
      subscription: sub({ status: 'suspended' }),
      invoices: [paidOct, inv('2026-11', 'issued')],
      assignment: { ...anchor, endsOn: '2026-11-15' },
    });
    expect(stillSuspended.actions).toEqual([]);

    // Item 3: December voided by an admin on Dec 5 after a paid November is waived: covered through Jan 1,
    // active all month (never suspended with nothing owed), January billed normally on Jan 1.
    const decVoided = inv('2026-12', 'void', { voidedBy: 'admin', voidedAt: '2026-12-05T09:00:00+09:00', dueOn: '2026-12-15' });
    for (const day of ['2026-12-05', '2026-12-16', '2026-12-31']) {
      const res = evaluateSubscription({ todayKst: day, graceDays: 0, subscription: sub(), invoices: [paidOct, paidNov, decVoided], assignment: { ...anchor, endsOn: '2027-01-01' } });
      expect(res.status, day).toBe('active');
      expect(res.accessEnd, day).toBe('2027-01-01');
      expect(res.waivedPeriods, day).toEqual(['2026-12']);
      expect(res.actions.filter((a) => a.type === 'issue' && a.period === '2026-12'), day).toEqual([]);
    }
    const jan1 = evaluateSubscription({ todayKst: '2027-01-01', graceDays: 0, subscription: sub(), invoices: [paidOct, paidNov, decVoided, inv('2027-01', 'draft', { createdAt: '2026-12-25T08:00:00+09:00' })], assignment: { ...anchor, endsOn: '2027-01-01' } });
    expect(jan1.actions[0]).toEqual({ type: 'issue', period: '2027-01', prorateFromDay: null, dueOn: '2027-01-15' });

    // Item 3: a voided first invoice (nothing paid), with or without early access -> pending, no access,
    // never billed, needs a reissue.
    for (const activatedBeforePayment of [false, true]) {
      const res = evaluateSubscription({
        todayKst: '2026-11-03',
        graceDays: 14,
        subscription: sub({ status: 'pending', activatedBeforePayment, startedOn: '2026-10-02' }),
        invoices: [inv('2026-10', 'void', { voidedBy: 'admin', voidedAt: '2026-10-04T09:00:00+09:00' })],
        assignment: activatedBeforePayment ? { ...anchor, startedOn: '2026-10-02', endsOn: '2026-10-16' } : null,
      });
      expect(res.status).toBe('pending');
      expect(res.needsReissue).toBe(true);
      expect(res.accessEnd).toBeNull();
      expect(res.actions).toEqual(activatedBeforePayment ? [{ type: 'clearAssignment' }] : []);
    }

    // Item 3 (+ round 4, B3): an unpaid first invoice without early access expires 7 days after its period.
    const expired = evaluateSubscription({
      todayKst: '2026-11-08',
      graceDays: 14,
      subscription: sub({ status: 'pending', startedOn: '2026-10-20' }),
      invoices: [inv('2026-10', 'issued', { dueOn: '2026-11-03', issuedAt: '2026-10-20T09:00:00+09:00' })],
      assignment: null,
    });
    expect(expired.actions).toEqual([{ type: 'void', invoiceId: 'inv-2026-10-issued', period: '2026-10', reason: 'first_invoice_expired' }]);
    expect(expired.needsReissue).toBe(true);
    // ... but not with early access: the normal unpaid flow applies.
    const earlyNotExpired = evaluateSubscription({
      todayKst: '2026-11-01',
      graceDays: 14,
      subscription: sub({ status: 'pending', startedOn: '2026-10-20', activatedBeforePayment: true }),
      invoices: [inv('2026-10', 'issued', { dueOn: '2026-11-03', issuedAt: '2026-10-20T09:00:00+09:00' })],
      assignment: { ...anchor, startedOn: '2026-10-20', endsOn: '2026-11-03' },
    });
    expect(earlyNotExpired.actions.some((a) => a.type === 'void')).toBe(false);

    // Item 8 (+ round 4, A): every unissued draft of the epoch from a past month is voided by the system — the job
    // owns them all (the round-2 "admin draft left alone" exception is gone with held drafts).
    const stale = evaluateSubscription({
      todayKst: '2026-12-10',
      graceDays: 14,
      subscription: sub({ status: 'suspended' }),
      invoices: [paidOct, inv('2026-11', 'issued'), inv('2026-12', 'draft', { createdAt: '2026-11-24T08:00:00+09:00' })],
      assignment: { ...anchor, endsOn: '2026-11-15' },
    });
    expect(stale.actions.some((a) => a.type === 'void')).toBe(false); // December is the current month
    const staleNext = evaluateSubscription({
      todayKst: '2027-01-02',
      graceDays: 14,
      subscription: sub({ status: 'suspended' }),
      invoices: [paidOct, inv('2026-11', 'issued'), inv('2026-12', 'draft', { createdAt: '2026-11-24T08:00:00+09:00' }), inv('2026-09', 'draft', { createdVia: 'admin', id: 'admin-sep' })],
      assignment: { ...anchor, endsOn: '2026-11-15' },
    });
    expect(staleNext.actions.filter((a) => a.type === 'void')).toEqual([
      { type: 'void', invoiceId: 'inv-2026-12-draft', period: '2026-12', reason: 'stale_system_draft' },
      { type: 'void', invoiceId: 'admin-sep', period: '2026-09', reason: 'stale_system_draft' },
    ]);

    // Item 10 (b): oldest unpaid by due_on — issued out of period order, and a legacy row without due_on.
    const outOfOrder = evaluateSubscription({
      todayKst: '2026-12-20',
      graceDays: 30,
      subscription: sub(),
      invoices: [
        paidOct,
        inv('2026-12', 'issued', { dueOn: '2026-12-15', issuedAt: '2026-12-01T09:00:00+09:00' }),
        inv('2026-11', 'issued', { dueOn: '2026-12-18', issuedAt: '2026-12-04T09:00:00+09:00' }),
      ],
      assignment: anchor,
    });
    expect(outOfOrder.oldestUnpaid?.period).toBe('2026-12');
    expect(outOfOrder.accessEnd).toBe('2026-12-15');
    const legacy = evaluateSubscription({
      todayKst: '2026-12-20',
      graceDays: 30,
      subscription: sub(),
      invoices: [
        paidOct,
        inv('2026-12', 'issued', { dueOn: '2026-12-15', issuedAt: '2026-12-01T09:00:00+09:00' }),
        inv('2026-11', 'issued', { dueOn: null, issuedAt: '2026-11-25T09:00:00+09:00' }),
      ],
      assignment: anchor,
    });
    // Legacy fallback: issued Nov 25 (KST) + 14 = Dec 9, earlier than Dec 15.
    expect(legacy.oldestUnpaid?.period).toBe('2026-11');
    expect(legacy.accessEnd).toBe('2026-12-09');
  });
});
