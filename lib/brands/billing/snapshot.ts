import { planGraceDaysFromEnv } from '@/lib/brand-studio/env';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { kstDayOf, PAID_BRAND_PLAN_IDS, planActiveWithGrace } from './math';
import { loadAllowanceSchemaState } from './schema-guard';

/**
 * Keep `brand_studio_allowances.monthly_cap_krw` synced as a rollback snapshot for organizations
 * following the plan default (`is_override = false` or no row yet).
 *
 * Pre-0176 code does not understand `is_override`, plan end/grace expiry, or extra credit grants,
 * so rolling back to older code reads this snapshot column directly. Explicit overrides
 * (`is_override = true`) are never overwritten. Safe on unmigrated DBs.
 */
export async function syncPlanDefaultSnapshot(
  sql: SqlRunner,
  organizationId: string,
  actorId: string | null,
  options: { now?: Date; graceDays?: number } = {},
): Promise<void> {
  const schema = await loadAllowanceSchemaState(sql);
  if (
    !schema.hasAllowancesTable ||
    !schema.hasOverrideCol ||
    !schema.hasPlanAssignments ||
    !schema.hasPlanDefaults
  ) {
    return;
  }

  const existing = (
    await sql.query<{ is_override: boolean }>(
      'select is_override from brand_studio_allowances where organization_id = $1 for update',
      [organizationId],
    )
  ).rows[0];
  if (existing && existing.is_override === true) return;

  const planRow = (
    await sql.query<{
      plan_id: string;
      started_on: string;
      ends_on: string | null;
      default_cap: number | null;
    }>(
      `select p.plan_id, p.started_on::text as started_on, p.ends_on::text as ends_on,
              d.monthly_cap_krw as default_cap
         from brand_plan_assignments p
         left join brand_plan_allowance_defaults d on d.plan_id = p.plan_id
        where p.organization_id = $1`,
      [organizationId],
    )
  ).rows[0];

  const nowDate = options.now ?? new Date();
  const graceDays = options.graceDays ?? planGraceDaysFromEnv();
  const isPaidPlan = Boolean(planRow && (PAID_BRAND_PLAN_IDS as readonly string[]).includes(planRow.plan_id));
  const isActive =
    planRow && isPaidPlan
      ? planActiveWithGrace(
          { startedOn: String(planRow.started_on), endsOn: planRow.ends_on == null ? null : String(planRow.ends_on) },
          kstDayOf(nowDate),
          graceDays,
        ).active
      : false;
  const hasDefault = isActive && planRow?.default_cap !== null && planRow?.default_cap !== undefined;

  if (!existing && !hasDefault) return;

  const snapshotCap = hasDefault ? Number(planRow!.default_cap) : 0;
  await sql.query(
    `insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, preferred_lane, note, updated_by, updated_at)
       values ($1, $2, false, null, '', $3, now())
     on conflict (organization_id) do update
       set monthly_cap_krw = excluded.monthly_cap_krw,
           updated_by = excluded.updated_by,
           updated_at = now()
     where brand_studio_allowances.is_override = false`,
    [organizationId, snapshotCap, actorId],
  );
}
