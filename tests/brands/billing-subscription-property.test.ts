import { describe, expect, it } from 'vitest';
import { cycleStartAt } from '@/lib/brands/billing/cycle';
import { addCalendarDays, invoiceAmounts, planActiveWithGrace, type PaidBrandPlanId } from '@/lib/brands/billing/math';
import { BRAND_PLANS, type BrandBillingMode } from '@/lib/brands/plans';
import {
  currentRun,
  dueOnForInvoice,
  evaluateSubscription,
  findAdminVoidedCycles,
  firstInvoiceRuleApplies,
  pendingPlanCarriedByInvoice,
  periodOfDay,
  subscriptionNeedsReissue,
  type EngineInvoice,
  type EngineSubscription,
} from '@/lib/brands/subscriptions/engine';

/**
 * B1c-2: a day-by-day simulation of one organization's subscription on PLAN-START-DAY CYCLES that drives the pure
 * engine like the service does (apply every returned action) and mixes in what customers and admins can do: pay a
 * random unpaid invoice with a paid date on or before today (late recording included), void a draft or an issued
 * invoice, cancel / undo, downgrade / clear, reissue the current cycle (or a new first invoice), memo edits (no-op),
 * restart after the end, flag-off null-epoch drafts. Grace 0/1/7/14; start days on the 1st, 15th and 28th–31st.
 * On EVERY day it checks the invariants listed in the brief (see the `expect` messages).
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
  proratedDays: number | null;
}

const PLANS: readonly PaidBrandPlanId[] = ['b2b_29', 'b2b_49', 'b2b_69'];
const GRACES = [0, 1, 7, 14] as const;
const START_DAYS = ['2026-11-01', '2026-11-15', '2027-01-28', '2027-01-29', '2027-01-30', '2027-01-31', '2026-12-31', '2027-03-31'] as const;
const stampAt = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00+09:00`;
const fullPrice = (planId: PaidBrandPlanId, discountPct: number) =>
  invoiceAmounts({ listKrw: BRAND_PLANS[planId].monthlyKrw, discountPct, prorate: null }).totalKrw;

describe('brand subscription engine — property simulation on billing cycles (B1c-2)', () => {
  it('holds every invariant on every day for 620+ days, grace 0/1/7/14, anchors on 1/15/28–31', () => {
    const counts = { days: 0, issued: 0, restarts: 0, resumes: 0, waived: 0, reissues: 0, cancels: 0, expired: 0, firstPayments: 0, latePaid: 0, downgrades: 0, gapDays: 0, nullEpochVoids: 0, outages: 0, outageRestarts: 0 };

    for (let seed = 1; seed <= 32; seed++) {
      const rand = mulberry32(seed * 7919);
      const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
      const graceDays = GRACES[seed % GRACES.length]!;
      const discountPct = seed % 3 === 0 ? 20 : 0;
      const firstStart = START_DAYS[seed % START_DAYS.length]!;
      const payChance = [0.12, 0.05, 0.02][Math.floor(seed / 4) % 3]!;
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
      const gapDays = new Set<string>();
      const epochInvoices = () => invoices.filter((i) => i.subscriptionEpoch === sub.epoch);

      // A1 noise: other epochs and null-epoch invoices before the start never change the engine's output.
      const noise: EngineInvoice[] = [];
      for (let k = 0; k < 5; k++) {
        const start = addCalendarDays(firstStart, -40 - Math.floor(rand() * 200));
        const status = pick(['paid', 'void', 'issued'] as const);
        noise.push({
          id: `noise-${seed}-${k}`,
          period: periodOfDay(start),
          kind: 'subscription',
          coversMonths: 1,
          status,
          planId: pick(PLANS),
          dueOn: addCalendarDays(start, 14),
          issuedAt: stampAt(start, 9),
          paidAt: status === 'paid' ? stampAt(start, 12) : null,
          voidedAt: status === 'void' ? stampAt(start, 12) : null,
          voidedBy: status === 'void' ? pick(['admin', 'system'] as const) : null,
          createdAt: stampAt(start, 8),
          subscriptionEpoch: pick([null, 1, 2] as const),
          cycleStart: start,
          cycleEnd: cycleStartAt(start, 1),
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
          cycleStart: null,
          cycleEnd: null,
          totalKrw: 0,
          proratedDays: null,
          ...over,
        };
        invoices.push(inv);
        return inv;
      };
      const voidAs = (inv: SimInvoice, today: string, by: 'admin' | 'system') => {
        inv.status = 'void';
        inv.voidedAt = stampAt(today, 9);
        inv.voidedBy = by;
      };
      // Mirrors `startSubscription` (rules 4–5): full price, due = start + 14; a cycle only with early access.
      const startEpoch = (day: string) => {
        const early = sub.activatedBeforePayment;
        newInvoice({
          period: periodOfDay(day),
          status: 'issued',
          planId: sub.planId,
          dueOn: addCalendarDays(day, 14),
          issuedAt: stampAt(day, 10),
          createdAt: stampAt(day, 10),
          createdVia: 'admin',
          totalKrw: fullPrice(sub.planId as PaidBrandPlanId, discountPct),
          ...(early ? { cycleStart: day, cycleEnd: cycleStartAt(day, 1) } : {}),
        });
        assignment = early ? { planId: sub.planId as PaidBrandPlanId, billingMode: 'invoice', startedOn: day, endsOn: addCalendarDays(day, 14) } : null;
      };
      startEpoch(firstStart);

      const evaluate = (today: string, withNoise: boolean) =>
        evaluateSubscription({ todayKst: today, graceDays, subscription: sub, invoices: withNoise ? [...invoices, ...noise] : invoices, assignment });

      const lastDay = addCalendarDays(firstStart, 640);
      let prevActive = false;
      // Fix round 1, B3: job outages (the flag off) longer than a cycle. The job does not run; payments are still recorded.
      let outageUntil: string | null = null;
      for (let today: string = firstStart; today <= lastDay; today = addCalendarDays(today, 1)) {
        let eventToday = today === sub.startedOn;
        let paidToday: SimInvoice | null = null;
        if (outageUntil === null && sub.status !== 'ended' && rand() < 0.002) {
          outageUntil = addCalendarDays(today, 35 + Math.floor(rand() * 60));
          counts.outages += 1;
        }
        if (outageUntil !== null && today < outageUntil) {
          const open = epochInvoices().filter((i) => i.status === 'issued');
          if (open.length > 0 && rand() < payChance) {
            const inv = pick(open);
            const issueDay = inv.issuedAt!.slice(0, 10);
            let paidDay = addCalendarDays(today, -Math.floor(rand() * 7));
            if (paidDay < issueDay) paidDay = issueDay;
            for (const key of [...gapDays]) if (key.startsWith(`${sub.epoch}:`) && key.slice(key.indexOf(':') + 1) >= paidDay) gapDays.delete(key);
            inv.status = 'paid';
            inv.paidAt = stampAt(paidDay, 9);
          }
          counts.days += 1;
          continue;
        }
        const returning = outageUntil !== null;
        if (returning) {
          outageUntil = null;
          eventToday = true; // the job's first run after the outage is the event that restores access
        }
        const epochAtStart = epochInvoices();
        const paidEndAtStart = epochAtStart.filter((i) => i.status === 'paid' && i.cycleEnd).map((i) => i.cycleEnd!).sort().at(-1) ?? null;

        if (sub.status === 'ended') {
          const anyLive = invoices.some((i) => i.status !== 'void' && i.status !== 'paid' && i.subscriptionEpoch === sub.epoch);
          if (!anyLive && rand() < 0.03) {
            counts.restarts += 1;
            eventToday = true;
            sub = { ...sub, status: 'pending', planId: pick(PLANS), pendingPlanId: null, pendingPlanEffectivePeriod: null, startedOn: today, cancelAtPeriodEnd: false, activatedBeforePayment: rand() < 0.3, epoch: sub.epoch + 1 };
            startEpoch(today);
          }
        } else {
          const r = rand();
          const epoch = epochInvoices();
          const open = epoch.filter((i) => i.status === 'issued');
          const voidable = epoch.filter((i) => i.status === 'issued' || i.status === 'draft');
          if (r < payChance && open.length > 0) {
            // A payment with a paid date on or before today (late recording up to 6 days, never before the issue day).
            const inv = pick(open);
            const issueDay = inv.issuedAt!.slice(0, 10);
            let paidDay = addCalendarDays(today, -Math.floor(rand() * 7));
            if (paidDay < issueDay) paidDay = issueDay;
            if (paidDay < today) {
              counts.latePaid += 1;
              // Days that looked suspended only because this payment was recorded late are not a gap.
              for (const key of [...gapDays]) if (key.startsWith(`${sub.epoch}:`) && key.slice(key.indexOf(':') + 1) >= paidDay) gapDays.delete(key);
            }
            inv.status = 'paid';
            inv.paidAt = stampAt(paidDay, 9);
            paidToday = inv;
            eventToday = true;
          } else if (r >= 0.2 && r < 0.212 && voidable.length > 0) {
            voidAs(pick(voidable), today, 'admin');
            eventToday = true;
          } else if (r >= 0.212 && r < 0.216 && !sub.cancelAtPeriodEnd) {
            // Mirrors `cancelSubscription`: nothing paid → every unpaid invoice voided; something paid → drafts and
            // issued invoices of later cycles voided (and the current cycle's draft). A carried downgrade is kept.
            counts.cancels += 1;
            eventToday = true;
            const hasPaid = epoch.some((i) => i.status === 'paid');
            for (const inv of epoch) {
              if (!hasPaid) {
                if (inv.status === 'draft' || inv.status === 'issued') voidAs(inv, today, 'system');
              } else if (inv.status === 'draft' || (inv.status === 'issued' && (inv.cycleStart ?? '') > today)) {
                voidAs(inv, today, 'system');
              }
            }
            // Fix round 1, B5: a scheduled downgrade survives the cancel; one an issued/paid invoice carries is applied.
            const carried = pendingPlanCarriedByInvoice(sub, epoch, today);
            sub = carried
              ? { ...sub, cancelAtPeriodEnd: true, planId: carried, pendingPlanId: null, pendingPlanEffectivePeriod: null }
              : { ...sub, cancelAtPeriodEnd: true };
          } else if (r >= 0.216 && r < 0.236 && sub.cancelAtPeriodEnd) {
            sub = { ...sub, cancelAtPeriodEnd: false };
            eventToday = true;
          } else if (r >= 0.236 && r < 0.256 && !sub.cancelAtPeriodEnd && sub.pendingPlanId === null) {
            const rank = PLANS.indexOf(sub.planId as PaidBrandPlanId);
            const run = currentRun(epoch);
            if (rank > 0 && run) {
              const next = cycleStartAt(run.anchor, 0) <= today ? (epoch.length ? nextStartAfter(run.anchor, today) : today) : run.anchor;
              sub = { ...sub, pendingPlanId: PLANS[Math.floor(rand() * rank)]!, pendingPlanEffectivePeriod: periodOfDay(next) };
              for (const inv of epoch) {
                if (inv.status === 'draft' && (inv.cycleStart ?? '') > today && periodOfDay(inv.cycleStart!) >= sub.pendingPlanEffectivePeriod!) {
                  inv.planId = sub.pendingPlanId!;
                  inv.totalKrw = fullPrice(sub.pendingPlanId as PaidBrandPlanId, discountPct);
                }
              }
            }
          } else if (r >= 0.256 && r < 0.262 && sub.pendingPlanId !== null) {
            sub = { ...sub, pendingPlanId: null, pendingPlanEffectivePeriod: null };
            for (const inv of epoch) {
              if (inv.status === 'draft' && (inv.cycleStart ?? '') > today) {
                inv.planId = sub.planId;
                inv.totalKrw = fullPrice(sub.planId as PaidBrandPlanId, discountPct);
              }
            }
          } else if (r >= 0.262 && r < 0.32 && !sub.cancelAtPeriodEnd) {
            // Mirrors `reissueSubscriptionPeriod` (rule 9).
            const needs = subscriptionNeedsReissue(sub, invoices);
            const fresh = needs && firstInvoiceRuleApplies(sub, invoices);
            const run = currentRun(epoch);
            const current = run ? containing(run.anchor, today) : null;
            if (fresh) {
              if (!epoch.some((i) => i.status !== 'void' && !i.cycleStart)) {
                const due = dueOnForInvoice({ issueDay: today, method: 'transfer' });
                const re = newInvoice({ period: periodOfDay(today), status: 'issued', planId: sub.planId, dueOn: due, issuedAt: stampAt(today, 9), createdAt: stampAt(today, 9), createdVia: 'admin', totalKrw: fullPrice(sub.planId as PaidBrandPlanId, discountPct) });
                expect(re.cycleStart, 'fresh first invoice has no cycle').toBeNull();
                counts.reissues += 1;
                eventToday = true;
              }
            } else if (current) {
              const live = epoch.some((i) => i.status !== 'void' && i.cycleStart === current.start);
              const voided = findAdminVoidedCycles(epoch).includes(current.start);
              if (!live && (voided || needs)) {
                // Fix round 1: waiting with early access and the current cycle never billed → a new cycle from today.
                const target = needs && !epoch.some((i) => i.cycleStart === current.start) ? { start: today, end: cycleStartAt(today, 1) } : current;
                const replaced = [...epoch.filter((i) => i.cycleStart === target.start)].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')).at(-1) ?? null;
                const due = replaced?.dueOn ?? dueOnForInvoice({ issueDay: today, cycleStart: target.start, method: 'transfer' });
                newInvoice({ period: periodOfDay(target.start), status: 'issued', planId: sub.planId, dueOn: due, issuedAt: stampAt(today, 9), createdAt: stampAt(today, 9), createdVia: 'admin', cycleStart: target.start, cycleEnd: target.end, totalKrw: fullPrice(sub.planId as PaidBrandPlanId, discountPct) });
                if (replaced) expect(due, 'reissue keeps the due date').toBe(replaced.dueOn);
                counts.reissues += 1;
                eventToday = true;
              }
            }
          } else if (r >= 0.32 && r < 0.33) {
            // A flag-off interlude leaves a null-epoch draft; the service voids it as the system before the engine.
            newInvoice({ period: periodOfDay(today), status: 'draft', planId: sub.planId, subscriptionEpoch: null, createdAt: stampAt(today, 9), createdVia: null, totalKrw: 1 });
          }
          // (memo edits and refused admin actions change nothing the engine reads)
        }

        // Mirrors `settleNullEpochInvoices`: null-epoch drafts of this epoch's time are voided by the system.
        if (sub.status !== 'ended') {
          for (const inv of invoices.filter((i) => i.subscriptionEpoch === null && i.status === 'draft' && i.period >= periodOfDay(sub.startedOn))) {
            voidAs(inv, today, 'system');
            counts.nullEpochVoids += 1;
          }
        }

        const before: EngineSubscription = { ...sub };
        const result = evaluate(today, false);
        const label = `seed=${seed} grace=${graceDays} day=${today} status=${sub.status}`;
        expect(evaluate(today, true), `${label} A1 noise changed the output`).toEqual(result);

        for (const action of result.actions) {
          if (action.type === 'setInvoiceCycle') {
            const inv = invoices.find((i) => i.id === action.invoiceId)!;
            expect(action.cycleStart, `${label} first cycle starts on the paid day`).toBe(inv.paidAt!.slice(0, 10));
            inv.cycleStart = action.cycleStart;
            inv.cycleEnd = action.cycleEnd; // fix round 1, B7: `period` stays the month it was issued for
            counts.firstPayments += 1;
          } else if (action.type === 'void') {
            const inv = invoices.find((i) => i.id === action.invoiceId)!;
            if (action.reason === 'first_invoice_expired') {
              expect(today > addCalendarDays(inv.dueOn!, 14), `${label} expired before due + 14`).toBe(true);
              expect(inv.cycleStart, `${label} expired a cycle invoice`).toBeNull();
              counts.expired += 1;
            } else {
              expect(inv.status, `${label} voided a non-draft as stale`).toBe('draft');
            }
            voidAs(inv, today, 'system');
          } else if (action.type === 'applyPendingPlan') {
            sub = { ...sub, planId: action.toPlanId, pendingPlanId: null, pendingPlanEffectivePeriod: null };
            counts.downgrades += 1;
          } else if (action.type === 'draft') {
            expect(action.cycleEnd > today, `${label} drafted a cycle that already ended`).toBe(true);
            newInvoice({ period: action.period, status: 'draft', planId: action.planId, createdAt: stampAt(today, 10), cycleStart: action.cycleStart, cycleEnd: action.cycleEnd, totalKrw: fullPrice(action.planId, discountPct) });
          } else if (action.type === 'issue') {
            const draft = epochInvoices().find((i) => i.status === 'draft' && i.cycleStart === action.cycleStart)!;
            expect(draft, `${label} issue without a draft`).toBeDefined();
            expect(draft.cycleEnd! > today, `${label} issued a cycle that already ended`).toBe(true);
            draft.planId = sub.planId;
            draft.totalKrw = fullPrice(sub.planId as PaidBrandPlanId, discountPct);
            draft.status = 'issued';
            draft.dueOn = action.dueOn;
            draft.issuedAt = stampAt(today, 10);
            expect(action.dueOn, `${label} due date`).toBe(addCalendarDays(action.cycleStart > today ? action.cycleStart : today, 14));
            const blockedAtStart = new Set(findAdminVoidedCycles(epochAtStart));
            const restart = !epochAtStart.some((i) => (i.status !== 'void' || blockedAtStart.has(i.cycleStart ?? '')) && i.status !== 'draft' && i.cycleEnd === action.cycleStart);
            if (restart && epochAtStart.some((i) => i.status === 'paid' && i.cycleStart)) {
              // A resume always starts its new cycle on the day the suspension was lifted: a paid date, or the day an
              // admin waived the overdue cycle.
              const liftDays = new Set([
                ...epochInvoices().filter((i) => i.status === 'paid').map((i) => i.paidAt!.slice(0, 10)),
                ...epochInvoices().filter((i) => i.status === 'void' && i.voidedBy === 'admin').map((i) => i.voidedAt!.slice(0, 10)),
              ]);
              // ... or, the first run after an outage longer than a cycle, today (fix round 1, B3).
              const outageRestart = returning && action.cycleStart === today;
              expect(liftDays.has(action.cycleStart) || outageRestart, `${label} restart on ${action.cycleStart}, not on a paid or waiver day or today after an outage`).toBe(true);
              if (outageRestart) counts.outageRestarts += 1;
              counts.resumes += 1;
            }
            counts.issued += 1;
          } else if (action.type === 'syncAssignment') {
            assignment = { planId: action.planId, billingMode: action.billingMode, startedOn: action.startedOn, endsOn: action.endsOn };
          } else if (action.type === 'clearAssignment') {
            assignment = null;
          } else if (action.type === 'setStatus') {
            sub = { ...sub, status: action.to };
          } else if (action.type === 'end') {
            sub = { ...sub, status: 'ended', pendingPlanId: null, pendingPlanEffectivePeriod: null };
          }
        }
        const after = `${label}->${sub.status} assignment=${JSON.stringify(assignment)}`;
        const epoch = epochInvoices();

        // One non-void subscription invoice per cycle; at most one waiting first invoice; cycles never overlap.
        const live = epoch.filter((i) => i.status !== 'void');
        const starts = live.filter((i) => i.cycleStart).map((i) => i.cycleStart!);
        expect(new Set(starts).size, `${after} two invoices for one cycle`).toBe(starts.length);
        expect(live.filter((i) => !i.cycleStart).length <= 1, `${after} two first invoices`).toBe(true);
        const occupied = [...live.filter((i) => i.cycleStart && i.status !== 'draft')].sort((a, b) => a.cycleStart!.localeCompare(b.cycleStart!));
        for (let k = 1; k < occupied.length; k++) {
          expect(occupied[k]!.cycleStart! >= occupied[k - 1]!.cycleEnd!, `${after} cycles overlap`).toBe(true);
        }
        // No proration anywhere: every issued invoice is the full price of its plan with the discount.
        for (const inv of epoch.filter((i) => i.status === 'issued' || i.status === 'paid')) {
          expect(inv.proratedDays, `${after} prorated`).toBeNull();
          expect(inv.totalKrw, `${after} amount`).toBe(fullPrice(inv.planId as PaidBrandPlanId, discountPct));
        }

        // Idempotence.
        expect(evaluate(today, false).actions, `${after} not idempotent`).toEqual([]);

        // Independent rule-7 oracle.
        const paid = epoch.filter((i) => i.status === 'paid' && i.cycleEnd);
        const earliestPaid = paid.map((i) => i.cycleStart!).sort()[0] ?? null;
        const waived = findAdminVoidedCycles(epoch).filter((s) => earliestPaid !== null && earliestPaid < s);
        if (waived.some((s) => s <= today)) counts.waived += 1;
        const coverEnds = [...paid.map((i) => i.cycleEnd!), ...waived.map((s) => epoch.find((i) => i.cycleStart === s)!.cycleEnd!)].sort();
        const coverageEnd = coverEnds.at(-1) ?? null;
        const unpaid = epoch.filter((i) => i.status === 'issued');
        const oldestDue = unpaid.map((i) => i.dueOn!).sort()[0] ?? null;
        const basis = paid.length > 0 || (sub.activatedBeforePayment && unpaid.length > 0);
        if (sub.status === 'ended' || !basis) {
          expect(assignment, `${after} assignment must be absent`).toBeNull();
        } else {
          const endsOn = oldestDue ?? coverageEnd;
          const anchor = currentRun(epoch)?.anchor ?? sub.startedOn;
          expect(assignment?.endsOn, `${after} ends_on`).toBe(endsOn);
          expect(assignment?.startedOn, `${after} started_on is the anchor`).toBe(anchor < endsOn! ? anchor : addCalendarDays(endsOn!, -1));
        }
        const active = planActiveWithGrace(assignment, today, graceDays).active;
        const inactiveStatus = sub.status === 'suspended' || sub.status === 'ended' || (sub.status === 'pending' && !basis);
        expect(inactiveStatus, `${after} status vs planActiveWithGrace`).toBe(!active);
        if (sub.status === 'suspended') expect(unpaid.length, `${after} suspended with nothing owed`).toBeGreaterThan(0);
        if (active) {
          const covered = coverageEnd !== null && today < coverageEnd;
          const withinUnpaid = basis && unpaid.some((i) => planActiveWithGrace({ startedOn: '0001-01-01', endsOn: i.dueOn! }, today, graceDays).active);
          expect(covered || withinUnpaid, `${after} access on an uncovered day`).toBe(true);
        }
        if (!prevActive && active && sub.epoch === before.epoch) {
          expect(eventToday || paidToday !== null, `${after} access came back without any event`).toBe(true);
        }
        prevActive = active;

        // Suspension gap days: suspended and not inside any cycle at the end of the day.
        if (sub.status === 'suspended' && !live.some((i) => i.cycleStart && i.cycleStart <= today && today < i.cycleEnd!)) {
          gapDays.add(`${sub.epoch}:${today}`);
          counts.gapDays += 1;
        }
        // Cancel never shortens a paid cycle and leaves nothing unpaid for a later cycle.
        if (sub.cancelAtPeriodEnd && sub.status !== 'ended') {
          expect(epoch.filter((i) => (i.status === 'issued' || i.status === 'draft') && (i.cycleStart ?? '') > today), `${after} later cycle after a cancel`).toEqual([]);
          if (paidEndAtStart && today < paidEndAtStart && !unpaid.length) expect(active, `${after} cancel shortened a paid cycle`).toBe(true);
        }
        counts.days += 1;
      }

      // Days in a suspension gap are never inside any invoice's cycle (they are never billed later).
      for (const key of gapDays) {
        const [ep, day] = key.split(':') as [string, string];
        const inside = invoices.filter((i) => String(i.subscriptionEpoch) === ep && i.status !== 'void' && i.cycleStart && i.cycleStart <= day && day < i.cycleEnd!);
        expect(inside.map((i) => i.id), `seed=${seed} gap day ${day} billed later`).toEqual([]);
      }
    }

    expect(counts.days).toBeGreaterThan(32 * 600);
    expect(counts.issued).toBeGreaterThan(300);
    expect(counts.firstPayments).toBeGreaterThan(10);
    expect(counts.latePaid).toBeGreaterThan(50);
    expect(counts.resumes).toBeGreaterThan(3);
    expect(counts.expired).toBeGreaterThan(2);
    expect(counts.reissues).toBeGreaterThan(5);
    expect(counts.cancels).toBeGreaterThan(10);
    expect(counts.gapDays).toBeGreaterThan(20);
    expect(counts.nullEpochVoids).toBeGreaterThan(5);
    expect(counts.outages).toBeGreaterThan(10);
    expect(counts.outageRestarts).toBeGreaterThan(3);
  });
});

function containing(anchor: string, day: string): { start: string; end: string } | null {
  if (day < anchor) return null;
  let i = 0;
  while (cycleStartAt(anchor, i + 1) <= day) i += 1;
  return { start: cycleStartAt(anchor, i), end: cycleStartAt(anchor, i + 1) };
}

function nextStartAfter(anchor: string, day: string): string {
  return containing(anchor, day)?.end ?? anchor;
}
