import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import { planGraceDaysFromEnv } from '@/lib/brand-studio/env';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandBillingAutoIssueOpen } from '@/lib/flags';
import { BrandBillingDenied, requireDbAdmin } from '../billing/access';
import {
  appendInvoiceEvent,
  computeCurrentDraftRefreshInput,
  draftBrandInvoiceInTx,
  issueBrandInvoiceInTx,
  loadBrandBillingProfile,
  registerSubscriptionReconcileHook,
  updateDraftBrandInvoiceInTx,
  voidBrandInvoiceInTx,
  type InvoiceActor,
} from '../billing/invoices';
import {
  daysInYearMonth,
  diffCalendarDays,
  invoiceAmounts,
  isValidCalendarDay,
  isValidKoreanBusinessRegNo,
  isValidYearMonth,
  kstDayOf,
  kstMonthOf,
  planActiveWithGrace,
  proposeProration,
  type PaidBrandPlanId,
} from '../billing/math';
import { loadSubscriptionSchemaReady } from '../billing/schema-guard';
import type { BrandBillingProfile, BrandInvoice, BrandInvoiceStatus } from '../billing/types';
import { isSandboxedClientOrganization } from '../features';
import { enqueueReconcileFailureNotice } from './notices';
import {
  BRAND_PLAN_IDS,
  BRAND_PLANS,
  clearPlanAssignmentInTx,
  loadPlanAssignment,
  upsertPlanAssignmentInTx,
  type BrandPlanId,
} from '../plans';
import { cycleContaining, cycleStartAt } from '../billing/cycle';
import {
  addMonthsToPeriod,
  currentRun,
  cycleStartingOn,
  dueOnForInvoice,
  firstInvoiceRuleApplies,
  pendingPlanCarriedByInvoice,
  evaluateSubscription,
  findAdminVoidedCycles,
  isPaidPlanId,
  nextPeriodOf,
  periodOfDay,
  subscriptionNeedsReissue,
  type Cycle,
  type BrandCollectionMethod,
  type BrandInvoiceKind,
  type BrandSubscriptionStatus,
  type SubscriptionAction,
  type EngineInvoice,
  type EngineSubscription,
} from './engine';
import type {
  BrandSubscription,
  SubscriptionPanelFacts,
  BrandSubscriptionActorKind,
  BrandSubscriptionEvent,
  BrandSubscriptionEventAction,
  BrandSubscriptionFailureCode,
  BrandSubscriptionOutcome,
  ExtendedInvoiceMeta,
} from './types';

const UUID = z.string().uuid();
const CalendarDay = z.string().trim().refine(isValidCalendarDay, 'invalid YYYY-MM-DD');
const stamp = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

function outcomeError(error: unknown): { ok: false; code: BrandSubscriptionFailureCode; detail?: string } {
  if (error instanceof BrandBillingDenied) {
    return { ok: false, code: error.code as BrandSubscriptionFailureCode, ...(error.detail ? { detail: error.detail } : {}) };
  }
  if ((error as { code?: string } | null)?.code === '23505') {
    return { ok: false, code: 'conflict' };
  }
  throw error;
}

const SUBSCRIPTION_SELECT_COLS = `
  organization_id::text as organization_id, status, plan_id, pending_plan_id,
  pending_plan_effective_period, collection_method, started_on::text as started_on,
  prepaid_through::text as prepaid_through, cancel_at_period_end, canceled_at, ended_at,
  activated_before_payment, epoch, last_reconciled_at, reconcile_failures, last_reconcile_error, revision,
  created_by::text as created_by, created_at, updated_at`;

type SubscriptionRow = {
  organization_id: string;
  status: string;
  plan_id: string;
  pending_plan_id: string | null;
  pending_plan_effective_period: string | null;
  collection_method: string;
  started_on: string;
  prepaid_through: string | null;
  cancel_at_period_end: boolean;
  canceled_at: unknown;
  ended_at: unknown;
  activated_before_payment: boolean;
  epoch: number;
  last_reconciled_at: unknown;
  reconcile_failures: number;
  last_reconcile_error: string | null;
  revision: number;
  created_by: string | null;
  created_at: unknown;
  updated_at: unknown;
};

type ExtendedInvoiceRow = {
  id: string;
  organization_id: string;
  period: string;
  plan_id: string;
  base_list_krw: number;
  prorated_days: number | null;
  period_days: number | null;
  discount_id: string | null;
  discount_percent: number;
  manual_amounts: boolean;
  status: 'draft' | 'issued' | 'paid' | 'void';
  issued_at: unknown;
  paid_at: unknown;
  voided_at: unknown;
  voided_by: string | null;
  void_actor_kind: 'admin' | 'system' | null;
  void_reason: string;
  created_at: unknown;
  kind: string;
  covers_months: number;
  due_on: string | null;
  collection_method: string | null;
  tax_invoice_issued_on: string | null;
  tax_invoice_ref: string | null;
  created_via: string | null;
  issued_via: string | null;
  subscription_epoch: number | null;
  cycle_start?: string | null;
  cycle_end?: string | null;
  memo: string;
};

function mapSubscription(row: SubscriptionRow): BrandSubscription {
  return {
    organizationId: String(row.organization_id),
    status: row.status as BrandSubscriptionStatus,
    planId: row.plan_id as BrandPlanId,
    pendingPlanId: row.pending_plan_id ? (row.pending_plan_id as BrandPlanId) : null,
    pendingPlanEffectivePeriod: row.pending_plan_effective_period ? String(row.pending_plan_effective_period) : null,
    collectionMethod: row.collection_method as BrandCollectionMethod,
    startedOn: String(row.started_on),
    prepaidThrough: row.prepaid_through == null ? null : String(row.prepaid_through),
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    canceledAt: stamp(row.canceled_at),
    endedAt: stamp(row.ended_at),
    activatedBeforePayment: Boolean(row.activated_before_payment),
    epoch: Number(row.epoch ?? 1),
    lastReconciledAt: stamp(row.last_reconciled_at),
    reconcileFailures: Number(row.reconcile_failures ?? 0),
    lastReconcileError: row.last_reconcile_error == null ? null : String(row.last_reconcile_error),
    revision: Number(row.revision),
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: stamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: stamp(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function subscriptionSnapshot(sub: BrandSubscription): Record<string, unknown> {
  return {
    status: sub.status,
    planId: sub.planId,
    pendingPlanId: sub.pendingPlanId,
    pendingPlanEffectivePeriod: sub.pendingPlanEffectivePeriod,
    collectionMethod: sub.collectionMethod,
    startedOn: sub.startedOn,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    activatedBeforePayment: sub.activatedBeforePayment,
    epoch: sub.epoch,
    revision: sub.revision,
  };
}

async function appendSubscriptionEvent(
  sql: SqlRunner,
  params: {
    organizationId: string;
    action: BrandSubscriptionEventAction;
    actor: InvoiceActor;
    snapshot: Record<string, unknown>;
    createdAt: string;
  },
): Promise<void> {
  const actorUuid = params.actor.kind === 'admin' ? params.actor.userId : null;
  await sql.query(
    `insert into brand_subscription_events (
       organization_id, action, actor, actor_kind, snapshot, created_at
     ) values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)`,
    [
      params.organizationId,
      params.action,
      actorUuid,
      params.actor.kind,
      JSON.stringify(params.snapshot),
      params.createdAt,
    ],
  );
}

/** Transfer billing requires a complete Korean tax-invoice profile (legal name, valid 10-digit reg no, rep, address, email). */
export function hasCompleteTaxInvoiceProfile(profile: BrandBillingProfile | null): boolean {
  if (!profile) return false;
  return (
    profile.companyLegalName.trim().length > 0 &&
    isValidKoreanBusinessRegNo(profile.businessRegNo) &&
    profile.representativeName.trim().length > 0 &&
    profile.businessAddress.trim().length > 0 &&
    z.email().safeParse(profile.taxInvoiceEmail.trim()).success
  );
}

export async function loadBrandSubscription(
  sql: SqlRunner,
  organizationId: string,
): Promise<BrandSubscription | null> {
  if (!UUID.safeParse(organizationId).success) return null;
  if (!(await loadSubscriptionSchemaReady(sql))) return null;
  const row = (
    await sql.query<SubscriptionRow>(
      `select ${SUBSCRIPTION_SELECT_COLS}
         from brand_subscriptions
        where organization_id = $1`,
      [organizationId],
    )
  ).rows[0];
  return row ? mapSubscription(row) : null;
}

export async function listBrandSubscriptionEvents(
  sql: SqlRunner,
  organizationId: string,
): Promise<BrandSubscriptionEvent[]> {
  if (!UUID.safeParse(organizationId).success) return [];
  if (!(await loadSubscriptionSchemaReady(sql))) return [];
  const { rows } = await sql.query<{
    id: string;
    organization_id: string;
    action: string;
    actor: string | null;
    actor_kind: string;
    snapshot: Record<string, unknown>;
    created_at: unknown;
  }>(
    `select id::text as id, organization_id::text as organization_id, action,
            actor::text as actor, actor_kind, snapshot, created_at
       from brand_subscription_events
      where organization_id = $1
      order by created_at desc, id desc
      limit 60`,
    [organizationId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    organizationId: String(r.organization_id),
    action: r.action as BrandSubscriptionEventAction,
    actor: r.actor ? String(r.actor) : null,
    actorKind: (r.actor_kind === 'system' ? 'system' : 'admin') as BrandSubscriptionActorKind,
    snapshot: (r.snapshot && typeof r.snapshot === 'object' ? r.snapshot : {}) as Record<string, unknown>,
    createdAt: stamp(r.created_at) ?? new Date(0).toISOString(),
  }));
}

export async function loadExtendedInvoiceMetaByOrg(
  sql: SqlRunner,
  organizationId: string,
): Promise<Map<string, ExtendedInvoiceMeta>> {
  const out = new Map<string, ExtendedInvoiceMeta>();
  if (!UUID.safeParse(organizationId).success) return out;
  if (!(await loadSubscriptionSchemaReady(sql))) return out;
  const { rows } = await sql.query<{
    id: string;
    kind: string;
    covers_months: number;
    due_on: string | null;
    collection_method: string | null;
    tax_invoice_issued_on: string | null;
    tax_invoice_ref: string | null;
    created_via: string | null;
    issued_via: string | null;
    subscription_epoch: number | null;
  }>(
    `select id::text as id, kind, covers_months, due_on::text as due_on, collection_method,
            tax_invoice_issued_on::text as tax_invoice_issued_on, tax_invoice_ref,
            created_via, issued_via, subscription_epoch
       from brand_invoices
      where organization_id = $1`,
    [organizationId],
  );
  for (const r of rows) {
    out.set(String(r.id), {
      invoiceId: String(r.id),
      kind: (r.kind as BrandInvoiceKind) ?? 'subscription',
      coversMonths: Number(r.covers_months ?? 1),
      dueOn: r.due_on == null ? null : String(r.due_on),
      collectionMethod: r.collection_method ? (r.collection_method as BrandCollectionMethod) : null,
      taxInvoiceIssuedOn: r.tax_invoice_issued_on == null ? null : String(r.tax_invoice_issued_on),
      taxInvoiceRef: r.tax_invoice_ref == null ? null : String(r.tax_invoice_ref),
      createdVia: r.created_via ? (r.created_via as BrandSubscriptionActorKind) : null,
      issuedVia: r.issued_via ? (r.issued_via as BrandSubscriptionActorKind) : null,
      subscriptionEpoch: r.subscription_epoch == null ? null : Number(r.subscription_epoch),
    });
  }
  return out;
}

function toEngineSubscription(sub: BrandSubscription): EngineSubscription {
  return {
    status: sub.status,
    planId: sub.planId,
    pendingPlanId: sub.pendingPlanId,
    pendingPlanEffectivePeriod: sub.pendingPlanEffectivePeriod,
    collectionMethod: sub.collectionMethod,
    startedOn: sub.startedOn,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    activatedBeforePayment: sub.activatedBeforePayment,
    epoch: sub.epoch,
  };
}

/** A1/B2/B4.4: Loads ONLY invoices belonging to the current subscription `epoch`, including void-actor metadata. */
async function loadInvoicesForEngine(
  sql: SqlRunner,
  organizationId: string,
  epoch: number,
  options: { lockForUpdate?: boolean } = {},
): Promise<ExtendedInvoiceRow[]> {
  const lockClause = options.lockForUpdate === false ? '' : 'for update';
  const { rows } = await sql.query<Omit<ExtendedInvoiceRow, 'void_actor_kind'>>(
    `select id::text as id, organization_id::text as organization_id, period, plan_id,
            base_list_krw, prorated_days, period_days, discount_id::text as discount_id,
            discount_percent, manual_amounts, status, issued_at, paid_at, voided_at,
            voided_by::text as voided_by, void_reason, created_at,
            kind, covers_months, due_on::text as due_on, collection_method,
            tax_invoice_issued_on::text as tax_invoice_issued_on, tax_invoice_ref,
            created_via, issued_via, subscription_epoch, memo,
            cycle_start::text as cycle_start, cycle_end::text as cycle_end
       from brand_invoices
      where organization_id = $1
        and subscription_epoch = $2
      order by period asc, created_at asc, id asc
      ${lockClause}`,
    [organizationId, epoch],
  );
  // Who voided a void row (an admin void after issue waives the period; a system void never does).
  const eventIds = rows.filter((r) => r.status === 'void').map((r) => String(r.id));
  const voidActors = new Map<string, 'admin' | 'system'>();
  if (eventIds.length > 0) {
    const evRes = await sql.query<{ invoice_id: string; action: string; actor_kind: string }>(
      `select invoice_id::text as invoice_id, action, actor_kind
         from brand_invoice_events
        where invoice_id = any($1::uuid[])
          and action = 'voided'
        order by created_at desc, id desc`,
      [eventIds],
    );
    for (const ev of evRes.rows) {
      const invId = String(ev.invoice_id);
      if (!voidActors.has(invId)) voidActors.set(invId, ev.actor_kind === 'system' ? 'system' : 'admin');
    }
  }
  return rows.map((r) => {
    const invId = String(r.id);
    const voidActorKind =
      r.status === 'void'
        ? (voidActors.get(invId) ?? (r.voided_by ? 'admin' : 'system'))
        : null;
    return { ...r, void_actor_kind: voidActorKind };
  });
}

function mapEngineInvoices(rows: readonly ExtendedInvoiceRow[]): EngineInvoice[] {
  return rows.map((r) => ({
    id: String(r.id),
    period: String(r.period),
    kind: (r.kind as BrandInvoiceKind) ?? 'subscription',
    coversMonths: Number(r.covers_months ?? 1),
    status: r.status,
    planId: r.plan_id as BrandPlanId,
    dueOn: r.due_on == null ? null : String(r.due_on),
    issuedAt: stamp(r.issued_at),
    subscriptionEpoch: r.subscription_epoch == null ? null : Number(r.subscription_epoch),
    manualAmounts: Boolean(r.manual_amounts),
    paidAt: stamp(r.paid_at),
    voidedAt: stamp(r.voided_at),
    voidedBy: r.void_actor_kind,
    createdAt: stamp(r.created_at),
    createdVia: r.created_via === 'system' ? 'system' : r.created_via === 'admin' ? 'admin' : null,
    cycleStart: r.cycle_start == null ? null : String(r.cycle_start).slice(0, 10),
    cycleEnd: r.cycle_end == null ? null : String(r.cycle_end).slice(0, 10),
  }));
}

/** Admin panel facts for one subscription (review round 2, items 1, 3, 4, 7). Read-only, no locks. */
export async function loadSubscriptionPanelFacts(
  sql: SqlRunner,
  subscription: BrandSubscription,
  now: Date,
  graceDays: number,
): Promise<SubscriptionPanelFacts | null> {
  if (!(await loadSubscriptionSchemaReady(sql))) return null;
  const rows = await loadInvoicesForEngine(sql, subscription.organizationId, subscription.epoch, { lockForUpdate: false });
  const invoices = mapEngineInvoices(rows);
  const todayKst = kstDayOf(now);
  const currentPeriod = periodOfDay(todayKst);
  const nothingPaid = !invoices.some((inv) => inv.status === 'paid' && (inv.kind === 'subscription' || inv.kind === 'prepay'));
  if (subscription.status === 'ended') {
    return {
      currentPeriod,
      waivedPeriods: [],
      currentPeriodWaived: false,
      needsReissue: false,
      nothingPaid,
      blockedByOlderEpoch: [],
      graceDays,
    };
  }
  const evaluation = evaluateSubscription({
    todayKst,
    graceDays,
    subscription: toEngineSubscription(subscription),
    invoices,
    assignment: null,
    olderEpochCycles: await loadOlderEpochCycles(sql, subscription),
  });
  const current = evaluation.cycle.currentCycle;
  return {
    // B1c-2: a subscription reissues its CURRENT cycle (or a new first invoice while waiting for the first payment).
    currentPeriod: current ? periodOfDay(current.start) : currentPeriod,
    currentCycle: current,
    nextCycle: evaluation.cycle.nextCycle,
    nextDraftDay: evaluation.cycle.nextDraftDay,
    anchor: evaluation.cycle.anchor,
    accessEnd: evaluation.accessEnd,
    oldestUnpaid: evaluation.oldestUnpaid
      ? { invoiceId: evaluation.oldestUnpaid.id, dueOn: evaluation.oldestUnpaid.dueOn }
      : null,
    firstInvoicePending: evaluation.firstInvoicePending,
    waivedPeriods: evaluation.waivedCycles,
    currentPeriodWaived: current !== null && evaluation.waivedCycles.includes(current.start),
    needsReissue: evaluation.needsReissue,
    nothingPaid,
    blockedByOlderEpoch: evaluation.blockedByOlderEpoch,
    graceDays,
  };
}

export interface ReconcileSummary {
  applied: boolean;
  skippedReason?: 'sandboxed' | 'project_only' | 'not_found' | 'ended';
  statusBefore?: BrandSubscriptionStatus;
  statusAfter?: BrandSubscriptionStatus;
  draftedPeriods: string[];
  issuedPeriods: string[];
  issuedInvoiceIds: string[];
  voidedInvoiceIds: string[];
  /** Null-epoch issued or paid invoices adopted into the current epoch (round 4, A4). */
  adoptedInvoiceIds: string[];
  /** Periods an older epoch occupies (never drafted). */
  blockedByOlderEpoch: string[];
  /** Short codes of actions that failed and were rolled back to their savepoint. */
  failures: string[];
  /** `reconcile_failures` after this run (0 on a clean run). */
  reconcileFailures: number;
  planChanged: boolean;
  ended: boolean;
}

/**
 * The organization lock every subscription path takes first (review round 2, item 2).
 *
 * `FOR NO KEY UPDATE`, not `FOR UPDATE`: `markPaid`/`void`/`issue`/`updateDraft` lock one invoice row and
 * then insert a `brand_invoice_events` row whose foreign key takes `FOR KEY SHARE` on the organization. A
 * subscription path holding `FOR UPDATE` on the organization while waiting for that invoice row would form a
 * cycle and PostgreSQL would abort one side (possibly the payment). `FOR NO KEY UPDATE` is compatible with
 * `FOR KEY SHARE` and still exclusive against itself and against the `FOR UPDATE` older code takes, so
 * subscription paths still serialize per organization. Pre-existing `origin/main` statements keep their mode.
 */
export async function lockOrganizationForSubscription(
  sql: SqlRunner,
  organizationId: string,
): Promise<{ id: string; name: string } | null> {
  const row = (
    await sql.query<{ id: string; name: string }>(
      'select id::text as id, name from brand_organizations where id = $1 for no key update',
      [organizationId],
    )
  ).rows[0];
  return row ? { id: String(row.id), name: String(row.name) } : null;
}

const SYSTEM_ACTOR: InvoiceActor = { kind: 'system' };
const RECONCILE_ERROR_MAX = 120;

/** A short, id-free code for a failed reconcile step (stored in `last_reconcile_error`). */
export function reconcileErrorCode(error: unknown): string {
  let code = 'error';
  if (error instanceof BrandBillingDenied) code = error.detail ? `${error.code}:${error.detail}` : error.code;
  else if (typeof (error as { code?: unknown } | null)?.code === 'string') code = `db:${(error as { code: string }).code}`;
  return code.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '').slice(0, RECONCILE_ERROR_MAX);
}

/**
 * Round 3, item 2: count a failed reconcile (also used after a reconcile that threw, in a fresh statement
 * outside the rolled-back transaction). Returns the new `reconcile_failures`.
 */
export async function recordReconcileFailure(sql: SqlRunner, organizationId: string, code: string): Promise<number> {
  const row = (
    await sql.query<{ reconcile_failures: number }>(
      `update brand_subscriptions
          set reconcile_failures = reconcile_failures + 1,
              last_reconcile_error = $2
        where organization_id = $1
        returning reconcile_failures`,
      [organizationId, code.slice(0, RECONCILE_ERROR_MAX)],
    )
  ).rows[0];
  return row ? Number(row.reconcile_failures) : 0;
}

/**
 * Review round 4: the job owns the epoch's drafts, so when a downgrade is scheduled or cleared its drafts of
 * FUTURE periods are refreshed (as the system, full month) to the plan that will be in force for that period.
 * Otherwise an admin hand-issuing such a draft could bill a plan the subscription will never have.
 */
async function refreshFutureSubscriptionDrafts(sql: SqlRunner, sub: BrandSubscription, now: Date): Promise<void> {
  if (!isPaidPlanId(sub.planId)) return;
  const currentPlan: PaidBrandPlanId = sub.planId;
  const today = kstDayOf(now);
  const rows = await loadInvoicesForEngine(sql, sub.organizationId, sub.epoch);
  const effectiveFrom = sub.pendingPlanEffectivePeriod ?? addMonthsToPeriod(periodOfDay(sub.startedOn), 1);
  for (const row of rows) {
    // B1c-2: the job's drafts of FUTURE cycles follow the plan in force for their cycle.
    const start = row.cycle_start ? String(row.cycle_start).slice(0, 10) : null;
    if (row.kind !== 'subscription' || row.status !== 'draft' || !start || start <= today) continue;
    const planFor: PaidBrandPlanId =
      sub.pendingPlanId !== null && isPaidPlanId(sub.pendingPlanId) && periodOfDay(start) >= effectiveFrom
        ? sub.pendingPlanId
        : currentPlan;
    const input = await computeCurrentDraftRefreshInput(sql, row, planFor, null);
    if (!input) continue;
    const refreshed = await updateDraftBrandInvoiceInTx(sql, SYSTEM_ACTOR, input, now, {
      kind: 'subscription',
      coversMonths: 1,
      collectionMethod: sub.collectionMethod,
      subscriptionEpoch: sub.epoch,
    });
    if (!refreshed.ok) throw new BrandBillingDenied(refreshed.code, refreshed.detail ?? 'refresh_draft_failed');
  }
}

/** B1c-2: the latest subscription invoice of the cycle starting on `start` — the one a reissue replaces. */
function latestSubscriptionInvoiceOfCycle(rows: readonly ExtendedInvoiceRow[], start: string): ExtendedInvoiceRow | null {
  const list = rows
    .filter((r) => r.kind === 'subscription' && r.cycle_start && String(r.cycle_start).slice(0, 10) === start)
    .sort((a, b) => String(stamp(a.created_at) ?? '').localeCompare(String(stamp(b.created_at) ?? '')) || String(a.id).localeCompare(String(b.id)));
  return list.at(-1) ?? null;
}

/** B1a-2: the latest subscription invoice of `period` (by creation) — the one a reissue replaces. */
function latestSubscriptionInvoiceOfPeriod(rows: readonly ExtendedInvoiceRow[], period: string): ExtendedInvoiceRow | null {
  const list = rows
    .filter((r) => r.kind === 'subscription' && String(r.period) === period)
    .sort((a, b) => String(stamp(a.created_at) ?? '').localeCompare(String(stamp(b.created_at) ?? '')) || String(a.id).localeCompare(String(b.id)));
  return list.at(-1) ?? null;
}

/** The first day of `period` that gives `days` billed days (null = the full month). */
function startDayForDayCount(days: number | null, period: string): string | null {
  if (days == null) return null;
  const total = daysInYearMonth(period);
  const start = total - Number(days) + 1;
  if (start <= 1) return null;
  return `${period}-${String(start).padStart(2, '0')}`;
}

const MAX_BILLING_PASSES = 4;
const MAX_RECONCILE_EVALUATIONS = 24;

type BillingAction = Extract<SubscriptionAction, { type: 'void' | 'setInvoiceCycle' | 'applyPendingPlan' | 'draft' | 'issue' }>;

function isBillingAction(action: SubscriptionAction): action is BillingAction {
  return (
    action.type === 'void' ||
    action.type === 'setInvoiceCycle' ||
    action.type === 'applyPendingPlan' ||
    action.type === 'draft' ||
    action.type === 'issue'
  );
}

function suppressBillingAction(
  action: SubscriptionAction,
  evaluation: { cycle: { nextCycle: Cycle | null } },
  suppressBilling: Set<string>,
  suppressVoid: Set<string>,
): void {
  if (action.type === 'void' || action.type === 'setInvoiceCycle') suppressVoid.add(action.invoiceId);
  else if (action.type === 'applyPendingPlan') suppressBilling.add(evaluation.cycle.nextCycle?.start ?? '');
  else if (action.type === 'draft' || action.type === 'issue') suppressBilling.add(action.cycleStart);
}

/** Run `fn` inside a savepoint: a failure rolls back only `fn`'s statements and is returned, not thrown. */
async function withSavepoint<T>(
  sql: SqlRunner,
  name: string,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  await sql.query(`savepoint ${name}`);
  try {
    const value = await fn();
    await sql.query(`release savepoint ${name}`);
    return { ok: true, value };
  } catch (error) {
    await sql.query(`rollback to savepoint ${name}`);
    await sql.query(`release savepoint ${name}`);
    return { ok: false, error };
  }
}

/**
 * Review round 4, A4: null-epoch subscription invoices from the epoch's start period onward (left behind while
 * the flag was off). A DRAFT was never sent: the system voids it (`null_epoch_draft`) and the job drafts its
 * own. An ISSUED or PAID one is adopted into the current epoch (system `adopted` event); a missing `due_on` is
 * written from its KST issue day by the usual rule (the first-invoice rule while nothing is paid in the epoch
 * and there is no early access). Each row runs in its own savepoint; failures are returned.
 */
async function settleNullEpochInvoices(
  sql: SqlRunner,
  sub: BrandSubscription,
  now: Date,
): Promise<{ adopted: string[]; voided: string[]; failures: string[] }> {
  const nowIso = now.toISOString();
  const out = { adopted: [] as string[], voided: [] as string[], held: [] as string[], failures: [] as string[] };
  const { rows } = await sql.query<{
    id: string;
    status: BrandInvoiceStatus;
    period: string;
    issued_at: unknown;
    due_on: string | null;
    cycle_start: string | null;
    cycle_end: string | null;
  }>(
    `select id::text as id, status, period, issued_at, due_on::text as due_on,
            cycle_start::text as cycle_start, cycle_end::text as cycle_end
       from brand_invoices
      where organization_id = $1
        and subscription_epoch is null
        and kind = 'subscription'
        and status <> 'void'
        and period >= $2
      order by (status = 'paid') desc, period asc, created_at asc
      for update`,
    [sub.organizationId, periodOfDay(sub.startedOn)],
  );
  if (rows.length === 0) return out;
  let epochPaid = Boolean(
    (
      await sql.query(
        `select 1 from brand_invoices
          where organization_id = $1 and subscription_epoch = $2 and status = 'paid' and kind in ('subscription', 'prepay')
          limit 1`,
        [sub.organizationId, sub.epoch],
      )
    ).rows[0],
  );
  let step = 0;
  for (const row of rows) {
    step += 1;
    const id = String(row.id);
    const res = await withSavepoint(sql, `subscription_null_epoch_${step}`, async () => {
      if (row.status === 'draft') {
        const voided = await voidBrandInvoiceInTx(sql, SYSTEM_ACTOR, { invoiceId: id, reason: 'null_epoch_draft' }, now, {
          recordActorKind: true,
        });
        if (!voided.ok) throw new BrandBillingDenied(voided.code, voided.detail ?? 'void_failed');
        return 'voided' as const;
      }
      const issueDay = stampKstDay(row.issued_at) ?? kstDayOf(now);
      // B1c-2, rule 11: an adopted invoice keeps its cycle; without one it gets the cycle of the anchor that starts
      // in its month, and is held (left unadopted, counted) when there is no anchor or that cycle is taken.
      let cycle: Cycle | null = row.cycle_start && row.cycle_end ? { start: String(row.cycle_start).slice(0, 10), end: String(row.cycle_end).slice(0, 10) } : null;
      if (!cycle) {
        const anchor = (await loadPlanAssignment(sql, sub.organizationId))?.startedOn ?? null;
        const index = anchor
          ? (Number(String(row.period).slice(0, 4)) - Number(anchor.slice(0, 4))) * 12 + (Number(String(row.period).slice(5, 7)) - Number(anchor.slice(5, 7)))
          : -1;
        if (!anchor || index < 0) return 'held' as const;
        cycle = { start: cycleStartAt(anchor, index), end: cycleStartAt(anchor, index + 1) };
        const taken = (
          await sql.query(
            `select 1 from brand_invoices
              where organization_id = $1 and subscription_epoch = $2 and kind = 'subscription' and status <> 'void'
                and cycle_start < $4::date and cycle_end > $3::date
              limit 1`,
            [sub.organizationId, sub.epoch, cycle.start, cycle.end],
          )
        ).rows[0];
        if (taken) return 'held' as const;
      }
      void epochPaid;
      const dueOn = row.due_on ?? dueOnForInvoice({ issueDay, cycleStart: cycle.start, method: sub.collectionMethod });
      const updated = (
        await sql.query(
          `update brand_invoices
              set subscription_epoch = $2,
                  due_on = coalesce(due_on, $3::date),
                  cycle_start = coalesce(cycle_start, $4::date),
                  cycle_end = coalesce(cycle_end, $5::date)
            where id = $1 and subscription_epoch is null
            returning id`,
          [id, sub.epoch, dueOn, cycle.start, cycle.end],
        )
      ).rows[0];
      if (!updated) return null;
      await appendInvoiceEvent(sql, {
        invoiceId: id,
        organizationId: sub.organizationId,
        action: 'adopted',
        fromStatus: row.status,
        toStatus: row.status,
        snapshot: { period: row.period, subscriptionEpoch: sub.epoch, dueOn },
        note: 'adopted into the current subscription epoch',
        actorId: null,
        actorKind: 'system',
        createdAt: nowIso,
      });
      if (row.status === 'paid') epochPaid = true;
      return 'adopted' as const;
    });
    if (!res.ok) out.failures.push(`adopt:${reconcileErrorCode(res.error)}`.slice(0, RECONCILE_ERROR_MAX));
    else if (res.value === 'voided') out.voided.push(id);
    else if (res.value === 'held') out.held.push(id);
    else if (res.value === 'adopted') out.adopted.push(id);
  }
  return out;
}

/**
 * Review round 5, B3: an issued subscription invoice of the epoch without `due_on` gets one, once, from its KST
 * issue day — `max(issue day, 1st of its period) + 14`, or the first-invoice rule while nothing is paid in the
 * epoch and there is no early access — with a system event. (The legacy 14-day fallback stays only for
 * organizations without a subscription.)
 */
async function normaliseNullDueDates(sql: SqlRunner, sub: BrandSubscription, now: Date): Promise<string[]> {
  const { rows } = await sql.query<{ id: string; period: string; issued_at: unknown; cycle_start: string | null }>(
    `select id::text as id, period, issued_at, cycle_start::text as cycle_start
       from brand_invoices
      where organization_id = $1 and subscription_epoch = $2 and kind = 'subscription'
        and status = 'issued' and due_on is null
      order by period
      for update`,
    [sub.organizationId, sub.epoch],
  );
  if (rows.length === 0) return [];
  const epochPaid = Boolean(
    (
      await sql.query(
        `select 1 from brand_invoices
          where organization_id = $1 and subscription_epoch = $2 and status = 'paid' and kind in ('subscription', 'prepay')
          limit 1`,
        [sub.organizationId, sub.epoch],
      )
    ).rows[0],
  );
  const failures: string[] = [];
  let step = 0;
  for (const row of rows) {
    step += 1;
    const res = await withSavepoint(sql, `subscription_due_${step}`, async () => {
      void epochPaid;
      const dueOn = dueOnForInvoice({
        issueDay: stampKstDay(row.issued_at) ?? kstDayOf(now),
        cycleStart: row.cycle_start ? String(row.cycle_start).slice(0, 10) : null,
        method: sub.collectionMethod,
      });
      const updated = (
        await sql.query('update brand_invoices set due_on = $2::date where id = $1 and due_on is null returning id', [row.id, dueOn])
      ).rows[0];
      if (!updated) return;
      await appendInvoiceEvent(sql, {
        invoiceId: String(row.id),
        organizationId: sub.organizationId,
        action: 'edited',
        fromStatus: 'issued',
        toStatus: 'issued',
        snapshot: { period: row.period, dueOn },
        note: 'due date normalised',
        actorId: null,
        actorKind: 'system',
        createdAt: now.toISOString(),
      });
    });
    if (!res.ok) failures.push(`due:${reconcileErrorCode(res.error)}`.slice(0, RECONCILE_ERROR_MAX));
  }
  return failures;
}

function stampKstDay(value: unknown): string | null {
  const iso = stamp(value);
  return iso ? kstDayOf(new Date(iso)) : null;
}

/** Cycles an OLDER epoch's non-void invoice occupies from this epoch's start on (never adopted; held). */
async function loadOlderEpochCycles(sql: SqlRunner, sub: BrandSubscription): Promise<Cycle[]> {
  const { rows } = await sql.query<{ cycle_start: string; cycle_end: string }>(
    `select distinct cycle_start::text as cycle_start, cycle_end::text as cycle_end
       from brand_invoices
      where organization_id = $1
        and subscription_epoch is not null
        and subscription_epoch <> $2
        and kind = 'subscription'
        and status <> 'void'
        and cycle_start is not null
        and cycle_end > $3::date
      order by cycle_start`,
    [sub.organizationId, sub.epoch, sub.startedOn],
  );
  return rows.map((r) => ({ start: String(r.cycle_start).slice(0, 10), end: String(r.cycle_end).slice(0, 10) }));
}

/**
 * Reconcile one organization's subscription inside an open DB transaction.
 * Lock order (the same in every subscription path): `brand_organizations` (no key update) ->
 * `brand_subscriptions` -> this epoch's `brand_invoices` -> `brand_discounts` -> `brand_plan_assignments` ->
 * `brand_studio_allowances`. An ended subscription reads nothing after its own row and applies nothing (A2).
 * Everything the engine decides is written as the system (drafts it creates are the only ones it may refresh
 * and issue later); the caller is recorded on the subscription events.
 *
 * Round 3, item 2: each billing step (void, plan change, draft, issue) runs in its own savepoint. A failed
 * step is rolled back and recorded, its period is not retried in this run, and the engine runs again from the
 * facts so status and access end are still written. Failures are counted on the row (`reconcile_failures`,
 * `last_reconcile_error`) and reset by a clean run. Idempotent.
 */
export async function reconcileSubscriptionInTx(
  sql: SqlRunner,
  params: {
    organizationId: string;
    actor: InvoiceActor;
    now: Date;
    graceDays?: number;
  },
): Promise<ReconcileSummary> {
  const { organizationId, actor, now } = params;
  const graceDays = params.graceDays ?? planGraceDaysFromEnv();
  const todayKst = kstDayOf(now);
  const nowIso = now.toISOString();
  const summary: ReconcileSummary = {
    applied: false,
    draftedPeriods: [],
    issuedPeriods: [],
    issuedInvoiceIds: [],
    voidedInvoiceIds: [],
    adoptedInvoiceIds: [],
    blockedByOlderEpoch: [],
    failures: [],
    reconcileFailures: 0,
    planChanged: false,
    ended: false,
  };

  const org = await lockOrganizationForSubscription(sql, organizationId);
  if (!org) return { ...summary, skippedReason: 'not_found' };
  if (isSandboxedClientOrganization(org)) return { ...summary, skippedReason: 'sandboxed' };

  const subRow = (
    await sql.query<SubscriptionRow>(
      `select ${SUBSCRIPTION_SELECT_COLS}
         from brand_subscriptions
        where organization_id = $1
        for update`,
      [organizationId],
    )
  ).rows[0];
  if (!subRow) return { ...summary, skippedReason: 'not_found' };

  let sub = mapSubscription(subRow);
  const statusBefore = sub.status;
  // A2: Ended subscriptions read nothing further (no plan assignment or invoice reads) and apply nothing.
  if (sub.status === 'ended') return { ...summary, skippedReason: 'ended', statusBefore, statusAfter: sub.status };
  if (!isPaidPlanId(sub.planId)) return { ...summary, skippedReason: 'project_only', statusBefore, statusAfter: sub.status };
  summary.applied = true;
  summary.statusBefore = statusBefore;
  summary.reconcileFailures = sub.reconcileFailures;

  const settled = await settleNullEpochInvoices(sql, sub, now);
  summary.adoptedInvoiceIds = settled.adopted;
  summary.voidedInvoiceIds.push(...settled.voided);
  summary.failures.push(...settled.failures);
  summary.failures.push(...(await normaliseNullDueDates(sql, sub, now)));
  const olderEpochCycles = await loadOlderEpochCycles(sql, sub);
  const suppressBilling = new Set<string>();
  const suppressVoid = new Set<string>();
  let stepNo = 0;

  // Review round 4, B7: billing steps get MAX_BILLING_PASSES tries; after that (or once nothing billing is
  // left) a facts-only pass suppresses every remaining billing action, so status and `ends_on` are ALWAYS
  // written from the facts however many steps failed.
  for (let pass = 0; pass < MAX_RECONCILE_EVALUATIONS; pass += 1) {
    const assignment = await loadPlanAssignment(sql, organizationId);
    const invoiceRows = await loadInvoicesForEngine(sql, organizationId, sub.epoch);
    const evaluation = evaluateSubscription({
      todayKst,
      graceDays,
      subscription: toEngineSubscription(sub),
      invoices: mapEngineInvoices(invoiceRows),
      assignment,
      sandboxed: false,
      olderEpochCycles,
      suppressBillingFor: [...suppressBilling],
      suppressVoidOf: [...suppressVoid],
    });
    summary.blockedByOlderEpoch = [...evaluation.blockedByOlderEpoch];
    if (pass >= MAX_BILLING_PASSES) {
      const leftover = evaluation.actions.filter(isBillingAction);
      if (leftover.length > 0) {
        for (const action of leftover) suppressBillingAction(action, evaluation, suppressBilling, suppressVoid);
        continue;
      }
    }

    // B1c-2: drafts are keyed by their cycle start.
    const draftsByPeriod = new Map<string, ExtendedInvoiceRow>();
    for (const r of invoiceRows) {
      if (r.kind === 'subscription' && r.status === 'draft' && r.cycle_start) draftsByPeriod.set(String(r.cycle_start).slice(0, 10), r);
    }

    let failedThisPass = false;
    for (const action of evaluation.actions) {
      if (isBillingAction(action)) {
        stepNo += 1;
        const result = await withSavepoint(sql, `subscription_step_${stepNo}`, async () => {
          if (action.type === 'setInvoiceCycle') {
            // Rule 4: the first payment starts cycle 0 on its paid day.
            const set = (
              await sql.query(
                `update brand_invoices
                    set cycle_start = $2::date, cycle_end = $3::date, period = $4
                  where id = $1 and cycle_start is null and status = 'paid'
                  returning id`,
                [action.invoiceId, action.cycleStart, action.cycleEnd, periodOfDay(action.cycleStart)],
              )
            ).rows[0];
            if (!set) throw new BrandBillingDenied('conflict', 'cycle_already_set');
            await appendInvoiceEvent(sql, {
              invoiceId: action.invoiceId,
              organizationId,
              action: 'edited',
              fromStatus: 'paid',
              toStatus: 'paid',
              snapshot: { cycleStart: action.cycleStart, cycleEnd: action.cycleEnd },
              note: 'first payment starts the billing cycle',
              actorId: null,
              actorKind: 'system',
              createdAt: nowIso,
            });
          } else if (action.type === 'void') {
            const voided = await voidBrandInvoiceInTx(sql, SYSTEM_ACTOR, { invoiceId: action.invoiceId, reason: action.reason }, now, {
              recordActorKind: true,
            });
            if (!voided.ok) throw new BrandBillingDenied(voided.code, voided.detail ?? 'void_failed');
          } else if (action.type === 'applyPendingPlan') {
            const updated = (
              await sql.query<SubscriptionRow>(
                `update brand_subscriptions
                    set plan_id = $2,
                        pending_plan_id = null,
                        pending_plan_effective_period = null,
                        revision = $3,
                        updated_at = $4::timestamptz
                  where organization_id = $1 and revision = $5
                  returning ${SUBSCRIPTION_SELECT_COLS}`,
                [organizationId, action.toPlanId, sub.revision + 1, nowIso, sub.revision],
              )
            ).rows[0];
            if (!updated) throw new BrandBillingDenied('conflict', 'subscription_revision_conflict');
            sub = mapSubscription(updated);
            await appendSubscriptionEvent(sql, {
              organizationId,
              action: 'plan_changed',
              actor,
              snapshot: { ...subscriptionSnapshot(sub), fromPlanId: action.fromPlanId, toPlanId: action.toPlanId },
              createdAt: nowIso,
            });
          } else if (action.type === 'draft') {
            const drafted = await draftBrandInvoiceInTx(
              sql,
              SYSTEM_ACTOR,
              {
                organizationId,
                period: action.period,
                planId: action.planId,
                prorate: false,
                applyActiveDiscount: true,
                manualAmounts: false,
                manualReason: '',
                memo: '',
              },
              now,
              {
                kind: 'subscription',
                coversMonths: 1,
                dueOn: null,
                collectionMethod: sub.collectionMethod,
                subscriptionEpoch: sub.epoch,
                cycleStart: action.cycleStart,
                cycleEnd: action.cycleEnd,
              },
            );
            if (!drafted.ok) throw new BrandBillingDenied(drafted.code, `draft_failed${drafted.detail ? `:${drafted.detail}` : ''}`);
            draftsByPeriod.set(action.cycleStart, {
              id: drafted.invoice.id,
              organization_id: organizationId,
              period: drafted.invoice.period,
              plan_id: drafted.invoice.planId,
              base_list_krw: drafted.invoice.baseListKrw,
              prorated_days: drafted.invoice.proratedDays,
              period_days: drafted.invoice.periodDays,
              discount_id: drafted.invoice.discountId,
              discount_percent: drafted.invoice.discountPercent,
              manual_amounts: drafted.invoice.manualAmounts,
              status: 'draft',
              issued_at: null,
              paid_at: null,
              voided_at: null,
              voided_by: null,
              void_actor_kind: null,
              void_reason: '',
              created_at: nowIso,
              kind: 'subscription',
              covers_months: 1,
              due_on: null,
              collection_method: sub.collectionMethod,
              tax_invoice_issued_on: null,
              tax_invoice_ref: null,
              created_via: 'system',
              issued_via: null,
              subscription_epoch: sub.epoch,
              memo: drafted.invoice.memo,
            });
          } else {
            const draftRow = draftsByPeriod.get(action.cycleStart);
            if (!draftRow) throw new BrandBillingDenied('conflict', 'missing_draft_for_issue');
            // Round 4, A: the job owns every subscription draft of the epoch and refreshes it to its rule.
            // B1c-2: always the full monthly price of the plan in force (no proration anywhere).
            const refreshInput = await computeCurrentDraftRefreshInput(sql, draftRow, sub.planId, null);
            if (refreshInput) {
              const refreshed = await updateDraftBrandInvoiceInTx(sql, SYSTEM_ACTOR, refreshInput, now, {
                kind: 'subscription',
                coversMonths: 1,
                collectionMethod: sub.collectionMethod,
                subscriptionEpoch: sub.epoch,
              });
              if (!refreshed.ok) throw new BrandBillingDenied(refreshed.code, refreshed.detail ?? 'refresh_draft_failed');
            }
            const issued = await issueBrandInvoiceInTx(sql, SYSTEM_ACTOR, { invoiceId: draftRow.id }, now, {
              dueOn: action.dueOn,
              collectionMethod: sub.collectionMethod,
            });
            if (!issued.ok) throw new BrandBillingDenied(issued.code, `issue_failed${issued.detail ? `:${issued.detail}` : ''}`);
            return issued.invoice.id;
          }
          return null;
        });
        if (!result.ok) {
          // The plan change above may have been rolled back: reload the row before going on.
          const fresh = (
            await sql.query<SubscriptionRow>(`select ${SUBSCRIPTION_SELECT_COLS} from brand_subscriptions where organization_id = $1`, [
              organizationId,
            ])
          ).rows[0];
          if (fresh) sub = mapSubscription(fresh);
          summary.failures.push(`${action.type}:${reconcileErrorCode(result.error)}`.slice(0, RECONCILE_ERROR_MAX));
          suppressBillingAction(action, evaluation, suppressBilling, suppressVoid);
          failedThisPass = true;
          break;
        }
        if (action.type === 'void') {
          summary.voidedInvoiceIds.push(action.invoiceId);
          if (action.cycleStart && draftsByPeriod.get(action.cycleStart)?.id === action.invoiceId) draftsByPeriod.delete(action.cycleStart);
        } else if (action.type === 'setInvoiceCycle') {
          // nothing to count: the first payment's cycle is written
        } else if (action.type === 'applyPendingPlan') {
          summary.planChanged = true;
        } else if (action.type === 'draft') {
          summary.draftedPeriods.push(action.period);
        } else {
          summary.issuedPeriods.push(action.period);
          summary.issuedInvoiceIds.push(String(result.value));
        }
      } else {
        // Round 5, B2: plan sync, plan clear, status write and end each run in their own savepoint — a failure
        // never undoes the other steps (or the adoption / void work above). A failure that leaves a customer
        // without access the facts give them is marked `access:` and reported at once.
        stepNo += 1;
        const accessAffecting =
          action.type === 'syncAssignment' ||
          (action.type === 'setStatus' && (action.to === 'active' || action.to === 'past_due' || action.to === 'pending'));
        const result = await withSavepoint(sql, `subscription_step_${stepNo}`, async () => {
          if (action.type === 'syncAssignment') {
            const syncRes = await upsertPlanAssignmentInTx(sql, {
              organizationId,
              planId: action.planId,
              billingMode: action.billingMode,
              startedOn: action.startedOn,
              endsOn: action.endsOn,
              seats: assignment?.seats ?? null,
              note: assignment?.note ?? '',
              actor: { kind: 'system' },
              recordActorKind: true,
              organizationLock: 'no key update',
              now,
              graceDays,
            });
            if (!syncRes.ok) {
              const mappedCode = syncRes.code === 'conflict' ? 'conflict' : syncRes.code === 'not_found' ? 'not_found' : 'invalid';
              throw new BrandBillingDenied(mappedCode, `sync_plan_failed:${syncRes.code}`);
            }
          } else if (action.type === 'clearAssignment') {
            await clearPlanAssignmentInTx(sql, {
              organizationId,
              note: 'subscription_ended',
              actor: { kind: 'system' },
              recordActorKind: true,
              now,
              graceDays,
            });
          } else if (action.type === 'setStatus') {
            const updated = (
              await sql.query<SubscriptionRow>(
                `update brand_subscriptions
                    set status = $2,
                        revision = $3,
                        updated_at = $4::timestamptz
                  where organization_id = $1 and revision = $5
                  returning ${SUBSCRIPTION_SELECT_COLS}`,
                [organizationId, action.to, sub.revision + 1, nowIso, sub.revision],
              )
            ).rows[0];
            if (!updated) throw new BrandBillingDenied('conflict', 'subscription_revision_conflict');
            await appendSubscriptionEvent(sql, {
              organizationId,
              action: 'status_changed',
              actor,
              snapshot: { ...subscriptionSnapshot(mapSubscription(updated)), fromStatus: action.from, toStatus: action.to },
              createdAt: nowIso,
            });
            return mapSubscription(updated);
          } else if (action.type === 'end') {
            const updated = (
              await sql.query<SubscriptionRow>(
                `update brand_subscriptions
                    set status = 'ended',
                        ended_at = $2::timestamptz,
                        pending_plan_id = null,
                        pending_plan_effective_period = null,
                        revision = $3,
                        updated_at = $2::timestamptz
                  where organization_id = $1 and revision = $4
                  returning ${SUBSCRIPTION_SELECT_COLS}`,
                [organizationId, nowIso, sub.revision + 1, sub.revision],
              )
            ).rows[0];
            if (!updated) throw new BrandBillingDenied('conflict', 'subscription_revision_conflict');
            await appendSubscriptionEvent(sql, {
              organizationId,
              action: 'ended',
              actor,
              snapshot: { ...subscriptionSnapshot(mapSubscription(updated)), reason: action.reason },
              createdAt: nowIso,
            });
            return mapSubscription(updated);
          }
          return null;
        });
        if (!result.ok) {
          const code = `${action.type}:${reconcileErrorCode(result.error)}`;
          summary.failures.push((accessAffecting ? `access:${code}` : code).slice(0, RECONCILE_ERROR_MAX));
        } else if (result.value) {
          sub = result.value;
          if (action.type === 'end') summary.ended = true;
        }
      }
    }
    if (!failedThisPass) break;
  }

  // Failure tracking: count a run with a failed step, reset after a clean one. A failure that cost the customer
  // access the facts give them (`access:`) is reported at once (round 5, B2); others from the 3rd failure on.
  if (summary.failures.length > 0) {
    const accessFailure = summary.failures.find((f) => f.startsWith('access:'));
    summary.reconcileFailures = await recordReconcileFailure(sql, organizationId, accessFailure ?? summary.failures[0]!);
    if (accessFailure) {
      await withSavepoint(sql, 'subscription_failure_notice', () => enqueueReconcileFailureNotice(sql, todayKst));
    }
  } else if (sub.reconcileFailures > 0) {
    await sql.query(
      'update brand_subscriptions set reconcile_failures = 0, last_reconcile_error = null where organization_id = $1',
      [organizationId],
    );
    summary.reconcileFailures = 0;
  }

  summary.statusAfter = sub.status;
  return summary;
}

/**
 * Reconcile a subscription inside the given transaction if schema 0182 is ready and a non-ended subscription exists.
 */
export async function reconcileSubscriptionInTxIfExists(
  sql: SqlRunner,
  params: { organizationId: string; actor: InvoiceActor; now: Date; graceDays?: number },
): Promise<ReconcileSummary | null> {
  if (!(await loadSubscriptionSchemaReady(sql))) return null;
  return reconcileSubscriptionInTx(sql, params);
}

// B1: Runs AFTER `markPaid`/`void` commits in its own transaction (org lock first, same order as cron job).
registerSubscriptionReconcileHook(async (rootSql, params) => {
  try {
    const summary = await rootSql.transaction((txSql) => reconcileSubscriptionInTxIfExists(txSql, params));
    // B1a-2, item 3: report a failed step (the steps that worked are committed) so the admin sees it.
    const failures = summary?.failures ?? [];
    return { failed: failures.length > 0, accessAffected: failures.some((f) => f.startsWith('access:')) };
  } catch (error) {
    // Round 3, item 2: a reconcile that threw is counted on the row (fresh statement, outside the rolled-back
    // transaction); the caller logs it and the hourly job retries.
    await recordReconcileFailure(rootSql, params.organizationId, reconcileErrorCode(error)).catch(() => 0);
    throw error;
  }
});

export async function reconcileSubscription(
  deps: { sql: SqlRunner; now?: () => Date; env?: Record<string, string | undefined>; graceDays?: number },
  organizationId: string,
  actor: InvoiceActor = { kind: 'system' },
): Promise<BrandSubscriptionOutcome<{ summary: ReconcileSummary; subscription: BrandSubscription | null }>> {
  if (!brandBillingAutoIssueOpen(deps.env)) {
    return { ok: false, code: 'disabled' };
  }
  if (!UUID.safeParse(organizationId).success) {
    return { ok: false, code: 'invalid', field: 'organizationId' };
  }
  const nowDate = deps.now?.() ?? new Date();
  const graceDays = deps.graceDays ?? planGraceDaysFromEnv(deps.env);
  try {
    return await deps.sql.transaction(async (sql) => {
      if (!(await loadSubscriptionSchemaReady(sql))) {
        return { ok: false as const, code: 'unavailable' as const };
      }
      const summary = await reconcileSubscriptionInTx(sql, {
        organizationId,
        actor,
        now: nowDate,
        graceDays,
      });
      if (!summary.applied && summary.skippedReason === 'not_found') {
        return { ok: false as const, code: 'not_found' as const };
      }
      const sub = await loadBrandSubscription(sql, organizationId);
      return { ok: true as const, summary, subscription: sub };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

/* ------------------------------------------------------------------ admin subscription operations */

const StartSubscriptionInput = z.object({
  organizationId: UUID,
  planId: z.string().trim().min(1),
  collectionMethod: z.enum(['transfer', 'card']).default('transfer'),
  startedOn: CalendarDay.optional(),
  activateBeforePayment: z.boolean().default(false),
  confirm: z.boolean().default(false),
  /** Return the preview even without early access (the admin operation always previews first). */
  previewOnly: z.boolean().default(false),
  /** Digest from step 1; when present the start is refused (`preview_stale`) unless it still matches. */
  previewDigest: z.string().trim().regex(/^[0-9a-f]{16}$/).optional(),
});

export interface StartSubscriptionPreview {
  organizationId: string;
  planId: PaidBrandPlanId;
  startedOn: string;
  dueOn: string;
  proratedDays: number | null;
  periodDays: number | null;
  discountPercent: number;
  supplyKrw: number;
  vatKrw: number;
  totalKrw: number;
  activateBeforePayment: boolean;
  /** Item 9: digest of everything above; step 2 must send it back. */
  digest: string;
  /** Round 3, item 1: fewer than 3 days between the start and the first invoice's due date. */
  shortPaymentWindow: boolean;
}

/**
 * Review round 2, item 9: a consistency digest binding a two-step confirm to what the admin previewed. Not a
 * secret (the operations are admin-only); it only proves step 2 confirms the same organization, plan, dates
 * and amounts the server would issue now.
 */
export function previewDigest(values: Record<string, string | number | boolean | null>): string {
  const canonical = Object.keys(values)
    .sort()
    .map((key) => `${key}=${String(values[key])}`)
    .join('|');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/** The amounts `draftBrandInvoiceInTx` will write for a derived (non-manual) draft with the active discount. */
async function derivedInvoiceAmounts(
  sql: SqlRunner,
  organizationId: string,
  planId: PaidBrandPlanId,
  prorate: { usedDays: number; totalDays: number } | null,
) {
  const discountRow = (
    await sql.query<{ percent: number; invoices_total: number | null; invoices_used: number }>(
      "select percent, invoices_total, invoices_used from brand_discounts where organization_id = $1 and status = 'active' for share",
      [organizationId],
    )
  ).rows[0];
  const discountPct =
    discountRow && (discountRow.invoices_total === null || Number(discountRow.invoices_used) < Number(discountRow.invoices_total))
      ? Number(discountRow.percent)
      : 0;
  return invoiceAmounts({ listKrw: BRAND_PLANS[planId].monthlyKrw, discountPct, prorate });
}

async function lockOrgNotSandboxed(
  sql: SqlRunner,
  organizationId: string,
): Promise<{ ok: true; name: string } | { ok: false; code: BrandSubscriptionFailureCode; field?: string; detail?: string }> {
  const org = await lockOrganizationForSubscription(sql, organizationId);
  if (!org) return { ok: false, code: 'not_found' };
  if (isSandboxedClientOrganization(org)) {
    return { ok: false, code: 'invalid', field: 'organizationId', detail: 'sandboxed_org' };
  }
  return { ok: true, name: org.name };
}

export async function startSubscription(
  deps: { sql: SqlRunner; now?: () => Date; env?: Record<string, string | undefined>; graceDays?: number },
  viewer: Viewer,
  input: unknown,
): Promise<
  BrandSubscriptionOutcome<
    | { applied: false; preview: StartSubscriptionPreview }
    | { applied: true; subscription: BrandSubscription; firstInvoiceId: string }
  >
> {
  const parsed = StartSubscriptionInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  const nowDate = deps.now?.() ?? new Date();
  const todayKst = kstDayOf(nowDate);
  const currentMonth = kstMonthOf(nowDate);
  const startedOn = v.startedOn ?? todayKst;
  const nowIso = nowDate.toISOString();
  const graceDays = deps.graceDays ?? planGraceDaysFromEnv(deps.env);

  if (v.collectionMethod === 'card') {
    return { ok: false, code: 'not_available_yet', detail: 'card_not_available_yet' };
  }
  if (!(BRAND_PLAN_IDS as readonly string[]).includes(v.planId) || !isPaidPlanId(v.planId)) {
    return {
      ok: false,
      code: 'invalid',
      field: 'planId',
      detail: v.planId === 'project_only' ? 'project_only_not_subscribable' : 'invalid_plan',
    };
  }
  const paidPlanId: PaidBrandPlanId = v.planId;
  if (periodOfDay(startedOn) !== currentMonth) {
    return { ok: false, code: 'invalid', field: 'startedOn', detail: 'started_on_must_be_current_month' };
  }
  // A start in the future would issue the first invoice (due today + 14) before access could begin.
  if (startedOn > todayKst) {
    return { ok: false, code: 'invalid', field: 'startedOn', detail: 'started_on_in_future' };
  }

  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!brandBillingAutoIssueOpen(deps.env)) {
        return { ok: false as const, code: 'disabled' as const };
      }
      if (!(await loadSubscriptionSchemaReady(sql))) {
        return { ok: false as const, code: 'unavailable' as const };
      }

      const orgGate = await lockOrgNotSandboxed(sql, v.organizationId);
      if (!orgGate.ok) return orgGate;

      const existingSubRow = (
        await sql.query<SubscriptionRow>(
          `select ${SUBSCRIPTION_SELECT_COLS}
             from brand_subscriptions
            where organization_id = $1
            for update`,
          [v.organizationId],
        )
      ).rows[0];
      if (existingSubRow && existingSubRow.status !== 'ended') {
        return { ok: false as const, code: 'conflict' as const, detail: 'subscription_exists' };
      }

      // A1: Refuse if an active manual plan assignment exists (never silently delete it).
      const existingAssign = await loadPlanAssignment(sql, v.organizationId);
      if (existingAssign && planActiveWithGrace(existingAssign, todayKst, graceDays).active) {
        return { ok: false as const, code: 'conflict' as const, detail: 'manual_plan_active' };
      }

      const profile = await loadBrandBillingProfile(sql, v.organizationId);
      if (!hasCompleteTaxInvoiceProfile(profile)) {
        return { ok: false as const, code: 'invalid' as const, field: 'billingProfile', detail: 'billing_profile_required' };
      }

      // B1c-2, rules 4–5: the first invoice is the full price, due on the start day + 14. With early access cycle 0
      // starts on the start day; without, the invoice has NO cycle until its payment is confirmed (rule 4).
      const dueOn = dueOnForInvoice({ issueDay: startedOn, method: 'transfer' });
      const firstCycle = v.activateBeforePayment ? { start: startedOn, end: cycleStartAt(startedOn, 1) } : null;
      // A1: refuse when a non-void subscription invoice already exists for the start period — or for a later
      // period: the (organization, period) uniqueness is global, so the engine could never draft that month.
      const existingPeriodSubInv = (
        await sql.query<{ id: string }>(
          `select id::text as id
             from brand_invoices
            where organization_id = $1 and period >= $2 and status <> 'void' and kind = 'subscription'
            limit 1`,
          [v.organizationId, currentMonth],
        )
      ).rows[0];
      if (existingPeriodSubInv) {
        return { ok: false as const, code: 'conflict' as const, detail: 'period_already_invoiced' };
      }

      const amounts = await derivedInvoiceAmounts(sql, v.organizationId, paidPlanId, null);
      const previewValues = {
        organizationId: v.organizationId,
        planId: paidPlanId,
        startedOn,
        dueOn,
        cycleStart: firstCycle?.start ?? null,
        cycleEnd: firstCycle?.end ?? null,
        proratedDays: amounts.proratedDays,
        periodDays: amounts.periodDays,
        discountPercent: amounts.discountPct,
        supplyKrw: amounts.supplyKrw,
        vatKrw: amounts.vatKrw,
        totalKrw: amounts.totalKrw,
        activateBeforePayment: v.activateBeforePayment,
      };
      const digest = previewDigest(previewValues);
      // B1c-2: the due date is always the start day + 14 now, so the payment window is never short.
      const shortPaymentWindow = false;
      // Round 4, B8: exactly two modes — `previewOnly`, or `confirm` with the digest of the preview the admin saw.
      if (v.previewOnly) {
        return { ok: true as const, applied: false as const, preview: { ...previewValues, digest, shortPaymentWindow } };
      }
      if (!v.confirm || v.previewDigest === undefined) {
        return { ok: false as const, code: 'invalid' as const, field: 'previewDigest', detail: 'preview_required' };
      }
      if (v.previewDigest !== undefined && v.previewDigest !== digest) {
        return { ok: false as const, code: 'conflict' as const, detail: 'preview_stale' };
      }

      const nextEpoch = existingSubRow ? Number(existingSubRow.epoch) + 1 : 1;
      const nextRev = existingSubRow ? Number(existingSubRow.revision) + 1 : 1;
      const insertedSub = (
        await sql.query<SubscriptionRow>(
          `insert into brand_subscriptions (
             organization_id, status, plan_id, pending_plan_id, pending_plan_effective_period, collection_method,
             started_on, prepaid_through, cancel_at_period_end, canceled_at, ended_at,
             activated_before_payment, epoch, last_reconciled_at, revision, created_by, created_at, updated_at
           ) values ($1, 'pending', $2, null, null, 'transfer', $3::date, null, false, null, null, $4, $5, null, $6, $7, $8::timestamptz, $8::timestamptz)
           on conflict (organization_id) do update
             set status = 'pending',
                 plan_id = excluded.plan_id,
                 pending_plan_id = null,
                 pending_plan_effective_period = null,
                 collection_method = 'transfer',
                 started_on = excluded.started_on,
                 prepaid_through = null,
                 cancel_at_period_end = false,
                 canceled_at = null,
                 ended_at = null,
                 activated_before_payment = excluded.activated_before_payment,
                 epoch = excluded.epoch,
                 last_reconciled_at = null,
                 revision = excluded.revision,
                 updated_at = excluded.updated_at
           returning ${SUBSCRIPTION_SELECT_COLS}`,
          [v.organizationId, paidPlanId, startedOn, v.activateBeforePayment, nextEpoch, nextRev, adminId, nowIso],
        )
      ).rows[0]!;

      const actor: InvoiceActor = { kind: 'admin', userId: adminId };
      const drafted = await draftBrandInvoiceInTx(
        sql,
        actor,
        {
          organizationId: v.organizationId,
          period: currentMonth,
          planId: paidPlanId,
          prorate: false,
          applyActiveDiscount: true,
          manualAmounts: false,
          manualReason: '',
          memo: '',
        },
        nowDate,
        {
          kind: 'subscription',
          coversMonths: 1,
          dueOn: null,
          collectionMethod: 'transfer',
          subscriptionEpoch: nextEpoch,
          cycleStart: firstCycle?.start ?? null,
          cycleEnd: firstCycle?.end ?? null,
        },
      );
      if (!drafted.ok) throw new BrandBillingDenied(drafted.code, drafted.detail);
      const firstInvoiceId = drafted.invoice.id;

      const issued = await issueBrandInvoiceInTx(
        sql,
        actor,
        { invoiceId: firstInvoiceId },
        nowDate,
        {
          dueOn,
          collectionMethod: 'transfer',
        },
      );
      if (!issued.ok) throw new BrandBillingDenied(issued.code, issued.detail);

      const sub = mapSubscription(insertedSub);
      await appendSubscriptionEvent(sql, {
        organizationId: v.organizationId,
        action: 'started',
        actor,
        snapshot: { ...subscriptionSnapshot(sub), firstInvoiceId, dueOn },
        createdAt: nowIso,
      });

      if (v.activateBeforePayment) {
        const assignStartedOn = startedOn <= dueOn ? startedOn : dueOn;
        const assignRes = await upsertPlanAssignmentInTx(sql, {
          organizationId: v.organizationId,
          planId: paidPlanId,
          billingMode: 'invoice',
          startedOn: assignStartedOn,
          endsOn: dueOn,
          seats: existingAssign?.seats ?? null,
          note: existingAssign?.note ?? '',
          actor: { kind: 'admin', userId: adminId },
          recordActorKind: true,
          organizationLock: 'no key update',
          now: nowDate,
          graceDays,
        });
        if (!assignRes.ok) {
          const mappedCode = assignRes.code === 'conflict' ? 'conflict' : assignRes.code === 'not_found' ? 'not_found' : 'invalid';
          throw new BrandBillingDenied(mappedCode, `assign_plan_failed:${assignRes.code}`);
        }
      } else if (existingAssign) {
        await clearPlanAssignmentInTx(sql, {
          organizationId: v.organizationId,
          note: 'subscription_pending_payment',
          actor: { kind: 'admin', userId: adminId },
          recordActorKind: true,
          now: nowDate,
          graceDays,
        });
      }

      return { ok: true as const, applied: true as const, subscription: sub, firstInvoiceId };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

const OrgOnlyInput = z.object({ organizationId: UUID });

export async function cancelSubscription(
  deps: { sql: SqlRunner; now?: () => Date; env?: Record<string, string | undefined>; graceDays?: number },
  viewer: Viewer,
  input: unknown,
): Promise<BrandSubscriptionOutcome<{ subscription: BrandSubscription }>> {
  const parsed = OrgOnlyInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const { organizationId } = parsed.data;
  const nowDate = deps.now?.() ?? new Date();
  const nowIso = nowDate.toISOString();
  const currentPeriod = kstMonthOf(nowDate);
  const graceDays = deps.graceDays ?? planGraceDaysFromEnv(deps.env);

  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!brandBillingAutoIssueOpen(deps.env)) return { ok: false as const, code: 'disabled' as const };
      if (!(await loadSubscriptionSchemaReady(sql))) return { ok: false as const, code: 'unavailable' as const };

      const orgGate = await lockOrgNotSandboxed(sql, organizationId);
      if (!orgGate.ok) return orgGate;

      const row = (
        await sql.query<SubscriptionRow>(
          `select ${SUBSCRIPTION_SELECT_COLS}
             from brand_subscriptions
            where organization_id = $1
            for update`,
          [organizationId],
        )
      ).rows[0];
      if (!row) return { ok: false as const, code: 'not_found' as const };
      if (row.status === 'ended') return { ok: false as const, code: 'conflict' as const, detail: 'already_ended' };

      // C3 / review round 2 item 4: system voids before the cancel flag is set (the existing void path
      // returns any discount use).
      // - nothing paid: every unpaid invoice and draft of the epoch, early access or not (used days, if they
      //   should be charged, need a manual invoice); the subscription then ends at once;
      // - something paid: drafts of future periods, and the job's own unedited draft of the current period
      //   that would otherwise never be issued. Issued invoices stay as they are.
      const epochInvoices = await loadInvoicesForEngine(sql, organizationId, Number(row.epoch ?? 1));
      const hasAnyPaid = epochInvoices.some(
        (inv) => inv.status === 'paid' && (inv.kind === 'subscription' || inv.kind === 'prepay'),
      );
      const systemActor: InvoiceActor = { kind: 'system' };
      for (const inv of epochInvoices) {
        if (inv.kind !== 'subscription') continue;
        let reason: string | null = null;
        if (!hasAnyPaid) {
          if (inv.status === 'draft' || inv.status === 'issued') reason = 'subscription_canceled_unpaid';
        } else if (inv.status === 'draft') {
          // B1c-2: by cycle — a draft of a later cycle, or of the cycle containing today.
          const start = inv.cycle_start ? String(inv.cycle_start).slice(0, 10) : null;
          if (start ? start > kstDayOf(nowDate) : String(inv.period) > currentPeriod) reason = 'subscription_canceled_future_draft';
          else reason = 'subscription_canceled_current_draft';
        } else if (
          inv.status === 'issued' &&
          (inv.cycle_start ? String(inv.cycle_start).slice(0, 10) > kstDayOf(nowDate) : String(inv.period) > currentPeriod)
        ) {
          // Round 5, A5: guard — nothing of a later month survives a cancel (a paid one extends the end instead).
          reason = 'subscription_canceled_future_invoice';
        }
        if (reason === null) continue;
        const voidRes = await voidBrandInvoiceInTx(sql, systemActor, { invoiceId: inv.id, reason }, nowDate, {
          recordActorKind: true,
        });
        if (!voidRes.ok) throw new BrandBillingDenied(voidRes.code, voidRes.detail);
      }
      // Round 4, B6: the job reports these system voids from the invoice events (counts, tax invoices).
      // Round 4, B1: a downgrade an issued or paid invoice already carries is kept, not cleared by the cancel.
      const carriedPlan = pendingPlanCarriedByInvoice(
        toEngineSubscription(mapSubscription(row)),
        mapEngineInvoices(epochInvoices),
        kstDayOf(nowDate),
      );

      const actor: InvoiceActor = { kind: 'admin', userId: adminId };
      if (!row.cancel_at_period_end) {
        const nextRev = Number(row.revision) + 1;
        const updated = (
          await sql.query<SubscriptionRow>(
            `update brand_subscriptions
                set cancel_at_period_end = true,
                    canceled_at = $2::timestamptz,
                    plan_id = coalesce($5, plan_id),
                    pending_plan_id = null,
                    pending_plan_effective_period = null,
                    revision = $3,
                    updated_at = $2::timestamptz
              where organization_id = $1 and revision = $4
              returning ${SUBSCRIPTION_SELECT_COLS}`,
            [organizationId, nowIso, nextRev, Number(row.revision), carriedPlan],
          )
        ).rows[0];
        if (!updated) return { ok: false as const, code: 'conflict' as const };
        await appendSubscriptionEvent(sql, {
          organizationId,
          action: 'cancel_scheduled',
          actor,
          snapshot: subscriptionSnapshot(mapSubscription(updated)),
          createdAt: nowIso,
        });
      }

      await reconcileSubscriptionInTx(sql, { organizationId, actor, now: nowDate, graceDays });
      const finalSub = (await loadBrandSubscription(sql, organizationId))!;
      return { ok: true as const, subscription: finalSub };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

export async function undoCancelSubscription(
  deps: { sql: SqlRunner; now?: () => Date; env?: Record<string, string | undefined>; graceDays?: number },
  viewer: Viewer,
  input: unknown,
): Promise<BrandSubscriptionOutcome<{ subscription: BrandSubscription }>> {
  const parsed = OrgOnlyInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const { organizationId } = parsed.data;
  const nowDate = deps.now?.() ?? new Date();
  const nowIso = nowDate.toISOString();
  const graceDays = deps.graceDays ?? planGraceDaysFromEnv(deps.env);

  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!brandBillingAutoIssueOpen(deps.env)) return { ok: false as const, code: 'disabled' as const };
      if (!(await loadSubscriptionSchemaReady(sql))) return { ok: false as const, code: 'unavailable' as const };

      const orgGate = await lockOrgNotSandboxed(sql, organizationId);
      if (!orgGate.ok) return orgGate;

      const row = (
        await sql.query<SubscriptionRow>(
          `select ${SUBSCRIPTION_SELECT_COLS}
             from brand_subscriptions
            where organization_id = $1
            for update`,
          [organizationId],
        )
      ).rows[0];
      if (!row) return { ok: false as const, code: 'not_found' as const };
      if (row.status === 'ended') return { ok: false as const, code: 'conflict' as const, detail: 'already_ended' };
      if (!row.cancel_at_period_end) return { ok: false as const, code: 'conflict' as const, detail: 'not_canceled' };

      const actor: InvoiceActor = { kind: 'admin', userId: adminId };
      const nextRev = Number(row.revision) + 1;
      const updated = (
        await sql.query<SubscriptionRow>(
          `update brand_subscriptions
              set cancel_at_period_end = false,
                  canceled_at = null,
                  revision = $3,
                  updated_at = $2::timestamptz
            where organization_id = $1 and revision = $4
            returning ${SUBSCRIPTION_SELECT_COLS}`,
          [organizationId, nowIso, nextRev, Number(row.revision)],
        )
      ).rows[0];
      if (!updated) return { ok: false as const, code: 'conflict' as const };

      await appendSubscriptionEvent(sql, {
        organizationId,
        action: 'cancel_undone',
        actor,
        snapshot: subscriptionSnapshot(mapSubscription(updated)),
        createdAt: nowIso,
      });

      await reconcileSubscriptionInTx(sql, { organizationId, actor, now: nowDate, graceDays });
      const finalSub = (await loadBrandSubscription(sql, organizationId))!;
      return { ok: true as const, subscription: finalSub };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

const ScheduleDowngradeInput = z.object({
  organizationId: UUID,
  planId: z.string().trim().min(1),
});

export async function scheduleDowngrade(
  deps: { sql: SqlRunner; now?: () => Date; env?: Record<string, string | undefined> },
  viewer: Viewer,
  input: unknown,
): Promise<BrandSubscriptionOutcome<{ subscription: BrandSubscription }>> {
  const parsed = ScheduleDowngradeInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const { organizationId, planId } = parsed.data;
  if (!(BRAND_PLAN_IDS as readonly string[]).includes(planId) || !isPaidPlanId(planId)) {
    return {
      ok: false,
      code: 'invalid',
      field: 'planId',
      detail: planId === 'project_only' ? 'project_only_not_subscribable' : 'invalid_plan',
    };
  }
  const targetPlanId: PaidBrandPlanId = planId;
  const nowDate = deps.now?.() ?? new Date();
  const nowIso = nowDate.toISOString();
  let effectiveFromPeriod = nextPeriodOf(kstMonthOf(nowDate));

  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!brandBillingAutoIssueOpen(deps.env)) return { ok: false as const, code: 'disabled' as const };
      // B1c-2, rule 10: the downgrade applies to the first cycle that starts after today (anchor = plan start).
      const anchorAssignment = await loadPlanAssignment(sql, organizationId);
      if (anchorAssignment) {
        const next = cycleContaining(anchorAssignment.startedOn, kstDayOf(nowDate))?.end ?? anchorAssignment.startedOn;
        effectiveFromPeriod = periodOfDay(next);
      }
      if (!(await loadSubscriptionSchemaReady(sql))) return { ok: false as const, code: 'unavailable' as const };

      const orgGate = await lockOrgNotSandboxed(sql, organizationId);
      if (!orgGate.ok) return orgGate;

      const row = (
        await sql.query<SubscriptionRow>(
          `select ${SUBSCRIPTION_SELECT_COLS}
             from brand_subscriptions
            where organization_id = $1
            for update`,
          [organizationId],
        )
      ).rows[0];
      if (!row) return { ok: false as const, code: 'not_found' as const };
      if (row.status === 'ended' || row.cancel_at_period_end) {
        return { ok: false as const, code: 'conflict' as const, detail: 'subscription_not_active_for_plan_change' };
      }
      const currentPlan = row.plan_id as PaidBrandPlanId;
      if (targetPlanId === currentPlan) {
        return { ok: false as const, code: 'invalid' as const, field: 'planId', detail: 'same_plan' };
      }
      if (BRAND_PLANS[targetPlanId].rank > BRAND_PLANS[currentPlan].rank) {
        // B1c-3: a higher plan is the upgrade operation (`brandSubscription.upgrade`, a new cycle from today).
        return { ok: false as const, code: 'invalid' as const, field: 'planId', detail: 'upgrade_use_upgrade_operation' };
      }

      const actor: InvoiceActor = { kind: 'admin', userId: adminId };
      const nextRev = Number(row.revision) + 1;
      const updated = (
        await sql.query<SubscriptionRow>(
          `update brand_subscriptions
              set pending_plan_id = $2,
                  pending_plan_effective_period = $3,
                  revision = $4,
                  updated_at = $5::timestamptz
            where organization_id = $1 and revision = $6
            returning ${SUBSCRIPTION_SELECT_COLS}`,
          [organizationId, targetPlanId, effectiveFromPeriod, nextRev, nowIso, Number(row.revision)],
        )
      ).rows[0];
      if (!updated) return { ok: false as const, code: 'conflict' as const };

      const sub = mapSubscription(updated);
      await refreshFutureSubscriptionDrafts(sql, sub, nowDate);
      await appendSubscriptionEvent(sql, {
        organizationId,
        action: 'downgrade_scheduled',
        actor,
        snapshot: { ...subscriptionSnapshot(sub), pendingPlanId: targetPlanId, effectivePeriod: effectiveFromPeriod },
        createdAt: nowIso,
      });

      return { ok: true as const, subscription: sub };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

export async function clearPendingPlan(
  deps: { sql: SqlRunner; now?: () => Date; env?: Record<string, string | undefined> },
  viewer: Viewer,
  input: unknown,
): Promise<BrandSubscriptionOutcome<{ subscription: BrandSubscription }>> {
  const parsed = OrgOnlyInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const { organizationId } = parsed.data;
  const nowDate = deps.now?.() ?? new Date();
  const nowIso = nowDate.toISOString();

  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!brandBillingAutoIssueOpen(deps.env)) return { ok: false as const, code: 'disabled' as const };
      if (!(await loadSubscriptionSchemaReady(sql))) return { ok: false as const, code: 'unavailable' as const };

      const orgGate = await lockOrgNotSandboxed(sql, organizationId);
      if (!orgGate.ok) return orgGate;

      const row = (
        await sql.query<SubscriptionRow>(
          `select ${SUBSCRIPTION_SELECT_COLS}
             from brand_subscriptions
            where organization_id = $1
            for update`,
          [organizationId],
        )
      ).rows[0];
      if (!row) return { ok: false as const, code: 'not_found' as const };
      if (row.pending_plan_id === null) {
        return { ok: true as const, subscription: mapSubscription(row) };
      }

      const actor: InvoiceActor = { kind: 'admin', userId: adminId };
      const nextRev = Number(row.revision) + 1;
      const updated = (
        await sql.query<SubscriptionRow>(
          `update brand_subscriptions
              set pending_plan_id = null,
                  pending_plan_effective_period = null,
                  revision = $3,
                  updated_at = $2::timestamptz
            where organization_id = $1 and revision = $4
            returning ${SUBSCRIPTION_SELECT_COLS}`,
          [organizationId, nowIso, nextRev, Number(row.revision)],
        )
      ).rows[0];
      if (!updated) return { ok: false as const, code: 'conflict' as const };

      const sub = mapSubscription(updated);
      await refreshFutureSubscriptionDrafts(sql, sub, nowDate);
      await appendSubscriptionEvent(sql, {
        organizationId,
        action: 'downgrade_cleared',
        actor,
        snapshot: { ...subscriptionSnapshot(sub), clearedPlanId: row.pending_plan_id },
        createdAt: nowIso,
      });

      return { ok: true as const, subscription: sub };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

const ReissuePeriodInput = z.object({
  organizationId: UUID,
  period: z.string().trim().refine(isValidYearMonth, 'invalid YYYY-MM'),
  confirm: z.boolean().default(false),
  /** Round 4, B8: step 1. Without it, `confirm` and a matching digest are required. */
  previewOnly: z.boolean().default(false),
  /** Digest from step 1 (item 9); when present the reissue is refused (`preview_stale`) unless it still matches. */
  previewDigest: z.string().trim().regex(/^[0-9a-f]{16}$/).optional(),
});

export interface ReissuePeriodPreview {
  organizationId: string;
  period: string;
  planId: PaidBrandPlanId;
  prorateFromDay: string | null;
  dueOn: string;
  proratedDays: number | null;
  periodDays: number | null;
  discountPercent: number;
  supplyKrw: number;
  vatKrw: number;
  totalKrw: number;
  /** Why it may be reissued: the admin voided the current cycle, or nothing was ever paid and nothing is open. */
  reason: 'admin_voided' | 'needs_reissue';
  digest: string;
  /** Round 4, B9: a first invoice due fewer than 3 days after it is issued (shown, not part of the digest). */
  shortPaymentWindow: boolean;
}

/**
 * Reissue through the service (two-step confirm bound to the preview digest), B1c-2 rule 9 and rule 4:
 * - the latest invoice of the CURRENT cycle was voided by an admin (only while that cycle is current): the new
 *   invoice has the same cycle dates, the full price with the discount then in force, and the SAME due date; or
 * - nothing was ever paid and nothing is open in this epoch (voided or expired first invoice, no early access): a
 *   new first invoice at full price, due today + 14, without a cycle (the cycle starts on its paid date).
 * No proration anywhere. Early access, if granted, applies again through the engine's normal rule.
 */
export async function reissueSubscriptionPeriod(
  deps: { sql: SqlRunner; now?: () => Date; env?: Record<string, string | undefined>; graceDays?: number },
  viewer: Viewer,
  input: unknown,
): Promise<
  BrandSubscriptionOutcome<
    | { applied: false; preview: ReissuePeriodPreview }
    | { applied: true; invoice: BrandInvoice; subscription: BrandSubscription }
  >
> {
  const parsed = ReissuePeriodInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  const nowDate = deps.now?.() ?? new Date();
  const todayKst = kstDayOf(nowDate);
  const currentMonth = kstMonthOf(nowDate);
  const nowIso = nowDate.toISOString();
  const graceDays = deps.graceDays ?? planGraceDaysFromEnv(deps.env);

  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!brandBillingAutoIssueOpen(deps.env)) return { ok: false as const, code: 'disabled' as const };
      if (!(await loadSubscriptionSchemaReady(sql))) return { ok: false as const, code: 'unavailable' as const };

      const orgGate = await lockOrgNotSandboxed(sql, v.organizationId);
      if (!orgGate.ok) return orgGate;


      const row = (
        await sql.query<SubscriptionRow>(
          `select ${SUBSCRIPTION_SELECT_COLS}
             from brand_subscriptions
            where organization_id = $1
            for update`,
          [v.organizationId],
        )
      ).rows[0];
      if (!row) return { ok: false as const, code: 'not_found' as const };
      let sub = mapSubscription(row);
      if (sub.status === 'ended' || sub.cancelAtPeriodEnd || !isPaidPlanId(sub.planId)) {
        return { ok: false as const, code: 'conflict' as const, detail: 'subscription_not_reissuable' };
      }

      const invoiceRows = await loadInvoicesForEngine(sql, v.organizationId, sub.epoch);
      const engineInvoices = mapEngineInvoices(invoiceRows);
      // B1c-2, rule 9: `reissueCycle` — the CURRENT cycle only (same cycle dates, full price with the discount then in
      // force, the SAME due date as the voided invoice). While nothing is paid and there is no early access the
      // subscription waits for its first payment: a new first invoice without a cycle, due today + 14.
      const engineSub = toEngineSubscription(sub);
      const needsReissue = subscriptionNeedsReissue(engineSub, engineInvoices);
      const freshFirstInvoice = needsReissue && firstInvoiceRuleApplies(engineSub, engineInvoices);
      const run = currentRun(engineInvoices, todayKst);
      const current = run ? cycleContaining(run.anchor, todayKst) : null;
      const targetCycle: Cycle | null = freshFirstInvoice ? null : current ? cycleStartingOn(run!.anchor, current.start) : null;
      const targetPeriod = targetCycle ? periodOfDay(targetCycle.start) : currentMonth;
      if (v.period !== targetPeriod) {
        return { ok: false as const, code: 'invalid' as const, field: 'period', detail: 'reissue_current_period_only' };
      }
      if (!freshFirstInvoice && !targetCycle) {
        return { ok: false as const, code: 'conflict' as const, detail: 'period_not_admin_voided' };
      }
      const nonVoidForTarget = engineInvoices.some(
        (i) =>
          i.kind === 'subscription' &&
          i.status !== 'void' &&
          (targetCycle ? i.cycleStart === targetCycle.start : !i.cycleStart),
      );
      const reason: ReissuePeriodPreview['reason'] | null = nonVoidForTarget
        ? null
        : targetCycle && findAdminVoidedCycles(engineInvoices).includes(targetCycle.start)
          ? 'admin_voided'
          : needsReissue
            ? 'needs_reissue'
            : null;
      if (reason === null) {
        return { ok: false as const, code: 'conflict' as const, detail: 'period_not_admin_voided' };
      }
      const replaced = targetCycle ? latestSubscriptionInvoiceOfCycle(invoiceRows, targetCycle.start) : null;
      const prorate = null;
      const effectiveFromPeriod =
        sub.pendingPlanEffectivePeriod ?? addMonthsToPeriod(periodOfDay(sub.startedOn), 1);
      const shouldApplyPending =
        targetCycle !== null &&
        sub.pendingPlanId !== null &&
        isPaidPlanId(sub.pendingPlanId) &&
        sub.pendingPlanId !== sub.planId &&
        targetPeriod >= effectiveFromPeriod;
      const planToBill: PaidBrandPlanId = shouldApplyPending ? (sub.pendingPlanId as PaidBrandPlanId) : sub.planId;
      const firstInvoiceRule = freshFirstInvoice;
      const dueOn = replaced?.due_on ?? dueOnForInvoice({ issueDay: todayKst, cycleStart: targetCycle?.start ?? null, method: sub.collectionMethod });
      const amounts = await derivedInvoiceAmounts(sql, v.organizationId, planToBill, prorate);
      const previewValues = {
        organizationId: v.organizationId,
        period: v.period,
        cycleStart: targetCycle?.start ?? null,
        cycleEnd: targetCycle?.end ?? null,
        planId: planToBill,
        prorateFromDay: null as string | null,
        dueOn,
        proratedDays: amounts.proratedDays,
        periodDays: amounts.periodDays,
        discountPercent: amounts.discountPct,
        supplyKrw: amounts.supplyKrw,
        vatKrw: amounts.vatKrw,
        totalKrw: amounts.totalKrw,
        reason,
      };
      const digest = previewDigest(previewValues);

      void firstInvoiceRule;
      const shortPaymentWindow = false;
      if (v.previewOnly) {
        return { ok: true as const, applied: false as const, preview: { ...previewValues, digest, shortPaymentWindow } };
      }
      // Rounds 3–4: a confirm is only valid with the digest of the preview the admin saw; no third mode.
      if (!v.confirm || v.previewDigest === undefined) {
        return { ok: false as const, code: 'invalid' as const, field: 'previewDigest', detail: 'preview_required' };
      }
      if (v.previewDigest !== digest) {
        return { ok: false as const, code: 'conflict' as const, detail: 'preview_stale' };
      }

      const actor: InvoiceActor = { kind: 'admin', userId: adminId };
      if (shouldApplyPending) {
        const nextRev = sub.revision + 1;
        const fromPlan = sub.planId;
        const updatedPlan = (
          await sql.query<SubscriptionRow>(
            `update brand_subscriptions
                set plan_id = $2,
                    pending_plan_id = null,
                    pending_plan_effective_period = null,
                    revision = $3,
                    updated_at = $4::timestamptz
              where organization_id = $1 and revision = $5
              returning ${SUBSCRIPTION_SELECT_COLS}`,
            [v.organizationId, planToBill, nextRev, nowIso, sub.revision],
          )
        ).rows[0];
        if (!updatedPlan) throw new BrandBillingDenied('conflict', 'subscription_revision_conflict');
        sub = mapSubscription(updatedPlan);
        await appendSubscriptionEvent(sql, {
          organizationId: v.organizationId,
          action: 'plan_changed',
          actor,
          snapshot: { ...subscriptionSnapshot(sub), fromPlanId: fromPlan, toPlanId: planToBill },
          createdAt: nowIso,
        });
      }

      const drafted = await draftBrandInvoiceInTx(
        sql,
        actor,
        {
          organizationId: v.organizationId,
          period: v.period,
          planId: planToBill,
          prorate: false,
          applyActiveDiscount: true,
          manualAmounts: false,
          manualReason: '',
          memo: '',
        },
        nowDate,
        {
          kind: 'subscription',
          coversMonths: 1,
          dueOn: null,
          collectionMethod: sub.collectionMethod,
          subscriptionEpoch: sub.epoch,
          cycleStart: targetCycle?.start ?? null,
          cycleEnd: targetCycle?.end ?? null,
        },
      );
      if (!drafted.ok) throw new BrandBillingDenied(drafted.code, drafted.detail);

      const issued = await issueBrandInvoiceInTx(
        sql,
        actor,
        { invoiceId: drafted.invoice.id },
        nowDate,
        { dueOn, collectionMethod: sub.collectionMethod },
      );
      if (!issued.ok) throw new BrandBillingDenied(issued.code, issued.detail);

      await appendSubscriptionEvent(sql, {
        organizationId: v.organizationId,
        action: 'reconciled',
        actor,
        snapshot: { ...subscriptionSnapshot(sub), reissuedPeriod: v.period, invoiceId: issued.invoice.id, reason },
        createdAt: nowIso,
      });

      await reconcileSubscriptionInTx(sql, { organizationId: v.organizationId, actor, now: nowDate, graceDays });
      const finalSub = (await loadBrandSubscription(sql, v.organizationId))!;
      return { ok: true as const, applied: true as const, invoice: issued.invoice, subscription: finalSub };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

export async function reconcileSubscriptionAdmin(
  deps: { sql: SqlRunner; now?: () => Date; env?: Record<string, string | undefined>; graceDays?: number },
  viewer: Viewer,
  input: unknown,
): Promise<BrandSubscriptionOutcome<{ summary: ReconcileSummary; subscription: BrandSubscription | null }>> {
  const parsed = OrgOnlyInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const nowDate = deps.now?.() ?? new Date();
  const graceDays = deps.graceDays ?? planGraceDaysFromEnv(deps.env);
  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!brandBillingAutoIssueOpen(deps.env)) return { ok: false as const, code: 'disabled' as const };
      if (!(await loadSubscriptionSchemaReady(sql))) return { ok: false as const, code: 'unavailable' as const };

      const orgGate = await lockOrgNotSandboxed(sql, parsed.data.organizationId);
      if (!orgGate.ok) return orgGate;

      const summary = await reconcileSubscriptionInTx(sql, {
        organizationId: parsed.data.organizationId,
        actor: { kind: 'admin', userId: adminId },
        now: nowDate,
        graceDays,
      });
      if (!summary.applied && summary.skippedReason === 'not_found') {
        return { ok: false as const, code: 'not_found' as const };
      }
      // Round 5, B2: a failed or partly failed reconcile is an outcome (the steps that worked are committed).
      if (summary.failures.length > 0) {
        const step = summary.failures.find((f) => f.startsWith('access:')) ?? summary.failures[0]!;
        return { ok: false as const, code: 'conflict' as const, detail: `reconcile_failed:${step}` };
      }
      const sub = await loadBrandSubscription(sql, parsed.data.organizationId);
      return { ok: true as const, summary, subscription: sub };
    });
  } catch (error) {
    if (error instanceof BrandBillingDenied && (error.code === 'forbidden' || error.code === 'not_found')) return outcomeError(error);
    const code = reconcileErrorCode(error);
    await recordReconcileFailure(deps.sql, parsed.data.organizationId, code).catch(() => 0);
    return { ok: false, code: 'conflict', detail: `reconcile_failed:${code}` };
  }
}
