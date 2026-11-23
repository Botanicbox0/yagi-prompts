import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import { planGraceDaysFromEnv, studioEnv, type StudioEnv } from '@/lib/brand-studio/env';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { STUDIO_LANES } from '@/lib/brand-studio/models';
import { BRAND_BILLING_MODES, BRAND_PLAN_IDS, type BrandPlanId } from '../plans';
import { requireDbAdmin, BrandBillingDenied } from './access';
import {
  isAllowedGrantMonth,
  isValidCalendarDay,
  isValidYearMonth,
  kstDayOf,
  kstMonthOf,
  PAID_BRAND_PLAN_IDS,
  planActiveWithGrace,
  type PaidBrandPlanId,
} from './math';
import { brandWorkspaceApprovalOpen } from '@/lib/flags';
import { hasTable, loadAllowanceSchemaState } from './schema-guard';
import { syncPlanDefaultSnapshot } from './snapshot';
import { CYCLE_ALREADY_INVOICED, startDayMoveBlocked } from './cycle-invoices';
import { loadWorkspaceApprovalSchemaReady } from './workspace-approval-schema';
import type {
  BrandAllowanceGrant,
  BrandAllowanceGrantKind,
  BrandBillingFailureCode,
  BrandBillingOutcome,
  BrandPlanAllowanceDefault,
  BrandPlanDefaultAffectedOrg,
} from './types';

const UUID = z.string().uuid();
const CalendarDay = z.string().refine(isValidCalendarDay, 'invalid calendar day');
const YearMonth = z.string().refine(isValidYearMonth, 'invalid YYYY-MM');

const stamp = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

function outcomeError(error: unknown): { ok: false; code: BrandBillingFailureCode } {
  if (error instanceof BrandBillingDenied) return { ok: false, code: error.code };
  throw error;
}

const PlanDefaultInput = z.object({
  planId: z.enum(PAID_BRAND_PLAN_IDS),
  monthlyCapKrw: z.number().int().min(0).max(100_000_000).nullable(),
  note: z.string().trim().max(500).default(''),
  confirm: z.boolean().default(false),
});

export async function loadPlanAllowanceDefaults(sql: SqlRunner): Promise<BrandPlanAllowanceDefault[]> {
  if (!(await hasTable(sql, 'brand_plan_allowance_defaults'))) return [];
  const { rows } = await sql.query<{
    plan_id: string;
    monthly_cap_krw: number | null;
    affected_org_count: number;
    note: string;
    updated_by: string | null;
    updated_at: unknown;
  }>(
    'select plan_id, monthly_cap_krw, affected_org_count, note, updated_by, updated_at from brand_plan_allowance_defaults order by plan_id',
  );
  return rows
    .filter((r) => (PAID_BRAND_PLAN_IDS as readonly string[]).includes(r.plan_id))
    .map((r) => ({
      planId: r.plan_id as PaidBrandPlanId,
      monthlyCapKrw: r.monthly_cap_krw === null ? null : Number(r.monthly_cap_krw),
      affectedOrgCount: Number(r.affected_org_count ?? 0),
      note: String(r.note ?? ''),
      updatedBy: r.updated_by ? String(r.updated_by) : null,
      updatedAt: stamp(r.updated_at) ?? new Date(0).toISOString(),
    }));
}

export async function loadPlanAllowanceDefault(sql: SqlRunner, planId: BrandPlanId): Promise<number | null> {
  if (!(PAID_BRAND_PLAN_IDS as readonly string[]).includes(planId)) return null;
  if (!(await hasTable(sql, 'brand_plan_allowance_defaults'))) return null;
  const row = (
    await sql.query<{ monthly_cap_krw: number | null }>(
      'select monthly_cap_krw from brand_plan_allowance_defaults where plan_id = $1',
      [planId],
    )
  ).rows[0];
  if (!row || row.monthly_cap_krw === null || row.monthly_cap_krw === undefined) return null;
  return Number(row.monthly_cap_krw);
}

/**
 * Two-step plan default monthly allowance update for paid plans (`b2b_29`, `b2b_49`, `b2b_69` only).
 * Without `confirm: true`: writes nothing and returns affected organizations (`applied: false`).
 * With `confirm: true`: saves the default, writes an audit event with `affected_org_count`, and
 * updates the rollback snapshot column (`monthly_cap_krw`) on `is_override = false` rows.
 */
export async function setPlanAllowanceDefault(
  deps: { sql: SqlRunner; env?: Pick<StudioEnv, 'defaultMonthlyKrw' | 'planGraceDays'>; now?: () => Date },
  viewer: Viewer,
  input: unknown,
): Promise<
  BrandBillingOutcome<{
    applied: boolean;
    planId: PaidBrandPlanId;
    monthlyCapKrw: number | null;
    affectedCount: number;
    affectedOrganizations: BrandPlanDefaultAffectedOrg[];
  }>
> {
  const parsed = PlanDefaultInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  const nowDate = deps.now?.() ?? new Date();
  const todayKst = kstDayOf(nowDate);
  const currentEnv = deps.env ?? studioEnv();
  const effectiveEnvDefault = currentEnv.defaultMonthlyKrw;
  const graceDays = currentEnv.planGraceDays ?? planGraceDaysFromEnv();
  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!(await hasTable(sql, 'brand_plan_allowance_defaults'))) {
        return { ok: false as const, code: 'unavailable' as const };
      }
      const existingRow = (
        await sql.query<{ monthly_cap_krw: number | null }>(
          'select monthly_cap_krw from brand_plan_allowance_defaults where plan_id = $1 for update',
          [v.planId],
        )
      ).rows[0];
      const previousCapKrw =
        existingRow && existingRow.monthly_cap_krw !== null && existingRow.monthly_cap_krw !== undefined
          ? Number(existingRow.monthly_cap_krw)
          : null;

      const orgRows = (
        await sql.query<{
          organization_id: string;
          name: string;
          started_on: string;
          ends_on: string | null;
          is_override: boolean | null;
        }>(
          `select p.organization_id, o.name, p.started_on::text as started_on, p.ends_on::text as ends_on,
                  a.is_override as is_override
             from brand_plan_assignments p
             join brand_organizations o on o.id = p.organization_id
             left join brand_studio_allowances a on a.organization_id = p.organization_id
            where p.plan_id = $1
            order by o.name asc`,
          [v.planId],
        )
      ).rows;

      const affectedOrganizations: BrandPlanDefaultAffectedOrg[] = [];
      for (const org of orgRows) {
        if (org.is_override === true) continue;
        const { active } = planActiveWithGrace(
          { startedOn: String(org.started_on), endsOn: org.ends_on == null ? null : String(org.ends_on) },
          todayKst,
          graceDays,
        );
        const beforeCapKrw = active && previousCapKrw !== null ? previousCapKrw : effectiveEnvDefault;
        const afterCapKrw = active && v.monthlyCapKrw !== null ? v.monthlyCapKrw : effectiveEnvDefault;
        if (beforeCapKrw !== afterCapKrw) {
          affectedOrganizations.push({
            organizationId: String(org.organization_id),
            name: String(org.name),
            beforeCapKrw,
            afterCapKrw,
          });
        }
      }

      if (!v.confirm) {
        return {
          ok: true as const,
          applied: false,
          planId: v.planId,
          monthlyCapKrw: v.monthlyCapKrw,
          affectedCount: affectedOrganizations.length,
          affectedOrganizations,
        };
      }

      await sql.query(
        `insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw, affected_org_count, note, updated_by, updated_at)
           values ($1, $2, $3, $4, $5, now())
         on conflict (plan_id) do update
           set monthly_cap_krw = excluded.monthly_cap_krw,
               affected_org_count = excluded.affected_org_count,
               note = excluded.note,
               updated_by = excluded.updated_by,
               updated_at = now()`,
        [v.planId, v.monthlyCapKrw, affectedOrganizations.length, v.note, adminId],
      );

      if (await hasTable(sql, 'brand_plan_allowance_default_events')) {
        await sql.query(
          `insert into brand_plan_allowance_default_events (
             id, plan_id, previous_cap_krw, monthly_cap_krw, affected_org_count, note, actor_id, created_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
          [
            randomUUID(),
            v.planId,
            previousCapKrw,
            v.monthlyCapKrw,
            affectedOrganizations.length,
            v.note,
            adminId,
            nowDate.toISOString(),
          ],
        );
      }

      // Sync rollback snapshot for all non-override orgs on this plan, INCLUDING those with NO allowance row yet.
      for (const org of orgRows) {
        if (org.is_override === true) continue;
        await syncPlanDefaultSnapshot(sql, String(org.organization_id), adminId, { now: nowDate, graceDays });
      }

      return {
        ok: true as const,
        applied: true,
        planId: v.planId,
        monthlyCapKrw: v.monthlyCapKrw,
        affectedCount: affectedOrganizations.length,
        affectedOrganizations,
      };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

const PlanAndAllowanceInput = z
  .object({
    organizationId: UUID,
    planId: z.enum(BRAND_PLAN_IDS),
    billingMode: z.enum(BRAND_BILLING_MODES).default('invoice'),
    startedOn: CalendarDay,
    endsOn: CalendarDay.nullable().default(null),
    seats: z.number().int().min(1).max(1000).nullable().default(null),
    planNote: z.string().trim().max(500).default(''),
    expectedRevision: z.number().int().min(0),
    allowanceMode: z.enum(['plan_default', 'override']),
    monthlyCapKrw: z.number().int().min(0).max(100_000_000).nullable().default(null),
    preferredLane: z.enum(STUDIO_LANES).nullable().optional(),
    allowanceNote: z.string().trim().max(500).default(''),
  })
  .refine((v) => v.endsOn === null || v.endsOn > v.startedOn, {
    path: ['endsOn'],
    message: 'ends before it starts',
  })
  .refine((v) => v.allowanceMode === 'plan_default' || v.monthlyCapKrw !== null, {
    path: ['monthlyCapKrw'],
    message: 'monthlyCapKrw is required when allowanceMode is override',
  });

/**
 * Atomically update an organization's plan assignment AND its monthly allowance mode
 * (`plan_default` vs explicit `override`) in one admin operation so operators never drift out of sync.
 */
export async function setPlanAndAllowance(
  deps: { sql: SqlRunner; now?: () => Date },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ id: string; revision: number }>> {
  const parsed = PlanAndAllowanceInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!(await sql.query('select id from brand_organizations where id = $1 for update', [v.organizationId])).rows[0]) {
        return { ok: false as const, code: 'not_found' as const };
      }
      const schema = await loadAllowanceSchemaState(sql);
      if (!schema.hasPlanAssignments) return { ok: false as const, code: 'unavailable' as const };
      if (v.allowanceMode === 'plan_default' && !schema.hasOverrideCol) {
        return { ok: false as const, code: 'unavailable' as const };
      }

      const current = (
        await sql.query<{ revision: number }>('select revision from brand_plan_assignments where organization_id = $1 for update', [
          v.organizationId,
        ])
      ).rows[0];
      const revision = current ? Number(current.revision) : 0;
      if (revision !== v.expectedRevision) return { ok: false as const, code: 'conflict' as const };
      // B1c: moving the start day moves the billing cycle; refused while a subscription invoice covers today or later.
      if (current && (await startDayMoveBlocked(sql, v.organizationId, v.startedOn, kstDayOf(deps.now?.() ?? new Date())))) {
        return { ok: false as const, code: 'conflict' as const, detail: CYCLE_ALREADY_INVOICED };
      }
      const next = revision + 1;

      await sql.query(
        `insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, seats, note, revision, updated_by, updated_at)
           values ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, now())
         on conflict (organization_id) do update
           set plan_id = excluded.plan_id,
               billing_mode = excluded.billing_mode,
               started_on = excluded.started_on,
               ends_on = excluded.ends_on,
               seats = excluded.seats,
               note = excluded.note,
               revision = excluded.revision,
               updated_by = excluded.updated_by,
               updated_at = now()`,
        [v.organizationId, v.planId, v.billingMode, v.startedOn, v.endsOn, v.seats, v.planNote, next, adminId],
      );
      await sql.query(
        `insert into brand_plan_events (organization_id, plan_id, billing_mode, started_on, ends_on, seats, note, actor_id)
           values ($1, $2, $3, $4::date, $5::date, $6, $7, $8)`,
        [v.organizationId, v.planId, v.billingMode, v.startedOn, v.endsOn, v.seats, v.planNote, adminId],
      );

      if (schema.hasAllowancesTable) {
        const existingAllowance = (
          await sql.query<{ monthly_cap_krw: number; preferred_lane: string | null }>(
            'select monthly_cap_krw, preferred_lane from brand_studio_allowances where organization_id = $1 for update',
            [v.organizationId],
          )
        ).rows[0];
        const lane = v.preferredLane !== undefined ? v.preferredLane : (existingAllowance?.preferred_lane ?? null);
        const planIsActive = planActiveWithGrace(
          { startedOn: v.startedOn, endsOn: v.endsOn },
          kstDayOf(new Date()),
          planGraceDaysFromEnv(),
        ).active;
        const planDefaultSnapshot =
          v.allowanceMode === 'plan_default' && planIsActive ? ((await loadPlanAllowanceDefault(sql, v.planId)) ?? 0) : 0;
        const capKrw = v.allowanceMode === 'override' ? v.monthlyCapKrw! : planDefaultSnapshot;
        const isOverride = v.allowanceMode === 'override';

        if (schema.hasOverrideCol) {
          await sql.query(
            `insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, preferred_lane, note, updated_by, updated_at)
               values ($1, $2, $3, $4, $5, $6, now())
             on conflict (organization_id) do update
               set monthly_cap_krw = excluded.monthly_cap_krw,
                   is_override = excluded.is_override,
                   preferred_lane = excluded.preferred_lane,
                   note = excluded.note,
                   updated_by = excluded.updated_by,
                   updated_at = now()`,
            [v.organizationId, capKrw, isOverride, lane, v.allowanceNote, adminId],
          );
        } else {
          await sql.query(
            `insert into brand_studio_allowances (organization_id, monthly_cap_krw, preferred_lane, note, updated_by, updated_at)
               values ($1, $2, $3, $4, $5, now())
             on conflict (organization_id) do update
               set monthly_cap_krw = excluded.monthly_cap_krw,
                   preferred_lane = excluded.preferred_lane,
                   note = excluded.note,
                   updated_by = excluded.updated_by,
                   updated_at = now()`,
            [v.organizationId, capKrw, lane, v.allowanceNote, adminId],
          );
        }
      }

      return { ok: true as const, id: v.organizationId, revision: next };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

/* ------------------------------------------------------------------ extra credit grants */

const GrantExtraInput = z
  .object({
    organizationId: UUID,
    amountKrw: z.number().int().min(1).max(100_000_000),
    validMonth: YearMonth,
    reason: z.string().trim().max(500).default(''),
  })
  .strict();

const RevokeExtraInput = z.object({
  grantId: UUID,
  organizationId: UUID.optional(),
});

export async function loadActiveExtraGrantsTotal(
  sql: SqlRunner,
  organizationId: string,
  now: Date = new Date(),
): Promise<number> {
  if (!UUID.safeParse(organizationId).success) return 0;
  if (!(await hasTable(sql, 'brand_allowance_grants'))) return 0;
  const month = kstMonthOf(now);
  const row = (
    await sql.query<{ extra: string | number }>(
      `select coalesce(sum(amount_krw), 0)::bigint as extra
         from brand_allowance_grants
        where organization_id = $1
          and revoked_at is null
          and valid_month = $2`,
      [organizationId, month],
    )
  ).rows[0];
  return Math.max(0, Number(row?.extra ?? 0));
}

type GrantInput = z.infer<typeof GrantExtraInput>;

/** The checks every grant passes before anything is written: amount, month (this KST month or the next), reason. */
function checkGrantInput(
  input: unknown,
  now: Date,
): { ok: true; value: GrantInput } | { ok: false; code: 'invalid'; field: string } {
  const parsed = GrantExtraInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  if (!isAllowedGrantMonth(parsed.data.validMonth, now)) {
    return { ok: false, code: 'invalid', field: 'validMonth' };
  }
  return { ok: true, value: parsed.data };
}

/**
 * The grant insert, inside the caller's transaction. Without `kind` it is exactly the statement the manual operation
 * has always run (the row takes the column default, `extra`). With `kind` (migration 0184, `BRAND_WORKSPACE_APPROVAL`
 * callers only) it also writes `kind` / `carried_from` and yields to the unique rules (one original trial per
 * organization, one carry per grant): `id: null` when such a row already exists.
 */
export async function insertAllowanceGrantInTx(
  sql: SqlRunner,
  input: unknown,
  options: { createdBy: string | null; now: Date; kind?: 'trial'; carriedFrom?: string | null },
): Promise<{ ok: true; id: string | null } | { ok: false; code: 'invalid'; field: string }> {
  const checked = checkGrantInput(input, options.now);
  if (!checked.ok) return checked;
  const v = checked.value;
  const id = randomUUID();
  if (options.kind === undefined) {
    await sql.query(
      `insert into brand_allowance_grants (id, organization_id, amount_krw, valid_month, reason, created_by)
         values ($1, $2, $3, $4, $5, $6)`,
      [id, v.organizationId, v.amountKrw, v.validMonth, v.reason, options.createdBy],
    );
    return { ok: true, id };
  }
  const row = (
    await sql.query<{ id: string }>(
      `insert into brand_allowance_grants (id, organization_id, amount_krw, valid_month, reason, created_by, kind, carried_from)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict do nothing
       returning id`,
      [id, v.organizationId, v.amountKrw, v.validMonth, v.reason, options.createdBy, options.kind, options.carriedFrom ?? null],
    )
  ).rows[0];
  return { ok: true, id: row ? String(row.id) : null };
}

export async function grantExtraAllowance(
  deps: { sql: SqlRunner; now?: () => Date },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ id: string }>> {
  const nowDate = deps.now?.() ?? new Date();
  const checked = checkGrantInput(input, nowDate);
  if (!checked.ok) return checked;
  const v = checked.value;
  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!(await hasTable(sql, 'brand_allowance_grants'))) return { ok: false as const, code: 'unavailable' as const };
      if (!(await sql.query('select id from brand_organizations where id = $1 for update', [v.organizationId])).rows[0]) {
        return { ok: false as const, code: 'not_found' as const };
      }
      const inserted = await insertAllowanceGrantInTx(sql, v, { createdBy: adminId, now: nowDate });
      if (!inserted.ok) return inserted;
      return { ok: true as const, id: inserted.id! };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

export async function revokeExtraAllowance(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown,
): Promise<BrandBillingOutcome<{ id: string; organizationId: string }>> {
  const parsed = RevokeExtraInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  try {
    return await deps.sql.transaction(async (sql) => {
      const adminId = await requireDbAdmin(sql, viewer);
      if (!(await hasTable(sql, 'brand_allowance_grants'))) return { ok: false as const, code: 'unavailable' as const };
      const row = (
        await sql.query<{ id: string; organization_id: string; revoked_at: unknown }>(
          'select id, organization_id, revoked_at from brand_allowance_grants where id = $1 for update',
          [v.grantId],
        )
      ).rows[0];
      if (!row || (v.organizationId && row.organization_id !== v.organizationId)) {
        return { ok: false as const, code: 'not_found' as const };
      }
      if (row.revoked_at !== null) {
        return { ok: false as const, code: 'conflict' as const };
      }
      await sql.query('update brand_allowance_grants set revoked_at = now(), revoked_by = $2 where id = $1', [
        v.grantId,
        adminId,
      ]);
      // B1b: revoking an original trial grant also revokes what was carried from it, with the same audit trail, so no
      // trial credit stays active. Only with BRAND_WORKSPACE_APPROVAL on and 0184 applied; off, as before.
      if (brandWorkspaceApprovalOpen() && (await loadWorkspaceApprovalSchemaReady(sql))) {
        await sql.query(
          'update brand_allowance_grants set revoked_at = now(), revoked_by = $2 where carried_from = $1 and revoked_at is null',
          [v.grantId, adminId],
        );
      }
      return { ok: true as const, id: String(row.id), organizationId: String(row.organization_id) };
    });
  } catch (error) {
    return outcomeError(error);
  }
}

export async function listExtraAllowanceGrants(
  sql: SqlRunner,
  organizationId: string,
  now: Date = new Date(),
): Promise<BrandAllowanceGrant[]> {
  if (!UUID.safeParse(organizationId).success) return [];
  if (!(await hasTable(sql, 'brand_allowance_grants'))) return [];
  const month = kstMonthOf(now);
  // The grant kind (0184) is read only with BRAND_WORKSPACE_APPROVAL on and the columns present; off, the query is as before.
  const withKind = brandWorkspaceApprovalOpen() && (await loadWorkspaceApprovalSchemaReady(sql));
  const { rows } = await sql.query<{
    id: string;
    organization_id: string;
    amount_krw: number;
    valid_month: string;
    reason: string;
    created_by: string | null;
    created_at: unknown;
    revoked_at: unknown;
    revoked_by: string | null;
    kind?: string;
    carried_from?: string | null;
  }>(
    withKind
      ? `select id, organization_id, amount_krw, valid_month, reason,
            created_by, created_at, revoked_at, revoked_by, kind, carried_from
       from brand_allowance_grants
      where organization_id = $1
      order by created_at desc, id desc`
      : `select id, organization_id, amount_krw, valid_month, reason,
            created_by, created_at, revoked_at, revoked_by
       from brand_allowance_grants
      where organization_id = $1
      order by created_at desc, id desc`,
    [organizationId],
  );
  return rows.map((r) => {
    const revokedAt = stamp(r.revoked_at);
    const validMonth = String(r.valid_month);
    const activeNow = revokedAt === null && validMonth === month;
    return {
      id: String(r.id),
      organizationId: String(r.organization_id),
      amountKrw: Number(r.amount_krw),
      validMonth,
      reason: String(r.reason ?? ''),
      activeNow,
      createdBy: r.created_by ? String(r.created_by) : null,
      createdAt: stamp(r.created_at) ?? new Date(0).toISOString(),
      revokedAt,
      revokedBy: r.revoked_by ? String(r.revoked_by) : null,
      ...(withKind
        ? {
            kind: (r.kind === 'trial' || r.kind === 'pack' ? r.kind : 'extra') as BrandAllowanceGrantKind,
            carriedFrom: r.carried_from ? String(r.carried_from) : null,
          }
        : {}),
    };
  });
}
