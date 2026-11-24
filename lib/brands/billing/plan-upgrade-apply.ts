import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import { planGraceDaysFromEnv, studioEnv } from '@/lib/brand-studio/env';
import { loadAllowance, usedKrwIn } from '@/lib/brand-studio/usage';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandBillingAutoIssueOpen } from '@/lib/flags';
import { isSandboxedClientOrganization } from '../features';
import { loadPlanAssignment, planActiveOn, upsertPlanAssignmentInTx } from '../plans';
import { lockOrganizationForSubscription, previewDigest, reconcileSubscriptionInTx } from '../subscriptions/service';
import { BrandBillingDenied, requireDbAdmin } from './access';
import { insertAllowanceGrantInTx, loadPlanAllowanceDefaults } from './allowance';
import { kstDayStartUtc } from './cycle';
import { appendInvoiceEvent, draftBrandInvoiceInTx, voidBrandInvoiceInTx, type InvoiceActor, type ValidatedDraftInvoiceInput } from './invoices';
import { kstDayOf, kstMonthOf, PAID_BRAND_PLAN_IDS, type PaidBrandPlanId } from './math';
import { BRAND_PLAN_LIST_KRW } from './plan-credits';
import { planUpgradeEffect, planUpgradePairRefusal, type PlanUpgradeEffect, type PlanUpgradeInvoice } from './plan-upgrade';
import { hasColumn, hasTable, loadSubscriptionSchemaReady } from './schema-guard';

/**
 * B1c-3: applying a mid-cycle plan upgrade (rules in `./plan-upgrade.ts`; docs/BRAND-RECURRING-BILLING.md §5.10).
 *
 * One transaction, the organization locked `FOR NO KEY UPDATE` first (the subscription lock order). Two modes:
 * - `subscription`: a subscribed organization (BRAND_BILLING_AUTO_ISSUE on). The new cycle's invoice is issued at once
 *   by the subscription engine's own write path (reconcile, system actor, current epoch, due today + 14);
 * - `manual`: an organization whose plan an admin assigns by hand. The new cycle gets a DRAFT for the admin to issue.
 *
 * Steps: refuse unless the current cycle's invoice is paid; cut that invoice's cycle to today (audit event); void the
 * drafts of later cycles of the old anchor; clear a scheduled downgrade; move the plan (new plan, `started_on = today`)
 * through the shared plan writer; write the carry grant (plan organizations only); bill the new cycle. Any failure rolls
 * everything back. A second confirm on the same day is refused (`already_upgraded_today`).
 */

export type PlanUpgradeMode = 'manual' | 'subscription';

export type PlanUpgradeFailure = {
  ok: false;
  code: 'invalid' | 'conflict' | 'not_found' | 'forbidden' | 'sign_in_required' | 'disabled' | 'unavailable';
  field?: string;
  detail?: string;
};

export interface PlanUpgradePreview {
  organizationId: string;
  mode: PlanUpgradeMode;
  oldPlanId: PaidBrandPlanId;
  newPlanId: PaidBrandPlanId;
  todayKst: string;
  oldCycle: PlanUpgradeEffect['oldCycle'];
  newCycle: PlanUpgradeEffect['newCycle'];
  /** The day the next invoice is due to be billed (the new cycle's end). */
  nextBillingDay: string;
  carryKrw: number;
  carryValidUntil: string;
  newPlanCapKrw: number;
  /**
   * Subscribed organizations: the new plan's credits if the new invoice is still unpaid after its due date (the 50% rule
   * applies only once an invoice is overdue; until then the full plan credits). Manual: null (no 50% rule).
   */
  newPlanCapUnpaidKrw: number | null;
  oldCapKrw: number;
  oldUsedKrw: number;
  allowanceSource: 'plan' | 'override' | 'default';
  invoice: PlanUpgradeInvoice;
  /** The downgrade that was scheduled and is cleared by the upgrade. */
  scheduledDowngradeCleared: PaidBrandPlanId | null;
  /** Drafts of later cycles of the old anchor that are voided. */
  draftsVoided: number;
  digest: string;
}

export type PlanUpgradeOutcome =
  | { ok: true; applied: false; preview: PlanUpgradePreview }
  | { ok: true; applied: true; preview: PlanUpgradePreview; invoiceId: string; carryGrantId: string | null }
  | PlanUpgradeFailure;

const UpgradeInput = z.object({
  organizationId: z.string().uuid(),
  planId: z.string().trim().min(1),
  confirm: z.boolean().default(false),
  previewOnly: z.boolean().default(false),
  previewDigest: z.string().trim().regex(/^[0-9a-f]{16}$/).optional(),
});

/** Marker on the cut invoice's audit event; also how a second confirm on the same day is recognised. */
export const PLAN_UPGRADE_REASON = 'plan_upgrade' as const;

type Deps = { sql: SqlRunner; now?: () => Date; env?: Record<string, string | undefined>; graceDays?: number };

/** `brandBilling.planUpgrade`: a plan organization without a subscription (no flag). */
export function upgradeManualPlan(deps: Deps, viewer: Viewer, input: unknown): Promise<PlanUpgradeOutcome> {
  return runPlanUpgrade(deps, viewer, 'manual', input);
}

/** `brandSubscription.upgrade`: a subscribed organization (BRAND_BILLING_AUTO_ISSUE on). */
export function upgradeSubscriptionPlan(deps: Deps, viewer: Viewer, input: unknown): Promise<PlanUpgradeOutcome> {
  return runPlanUpgrade(deps, viewer, 'subscription', input);
}

interface InvoiceCoverRow {
  id: string;
  status: 'draft' | 'issued' | 'paid' | 'void';
  plan_id: string;
  cycle_start: string | null;
  cycle_end: string | null;
  cover_start: string;
  cover_end: string;
  issued_at: unknown;
  voided_by: string | null;
  subscription_epoch: number | null;
}

interface SubscriptionFacts {
  status: string;
  plan_id: string;
  pending_plan_id: string | null;
  cancel_at_period_end: boolean;
  epoch: number;
  revision: number;
}

const floor10 = (krw: number) => Math.floor(krw / 10) * 10;
const deny = (code: PlanUpgradeFailure['code'], detail: string, field?: string): PlanUpgradeFailure => ({
  ok: false,
  code,
  ...(field ? { field } : {}),
  detail,
});

async function runPlanUpgrade(deps: Deps, viewer: Viewer, mode: PlanUpgradeMode, raw: unknown): Promise<PlanUpgradeOutcome> {
  const parsed = UpgradeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  const v = parsed.data;
  const nowDate = deps.now?.() ?? new Date();
  const nowIso = nowDate.toISOString();
  const todayKst = kstDayOf(nowDate);
  const graceDays = deps.graceDays ?? planGraceDaysFromEnv(deps.env);
  if (mode === 'subscription' && !brandBillingAutoIssueOpen(deps.env)) return { ok: false, code: 'disabled' };

  try {
    return await deps.sql.transaction(async (sql): Promise<PlanUpgradeOutcome> => {
      const adminId = await requireDbAdmin(sql, viewer);
      const admin: InvoiceActor = { kind: 'admin', userId: adminId };
      const schemaReady =
        (await hasColumn(sql, 'brand_invoices', 'cycle_start')) &&
        (await hasColumn(sql, 'brand_invoices', 'kind')) &&
        (await hasColumn(sql, 'brand_allowance_grants', 'valid_from')) &&
        (await hasColumn(sql, 'brand_allowance_grants', 'kind'));
      if (!schemaReady) return { ok: false, code: 'unavailable' };
      const subscriptionSchema = await loadSubscriptionSchemaReady(sql);
      if (mode === 'subscription' && !subscriptionSchema) return { ok: false, code: 'unavailable' };

      // 1. The organization lock first, then everything else.
      const org = await lockOrganizationForSubscription(sql, v.organizationId);
      if (!org) return { ok: false, code: 'not_found' };
      if (isSandboxedClientOrganization(org)) return deny('invalid', 'sandboxed_org', 'organizationId');

      // 2. Which kind of organization: a non-ended subscription owns the plan (the subscription operation upgrades it).
      const sub = subscriptionSchema
        ? ((
            await sql.query<SubscriptionFacts>(
              `select status, plan_id, pending_plan_id, cancel_at_period_end, epoch, revision
                 from brand_subscriptions where organization_id = $1 and status <> 'ended' for update`,
              [v.organizationId],
            )
          ).rows[0] ?? null)
        : null;
      if (mode === 'manual' && sub) return deny('conflict', 'subscription_upgrade_only');
      if (mode === 'subscription' && !sub) return deny('not_found', 'no_subscription');

      // 3. A second confirm (double submit) finds the cycle already restarted today.
      const upgradedToday = (
        await sql.query(
          `select 1 from brand_invoice_events
            where organization_id = $1 and action = 'edited' and snapshot->>'reason' = $2 and snapshot->>'upgradedOn' = $3 limit 1`,
          [v.organizationId, PLAN_UPGRADE_REASON, todayKst],
        )
      ).rows[0];
      if (upgradedToday) return deny('conflict', 'already_upgraded_today');

      // 4. The plan in force and the plan asked for.
      const assignment = await loadPlanAssignment(sql, v.organizationId);
      if (!assignment) return deny('conflict', 'no_plan');
      const oldPlanId = mode === 'subscription' ? sub!.plan_id : assignment.planId;
      const pair = planUpgradePairRefusal(oldPlanId, v.planId);
      if (pair) return deny('invalid', pair, 'planId');
      if (!planActiveOn(assignment, todayKst)) return deny('conflict', 'plan_not_active');

      // 5. The current cycle must be paid; later cycles must not be billed yet (their drafts are voided).
      const rows = (
        await sql.query<InvoiceCoverRow>(
          `select id::text as id, status, plan_id, cycle_start::text as cycle_start, cycle_end::text as cycle_end,
                  coalesce(cycle_start, to_date(period || '-01', 'YYYY-MM-DD'))::text as cover_start,
                  coalesce(cycle_end, (to_date(period || '-01', 'YYYY-MM-DD') + interval '1 month')::date)::text as cover_end,
                  issued_at, voided_by::text as voided_by, subscription_epoch
             from brand_invoices
            where organization_id = $1 and kind = 'subscription'
              and coalesce(cycle_end, (to_date(period || '-01', 'YYYY-MM-DD') + interval '1 month')::date) > $2::date
            order by created_at, id
            for update`,
          [v.organizationId, todayKst],
        )
      ).rows;
      const coversToday = (r: InvoiceCoverRow) => r.cover_start <= todayKst && todayKst < r.cover_end;
      const live = rows.filter((r) => r.status !== 'void');
      const current = live.filter(coversToday);
      if (current.length > 1) return deny('conflict', 'overlapping_invoices');
      const paidNow = current[0];
      if (!paidNow) {
        const lastVoid = rows.filter((r) => r.status === 'void' && coversToday(r)).at(-1);
        if (lastVoid && lastVoid.issued_at !== null && lastVoid.voided_by !== null) return deny('conflict', 'current_cycle_waived');
        return deny('conflict', 'current_cycle_not_invoiced');
      }
      if (paidNow.cycle_start === null || paidNow.cycle_end === null) return deny('conflict', 'current_invoice_not_cycle');
      if (mode === 'subscription' && Number(paidNow.subscription_epoch) !== Number(sub!.epoch)) return deny('conflict', 'current_cycle_not_invoiced');
      if (paidNow.status === 'draft') return deny('conflict', 'current_cycle_not_invoiced');
      if (paidNow.status === 'issued') return deny('conflict', 'current_cycle_unpaid');
      if (mode === 'subscription') {
        if (sub!.cancel_at_period_end) return deny('conflict', 'subscription_canceling');
        if (sub!.status !== 'active') return deny('conflict', 'subscription_not_active');
      }
      const later = live.filter((r) => r !== paidNow);
      if (later.some((r) => r.status !== 'draft')) return deny('conflict', 'later_cycle_already_issued');

      // 6. What the old cycle still holds (its cap as the customer sees it; usage up to the start of today).
      const allowance = await loadAllowance(sql, v.organizationId, { defaultMonthlyKrw: studioEnv(deps.env).defaultMonthlyKrw, planGraceDays: graceDays }, nowDate);
      if (allowance.source === 'plan' && (allowance.cycle?.start !== paidNow.cycle_start || allowance.cycle?.end !== paidNow.cycle_end)) {
        return deny('conflict', 'cycle_mismatch');
      }
      const oldUsedKrw = await usedKrwIn(sql, v.organizationId, { start: kstDayStartUtc(paidNow.cycle_start), end: kstDayStartUtc(todayKst) });
      const discountPercent = await discountInForce(sql, v.organizationId);
      const caps = Object.fromEntries(PAID_BRAND_PLAN_IDS.map((id) => [id, null])) as Record<PaidBrandPlanId, number | null>;
      for (const d of await loadPlanAllowanceDefaults(sql)) caps[d.planId] = d.monthlyCapKrw;

      const effect = planUpgradeEffect({
        todayKst,
        oldPlanId,
        newPlanId: v.planId,
        currentCycle: { start: paidNow.cycle_start, end: paidNow.cycle_end },
        planActive: true,
        sandboxed: false,
        allowanceSource: allowance.source,
        oldCapKrw: allowance.capKrw,
        oldUsedKrw,
        planCapsKrw: caps,
        listPricesKrw: BRAND_PLAN_LIST_KRW,
        discountPercent,
      });
      if (!effect.ok) {
        const field = effect.code === 'plan_cap_not_set' ? 'planId' : undefined;
        return deny(field ? 'invalid' : 'conflict', effect.code, field);
      }

      // 7. The preview and its digest (two-step confirm; a stale preview is refused).
      const scheduledDowngradeCleared =
        mode === 'subscription' && sub!.pending_plan_id && (PAID_BRAND_PLAN_IDS as readonly string[]).includes(sub!.pending_plan_id)
          ? (sub!.pending_plan_id as PaidBrandPlanId)
          : null;
      const drafts = later.filter((r) => r.status === 'draft');
      const base = {
        organizationId: v.organizationId,
        mode,
        oldPlanId: effect.oldPlanId,
        newPlanId: effect.newPlanId,
        todayKst,
        oldCycle: effect.oldCycle,
        newCycle: effect.newCycle,
        nextBillingDay: effect.newCycle.end,
        carryKrw: effect.carryKrw,
        carryValidUntil: effect.carryValidUntil,
        newPlanCapKrw: effect.newPlanCapKrw,
        newPlanCapUnpaidKrw: mode === 'subscription' ? floor10((effect.newPlanCapKrw * 50) / 100) : null,
        oldCapKrw: allowance.capKrw,
        oldUsedKrw,
        allowanceSource: allowance.source,
        invoice: effect.invoice,
        scheduledDowngradeCleared,
        draftsVoided: drafts.length,
      };
      const preview: PlanUpgradePreview = {
        ...base,
        digest: previewDigest({
          organizationId: base.organizationId,
          mode,
          oldPlanId: base.oldPlanId,
          newPlanId: base.newPlanId,
          todayKst,
          oldCycleStart: base.oldCycle.start,
          oldCycleEndBefore: base.oldCycle.endBefore,
          newCycleStart: base.newCycle.start,
          newCycleEnd: base.newCycle.end,
          carryKrw: base.carryKrw,
          newPlanCapKrw: base.newPlanCapKrw,
          oldCapKrw: base.oldCapKrw,
          oldUsedKrw: base.oldUsedKrw,
          discountPercent: base.invoice.discountPercent,
          supplyKrw: base.invoice.supplyKrw,
          vatKrw: base.invoice.vatKrw,
          totalKrw: base.invoice.totalKrw,
          dueOn: base.invoice.dueOn,
          scheduledDowngradeCleared,
          draftsVoided: drafts.map((d) => d.id).join(','),
        }),
      };
      if (v.previewOnly) return { ok: true, applied: false, preview };
      if (!v.confirm || v.previewDigest === undefined) return deny('invalid', 'preview_required', 'previewDigest');
      if (v.previewDigest !== preview.digest) return deny('conflict', 'preview_stale');

      // 8a. Drafts of later cycles of the old anchor are voided (by the system for a subscription).
      for (const d of drafts) {
        const voided =
          mode === 'subscription'
            ? await voidBrandInvoiceInTx(sql, { kind: 'system' }, { invoiceId: d.id, reason: PLAN_UPGRADE_REASON }, nowDate, { recordActorKind: true })
            : await voidBrandInvoiceInTx(sql, admin, { invoiceId: d.id, reason: PLAN_UPGRADE_REASON }, nowDate);
        if (!voided.ok) throw new BrandBillingDenied('conflict', 'upgrade_void_failed');
      }

      // 8b. The paid cycle now ends today. It stays paid; nothing is refunded.
      const cut = (
        await sql.query(
          `update brand_invoices set cycle_end = $2::date, updated_by = $3, updated_at = $4::timestamptz
            where id = $1 and status = 'paid' and cycle_end = $5::date
            returning id`,
          [paidNow.id, todayKst, adminId, nowIso, effect.oldCycle.endBefore],
        )
      ).rows[0];
      if (!cut) throw new BrandBillingDenied('conflict', 'upgrade_cut_failed');
      await appendInvoiceEvent(sql, {
        invoiceId: paidNow.id,
        organizationId: v.organizationId,
        action: 'edited',
        fromStatus: 'paid',
        toStatus: 'paid',
        snapshot: {
          reason: PLAN_UPGRADE_REASON,
          upgradedOn: todayKst,
          fromPlanId: effect.oldPlanId,
          toPlanId: effect.newPlanId,
          cycleStart: effect.oldCycle.start,
          cycleEndBefore: effect.oldCycle.endBefore,
          cycleEndAfter: effect.oldCycle.end,
          carryKrw: effect.carryKrw,
        },
        note: 'plan upgrade: the paid cycle ends on the upgrade day (nothing refunded)',
        actorId: adminId,
        ...(mode === 'subscription' ? { actorKind: 'admin' as const } : {}),
        createdAt: nowIso,
      });

      // 8c. A subscription carries the new plan; a scheduled downgrade is cleared.
      if (mode === 'subscription') {
        const updated = (
          await sql.query(
            `update brand_subscriptions
                set plan_id = $2, pending_plan_id = null, pending_plan_effective_period = null, revision = $3, updated_at = $4::timestamptz
              where organization_id = $1 and revision = $5 and status <> 'ended'
              returning organization_id`,
            [v.organizationId, effect.newPlanId, Number(sub!.revision) + 1, nowIso, Number(sub!.revision)],
          )
        ).rows[0];
        if (!updated) throw new BrandBillingDenied('conflict', 'subscription_revision_conflict');
        if (scheduledDowngradeCleared) {
          await appendSubscriptionEvent(sql, v.organizationId, 'downgrade_cleared', adminId, { clearedPlanId: scheduledDowngradeCleared, reason: PLAN_UPGRADE_REASON }, nowIso);
        }
        await appendSubscriptionEvent(
          sql,
          v.organizationId,
          'plan_changed',
          adminId,
          {
            kind: 'upgrade',
            fromPlanId: effect.oldPlanId,
            toPlanId: effect.newPlanId,
            upgradedOn: todayKst,
            oldCycle: effect.oldCycle,
            newCycle: effect.newCycle,
            carryKrw: effect.carryKrw,
          },
          nowIso,
        );
      }

      // 8d. The plan: new plan from today (the anchor moves). Through the shared writer; the admin start-day guard passes
      //     because nothing billed covers a later day any more (the cycle was cut, later drafts voided, issued refused).
      const moved = await upsertPlanAssignmentInTx(sql, {
        organizationId: v.organizationId,
        planId: effect.newPlanId,
        billingMode: assignment.billingMode,
        startedOn: todayKst,
        endsOn: assignment.endsOn,
        seats: assignment.seats,
        note: assignment.note,
        expectedRevision: assignment.revision,
        actor: admin,
        recordActorKind: mode === 'subscription',
        organizationLock: 'no key update',
        now: nowDate,
        graceDays,
      });
      if (!moved.ok) throw new BrandBillingDenied(moved.code === 'not_found' ? 'not_found' : 'conflict', `upgrade_plan_write_failed:${moved.field ?? moved.code}`);

      // 8e. The carry: a grant from today to the new cycle's last day (plan organizations only; never an override).
      let carryGrantId: string | null = null;
      if (effect.carryKrw >= 10) {
        const granted = await insertAllowanceGrantInTx(
          sql,
          {
            organizationId: v.organizationId,
            amountKrw: effect.carryKrw,
            validMonth: kstMonthOf(nowDate),
            reason: `플랜 올림 이월 ${effect.oldPlanId} → ${effect.newPlanId} (${todayKst})`,
          },
          { createdBy: adminId, now: nowDate, kind: 'carry', validRange: { from: effect.carryValidFrom, until: effect.carryValidUntil } },
        );
        if (!granted.ok || !granted.id) throw new BrandBillingDenied('conflict', 'upgrade_carry_failed');
        carryGrantId = granted.id;
      }

      // 8f. The new cycle's invoice.
      let invoiceId: string;
      if (mode === 'manual') {
        const drafted = await draftBrandInvoiceInTx(
          sql,
          admin,
          {
            organizationId: v.organizationId,
            cycle: 'current',
            planId: effect.newPlanId,
            prorate: false,
            applyActiveDiscount: true,
            manualAmounts: false,
            manualReason: '',
            memo: '',
          } as ValidatedDraftInvoiceInput,
          nowDate,
        );
        if (!drafted.ok) throw new BrandBillingDenied('conflict', `upgrade_draft_failed:${drafted.code}`);
        invoiceId = drafted.invoice.id;
        await expectNewCycleInvoice(sql, invoiceId, effect, 'draft');
      } else {
        const summary = await reconcileSubscriptionInTx(sql, { organizationId: v.organizationId, actor: admin, now: nowDate, graceDays });
        if (summary.failures.length > 0) throw new BrandBillingDenied('conflict', 'upgrade_issue_failed');
        const issued = (
          await sql.query<{ id: string }>(
            `select id::text as id from brand_invoices
              where organization_id = $1 and kind = 'subscription' and status = 'issued' and cycle_start = $2::date and subscription_epoch = $3`,
            [v.organizationId, effect.newCycle.start, Number(sub!.epoch)],
          )
        ).rows;
        if (issued.length !== 1) throw new BrandBillingDenied('conflict', 'upgrade_issue_failed');
        invoiceId = String(issued[0]!.id);
        await expectNewCycleInvoice(sql, invoiceId, effect, 'issued');
      }
      const after = await loadPlanAssignment(sql, v.organizationId);
      if (!after || after.planId !== effect.newPlanId || after.startedOn !== todayKst) throw new BrandBillingDenied('conflict', 'upgrade_plan_write_failed');

      return { ok: true, applied: true, preview, invoiceId, carryGrantId };
    });
  } catch (error) {
    if (error instanceof BrandBillingDenied) {
      const code = (['invalid', 'conflict', 'not_found', 'forbidden', 'sign_in_required', 'disabled', 'unavailable'] as const).find((c) => c === error.code) ?? 'conflict';
      return { ok: false, code, ...(error.detail ? { detail: error.detail } : {}) };
    }
    if ((error as { code?: string } | null)?.code === '23505') return { ok: false, code: 'conflict' };
    throw error;
  }
}

export interface PlanUpgradeCarry {
  id: string;
  amountKrw: number;
  /** First day the carried credits count (the upgrade day = the new cycle's first day). */
  validFrom: string;
  /** Last day they count (the new cycle's last day); gone the day after. */
  validUntil: string;
  revoked: boolean;
}

/** The plan-upgrade carry grants of an organization (admin page: which cycle each belongs to and when it ends). */
export async function listPlanUpgradeCarries(sql: SqlRunner, organizationId: string): Promise<PlanUpgradeCarry[]> {
  if (!(await hasColumn(sql, 'brand_allowance_grants', 'valid_from')) || !(await hasColumn(sql, 'brand_allowance_grants', 'kind'))) return [];
  const { rows } = await sql.query<{ id: string; amount_krw: number; valid_from: string; valid_until: string; revoked_at: unknown }>(
    `select id::text as id, amount_krw, valid_from::text as valid_from, valid_until::text as valid_until, revoked_at
       from brand_allowance_grants
      where organization_id = $1 and kind = 'carry' and valid_from is not null and valid_until is not null
      order by created_at desc, id desc`,
    [organizationId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    amountKrw: Number(r.amount_krw),
    validFrom: String(r.valid_from),
    validUntil: String(r.valid_until),
    revoked: r.revoked_at !== null && r.revoked_at !== undefined,
  }));
}

/** The new cycle's invoice is exactly what the preview said: its cycle, the new plan, the amounts, and (issued) the due day. */
async function expectNewCycleInvoice(sql: SqlRunner, invoiceId: string, effect: PlanUpgradeEffect, status: 'draft' | 'issued'): Promise<void> {
  const row = (
    await sql.query<{ status: string; plan_id: string; cycle_start: string; cycle_end: string; total_krw: number; supply_krw: number; due_on: string | null }>(
      `select status, plan_id, cycle_start::text as cycle_start, cycle_end::text as cycle_end, total_krw, supply_krw, due_on::text as due_on
         from brand_invoices where id = $1`,
      [invoiceId],
    )
  ).rows[0];
  const matches =
    row !== undefined &&
    row.status === status &&
    row.plan_id === effect.newPlanId &&
    row.cycle_start === effect.newCycle.start &&
    row.cycle_end === effect.newCycle.end &&
    Number(row.total_krw) === effect.invoice.totalKrw &&
    Number(row.supply_krw) === effect.invoice.supplyKrw &&
    (status === 'draft' || row.due_on === effect.invoice.dueOn);
  if (!matches) throw new BrandBillingDenied('conflict', 'upgrade_invoice_mismatch');
}

/** The discount a new draft would apply today (the same rule as the draft path). */
async function discountInForce(sql: SqlRunner, organizationId: string): Promise<number> {
  if (!(await hasTable(sql, 'brand_discounts'))) return 0;
  const row = (
    await sql.query<{ percent: number; invoices_total: number | null; invoices_used: number }>(
      "select percent, invoices_total, invoices_used from brand_discounts where organization_id = $1 and status = 'active' for share",
      [organizationId],
    )
  ).rows[0];
  if (!row) return 0;
  return row.invoices_total === null || Number(row.invoices_used) < Number(row.invoices_total) ? Number(row.percent) : 0;
}

/** A `brand_subscription_events` row by the admin who upgraded (the same statement the subscription service writes). */
async function appendSubscriptionEvent(
  sql: SqlRunner,
  organizationId: string,
  action: 'plan_changed' | 'downgrade_cleared',
  adminId: string,
  snapshot: Record<string, unknown>,
  createdAt: string,
): Promise<void> {
  await sql.query(
    `insert into brand_subscription_events (organization_id, action, actor, actor_kind, snapshot, created_at)
     values ($1, $2, $3, 'admin', $4::jsonb, $5::timestamptz)`,
    [organizationId, action, adminId, JSON.stringify(snapshot), createdAt],
  );
}
