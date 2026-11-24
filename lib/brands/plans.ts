import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { BrandOutcome } from './workspace/types';
import { isMissingTable } from './entitlements';
import { brandBillingAutoIssueOpen } from '@/lib/flags';
import { loadSubscriptionSchemaReady } from './billing/schema-guard';
import { syncPlanDefaultSnapshot } from './billing/snapshot';
import { CYCLE_ALREADY_INVOICED, higherPlanNeedsUpgrade, PLAN_UPGRADE_REQUIRED, startDayMoveBlocked } from './billing/cycle-invoices';
import { kstDayOf } from './billing/math';

/**
 * B2B plans for brand.twings.app (docs/BRAND-PRODUCT.md §6). Founder decision (2026-11-12): three
 * monthly subscription price points, 290,000 / 490,000 / 690,000 KRW, plus `project_only` (0 KRW/month
 * commissioned project workspace with 90-day post-completion retention and read-only archive thereafter).
 * The ids name the price points; display names live in the dictionary.
 *
 * An assignment is a record, not a payment: the studio sells and invoices the plan (tax invoice or
 * card billing, per contract); the row tells the product and the admin console which plan a brand
 * is on and since when.
 */
export const BRAND_PLAN_IDS = ['b2b_29', 'b2b_49', 'b2b_69', 'project_only'] as const;
export type BrandPlanId = (typeof BRAND_PLAN_IDS)[number];

/** Post-completion room retention window for non-subscribing project-only clients (founder decision 2026-11-12: 90 days, then read-only archive). */
export const PROJECT_ONLY_RETENTION_DAYS = 90;
export const PROJECT_ONLY_RETENTION_DAYS_PROPOSED = PROJECT_ONLY_RETENTION_DAYS;

export const BRAND_PLANS: Record<BrandPlanId, { monthlyKrw: number; rank: 0 | 1 | 2 | 3 }> = {
  project_only: { monthlyKrw: 0, rank: 0 },
  b2b_29: { monthlyKrw: 290_000, rank: 1 },
  b2b_49: { monthlyKrw: 490_000, rank: 2 },
  b2b_69: { monthlyKrw: 690_000, rank: 3 },
};

/** `invoice`: tax invoice, paid by transfer. `card`: recurring card billing once the gateway allows it. */
export const BRAND_BILLING_MODES = ['invoice', 'card'] as const;
export type BrandBillingMode = (typeof BRAND_BILLING_MODES)[number];

export interface BrandPlanAssignment {
  organizationId: string;
  planId: BrandPlanId;
  billingMode: BrandBillingMode;
  /** YYYY-MM-DD, KST calendar days. */
  startedOn: string;
  endsOn: string | null;
  seats: number | null;
  note: string;
  /** Optimistic-concurrency token for the admin form; 0 = no row yet. */
  revision: number;
  updatedAt: string | null;
}

const uuid = z.string().uuid();
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = z
  .string()
  .regex(DAY)
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'not a calendar day');

const PlanInput = z
  .object({
    organizationId: uuid,
    planId: z.enum(BRAND_PLAN_IDS),
    billingMode: z.enum(BRAND_BILLING_MODES).default('invoice'),
    startedOn: day,
    endsOn: day.nullable().default(null),
    seats: z.number().int().min(1).max(1000).nullable().default(null),
    note: z.string().trim().max(500).default(''),
    expectedRevision: z.number().int().min(0),
  })
  .refine((v) => v.endsOn === null || v.endsOn > v.startedOn, { path: ['endsOn'], message: 'ends before it starts' });

type PlanRow = {
  plan_id: string;
  billing_mode: string;
  started_on: string;
  ends_on: string | null;
  seats: number | null;
  note: string;
  revision: number;
  updated_at: unknown;
};

const stamp = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

/** `started_on::text` keeps the calendar day exact; a Date would shift it with the server's zone. */
export async function loadPlanAssignment(sql: SqlRunner, organizationId: string): Promise<BrandPlanAssignment | null> {
  if (!uuid.safeParse(organizationId).success) return null;
  let row: PlanRow | undefined;
  try {
    row = (
      await sql.query<PlanRow>(
        'select plan_id, billing_mode, started_on::text as started_on, ends_on::text as ends_on, seats, note, revision, updated_at from brand_plan_assignments where organization_id = $1',
        [organizationId],
      )
    ).rows[0];
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  if (!row) return null;
  const planId = row.plan_id as BrandPlanId;
  const billingMode = row.billing_mode as BrandBillingMode;
  if (!BRAND_PLAN_IDS.includes(planId) || !BRAND_BILLING_MODES.includes(billingMode)) return null;
  return {
    organizationId,
    planId,
    billingMode,
    startedOn: String(row.started_on),
    endsOn: row.ends_on == null ? null : String(row.ends_on),
    seats: row.seats == null ? null : Number(row.seats),
    note: String(row.note ?? ''),
    revision: Number(row.revision),
    updatedAt: stamp(row.updated_at),
  };
}

/** Active on `today` (YYYY-MM-DD): started, and not yet ended. */
export function planActiveOn(plan: Pick<BrandPlanAssignment, 'startedOn' | 'endsOn'> | null, today: string): boolean {
  return plan !== null && plan.startedOn <= today && (plan.endsOn === null || today < plan.endsOn);
}

export type PlanWriteActor = { kind: 'admin'; userId: string } | { kind: 'system' };

/**
 * Shared internal writer for `brand_plan_assignments` + `brand_plan_events` + `syncPlanDefaultSnapshot`.
 * Both `setPlanAssignment` (admin wrapper) and the subscription service (admin & system) call this
 * inside a transaction so plan writes, event logging, and allowance snapshots stay in one place.
 */
export async function upsertPlanAssignmentInTx(
  sql: SqlRunner,
  params: {
    organizationId: string;
    planId: BrandPlanId;
    billingMode: BrandBillingMode;
    startedOn: string;
    endsOn: string | null;
    seats: number | null;
    note: string;
    expectedRevision?: number;
    actor: PlanWriteActor;
    recordActorKind?: boolean;
    /** Subscription paths lock the organization `for no key update` (see `lockOrganizationForSubscription`). */
    organizationLock?: 'update' | 'no key update';
    /** Item 5: refuse plan id / billing mode / dates changes while a non-ended subscription owns the row. */
    refuseWhenSubscriptionManaged?: boolean;
    /** B1c-3 fix round 1 (the admin plan form): refuse a higher plan id while a subscription invoice covers today. */
    refuseMidCycleUpgrade?: boolean;
    now?: Date;
    graceDays?: number;
  },
): Promise<BrandOutcome<{ id: string; revision: number }>> {
  const orgLockSql =
    params.organizationLock === 'no key update'
      ? 'select id from brand_organizations where id = $1 for no key update'
      : 'select id from brand_organizations where id = $1 for update';
  if (!(await sql.query(orgLockSql, [params.organizationId])).rows[0]) {
    return { ok: false, code: 'not_found' };
  }
  const current = (
    await sql.query<{ revision: number }>('select revision from brand_plan_assignments where organization_id = $1 for update', [
      params.organizationId,
    ])
  ).rows[0];
  const revision = current ? Number(current.revision) : 0;
  if (params.expectedRevision !== undefined && revision !== params.expectedRevision) {
    return { ok: false, code: 'conflict' };
  }
  if (params.refuseWhenSubscriptionManaged && (await subscriptionManagesPlan(sql, params.organizationId))) {
    const existing = await loadPlanAssignment(sql, params.organizationId);
    const changesManagedFields =
      existing === null ||
      existing.planId !== params.planId ||
      existing.billingMode !== params.billingMode ||
      existing.startedOn !== params.startedOn ||
      (existing.endsOn ?? null) !== (params.endsOn ?? null);
    if (changesManagedFields) return { ok: false, code: 'conflict', field: SUBSCRIPTION_MANAGED_PLAN };
  }
  // B1c: an admin moving the start day moves the billing cycle; refused while a subscription invoice covers today or later.
  if (
    current &&
    params.actor.kind === 'admin' &&
    (await startDayMoveBlocked(sql, params.organizationId, params.startedOn, kstDayOf(params.now ?? new Date())))
  ) {
    return { ok: false, code: 'conflict', field: CYCLE_ALREADY_INVOICED };
  }
  // B1c-3 fix round 1: a higher plan mid-cycle is the upgrade operation, not the plan form. Only with an existing assignment
  // (the new-assignment path runs exactly the statements it ran before).
  if (current && params.refuseMidCycleUpgrade && params.actor.kind === 'admin') {
    const stored = (
      await sql.query<{ plan_id: string }>('select plan_id from brand_plan_assignments where organization_id = $1', [params.organizationId])
    ).rows[0];
    if (stored && (await higherPlanNeedsUpgrade(sql, params.organizationId, stored.plan_id, params.planId, kstDayOf(params.now ?? new Date())))) {
      return { ok: false, code: 'conflict', field: PLAN_UPGRADE_REQUIRED };
    }
  }
  const next = revision + 1;
  const actorId = params.actor.kind === 'admin' ? params.actor.userId : null;
  await sql.query(
    `insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, seats, note, revision, updated_by, updated_at)
       values ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, now())
     on conflict (organization_id) do update
       set plan_id = excluded.plan_id, billing_mode = excluded.billing_mode, started_on = excluded.started_on, ends_on = excluded.ends_on,
           seats = excluded.seats, note = excluded.note, revision = excluded.revision, updated_by = excluded.updated_by, updated_at = now()`,
    [params.organizationId, params.planId, params.billingMode, params.startedOn, params.endsOn, params.seats, params.note, next, actorId],
  );
  if (params.recordActorKind) {
    await sql.query(
      'insert into brand_plan_events (organization_id, plan_id, billing_mode, started_on, ends_on, seats, note, actor_id, actor_kind) values ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9)',
      [
        params.organizationId,
        params.planId,
        params.billingMode,
        params.startedOn,
        params.endsOn,
        params.seats,
        params.note,
        actorId,
        params.actor.kind,
      ],
    );
  } else {
    await sql.query(
      'insert into brand_plan_events (organization_id, plan_id, billing_mode, started_on, ends_on, seats, note, actor_id) values ($1, $2, $3, $4::date, $5::date, $6, $7, $8)',
      [params.organizationId, params.planId, params.billingMode, params.startedOn, params.endsOn, params.seats, params.note, actorId],
    );
  }
  await syncPlanDefaultSnapshot(sql, params.organizationId, actorId, {
    ...(params.now ? { now: params.now } : {}),
    ...(params.graceDays !== undefined ? { graceDays: params.graceDays } : {}),
  });
  return { ok: true, id: params.organizationId, revision: next };
}

/** Remove an organization's plan assignment when a subscription ends, recording `brand_plan_events` and syncing snapshot. */
export async function clearPlanAssignmentInTx(
  sql: SqlRunner,
  params: {
    organizationId: string;
    note: string;
    actor: PlanWriteActor;
    recordActorKind?: boolean;
    now?: Date;
    graceDays?: number;
  },
): Promise<{ cleared: boolean }> {
  const existing = (
    await sql.query<PlanRow>(
      'select plan_id, billing_mode, started_on::text as started_on, ends_on::text as ends_on, seats, note, revision, updated_at from brand_plan_assignments where organization_id = $1 for update',
      [params.organizationId],
    )
  ).rows[0];
  if (!existing) return { cleared: false };
  const actorId = params.actor.kind === 'admin' ? params.actor.userId : null;
  await sql.query('delete from brand_plan_assignments where organization_id = $1', [params.organizationId]);
  if (params.recordActorKind) {
    await sql.query(
      'insert into brand_plan_events (organization_id, plan_id, billing_mode, started_on, ends_on, seats, note, actor_id, actor_kind) values ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9)',
      [
        params.organizationId,
        existing.plan_id,
        existing.billing_mode,
        existing.started_on,
        existing.ends_on,
        existing.seats,
        params.note,
        actorId,
        params.actor.kind,
      ],
    );
  } else {
    await sql.query(
      'insert into brand_plan_events (organization_id, plan_id, billing_mode, started_on, ends_on, seats, note, actor_id) values ($1, $2, $3, $4::date, $5::date, $6, $7, $8)',
      [
        params.organizationId,
        existing.plan_id,
        existing.billing_mode,
        existing.started_on,
        existing.ends_on,
        existing.seats,
        params.note,
        actorId,
      ],
    );
  }
  await syncPlanDefaultSnapshot(sql, params.organizationId, actorId, {
    ...(params.now ? { now: params.now } : {}),
    ...(params.graceDays !== undefined ? { graceDays: params.graceDays } : {}),
  });
  return { cleared: true };
}

/** Refusal marker (`field`) when an admin tries to change a plan a subscription owns (review round 2, item 5). */
export const SUBSCRIPTION_MANAGED_PLAN = 'subscription_managed' as const;

/**
 * Whether a non-ended subscription owns this organization's plan assignment. Only with
 * `BRAND_BILLING_AUTO_ISSUE=on` and migration 0182 applied; otherwise no query runs (flag-off parity).
 */
export async function subscriptionManagesPlan(sql: SqlRunner, organizationId: string): Promise<boolean> {
  if (!brandBillingAutoIssueOpen()) return false;
  if (!(await loadSubscriptionSchemaReady(sql))) return false;
  const row = (
    await sql.query("select 1 from brand_subscriptions where organization_id = $1 and status <> 'ended' limit 1", [
      organizationId,
    ])
  ).rows[0];
  return Boolean(row);
}

/** Set or replace an organization's plan (admin only), with the same revision rule as the policy. */
export async function setPlanAssignment(
  deps: { sql: SqlRunner; now?: () => Date },
  viewer: Viewer,
  input: unknown,
): Promise<BrandOutcome<{ id: string; revision: number }>> {
  if (!uuid.safeParse(viewer.userId).success) return { ok: false, code: 'sign_in_required' };
  const parsed = PlanInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  const v = parsed.data;
  return deps.sql.transaction(async (sql) => {
    const profile = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1 for key share', [viewer.userId])).rows[0];
    if (!profile) return { ok: false as const, code: 'sign_in_required' as const };
    if (profile.is_admin !== true) return { ok: false as const, code: 'forbidden' as const };
    return upsertPlanAssignmentInTx(sql, {
      organizationId: v.organizationId,
      planId: v.planId,
      billingMode: v.billingMode,
      startedOn: v.startedOn,
      endsOn: v.endsOn,
      seats: v.seats,
      note: v.note,
      expectedRevision: v.expectedRevision,
      actor: { kind: 'admin', userId: viewer.userId! },
      recordActorKind: false,
      refuseWhenSubscriptionManaged: true,
      refuseMidCycleUpgrade: true,
      now: deps.now?.(),
    });
  });
}
