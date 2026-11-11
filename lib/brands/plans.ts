import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { BrandOutcome } from './workspace/types';
import { isMissingTable } from './entitlements';

/**
 * B2B plans for brand.twings.app (docs/BRAND-PRODUCT.md §6). Founder decision (2026-11-03): three
 * monthly price points, 390,000 / 690,000 / 990,000 KRW, enterprise B2B. The ids name the price
 * points, which are the decision; display names live in the dictionary and may change freely. What
 * each plan includes (credits, seats, finishing steps) is a proposal in the document until the
 * founder settles it, so nothing here gates a feature by plan: the deny-list in entitlements.ts is
 * the only gate today.
 *
 * An assignment is a record, not a payment: the studio sells and invoices the plan (tax invoice or
 * card billing, per contract); the row tells the product and the admin console which plan a brand
 * is on and since when.
 */
export const BRAND_PLAN_IDS = ['b2b_39', 'b2b_69', 'b2b_99', 'project_only'] as const;
export type BrandPlanId = (typeof BRAND_PLAN_IDS)[number];

/** Proposed post-delivery room retention window for non-subscribing project-only clients (founder decision Q5 pending; zero auto-deletion until confirmed). */
export const PROJECT_ONLY_RETENTION_DAYS_PROPOSED = 90;

export const BRAND_PLANS: Record<BrandPlanId, { monthlyKrw: number; rank: 0 | 1 | 2 | 3 }> = {
  project_only: { monthlyKrw: 0, rank: 0 },
  b2b_39: { monthlyKrw: 390_000, rank: 1 },
  b2b_69: { monthlyKrw: 690_000, rank: 2 },
  b2b_99: { monthlyKrw: 990_000, rank: 3 },
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

/** Set or replace an organization's plan (admin only), with the same revision rule as the policy. */
export async function setPlanAssignment(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown,
): Promise<BrandOutcome<{ id: string; revision: number }>> {
  if (!uuid.safeParse(viewer.userId).success) return { ok: false, code: 'sign_in_required' };
  const parsed = PlanInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  const v = parsed.data;
  return deps.sql.transaction(async (sql) => {
    const profile = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1 for share', [viewer.userId])).rows[0];
    if (!profile) return { ok: false as const, code: 'sign_in_required' as const };
    if (profile.is_admin !== true) return { ok: false as const, code: 'forbidden' as const };
    if (!(await sql.query('select id from brand_organizations where id = $1 for update', [v.organizationId])).rows[0])
      return { ok: false as const, code: 'not_found' as const };
    const current = (
      await sql.query<{ revision: number }>('select revision from brand_plan_assignments where organization_id = $1 for update', [v.organizationId])
    ).rows[0];
    const revision = current ? Number(current.revision) : 0;
    if (revision !== v.expectedRevision) return { ok: false as const, code: 'conflict' as const };
    const next = revision + 1;
    await sql.query(
      `insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, seats, note, revision, updated_by, updated_at)
         values ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, now())
       on conflict (organization_id) do update
         set plan_id = excluded.plan_id, billing_mode = excluded.billing_mode, started_on = excluded.started_on, ends_on = excluded.ends_on,
             seats = excluded.seats, note = excluded.note, revision = excluded.revision, updated_by = excluded.updated_by, updated_at = now()`,
      [v.organizationId, v.planId, v.billingMode, v.startedOn, v.endsOn, v.seats, v.note, next, viewer.userId],
    );
    await sql.query(
      'insert into brand_plan_events (organization_id, plan_id, billing_mode, started_on, ends_on, seats, note, actor_id) values ($1, $2, $3, $4::date, $5::date, $6, $7, $8)',
      [v.organizationId, v.planId, v.billingMode, v.startedOn, v.endsOn, v.seats, v.note, viewer.userId],
    );
    return { ok: true as const, id: v.organizationId, revision: next };
  });
}
