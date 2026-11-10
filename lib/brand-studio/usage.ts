/**
 * Monthly usage allowance (docs/BRAND-STUDIO-V2.md §9).
 *
 * Usage (KRW) = provider cost (USD) x the existing exchange rate x (1 + the existing brand margin).
 * The arithmetic lives in ./usage-rate.ts (client-safe, so the prompt dock shows the same figure the
 * server reserves) and is re-exported here. The number is a deduction from a monthly allowance the
 * studio sets per organization, not a charge.
 *
 * A job reserves its estimate when it is created (the organization row is locked, so two requests
 * cannot both spend the last of the month), and the estimate is replaced by the settled amount when
 * it finishes. Failed and canceled jobs count for nothing.
 */
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StudioAllowanceView } from './contracts';
import { STUDIO_LANES, type StudioLane } from './models';

export { usageKrw } from './usage-rate';

const KST_OFFSET_MS = 9 * 3_600_000;

/** The Asia/Seoul calendar month containing `now`, as UTC instants (Korea has no daylight saving). */
export function studioMonthWindow(now: Date): { start: Date; end: Date } {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1) - KST_OFFSET_MS),
    end: new Date(Date.UTC(y, m + 1, 1) - KST_OFFSET_MS),
  };
}

export interface StudioAllowance {
  capKrw: number;
  usedKrw: number;
  resetsAt: string;
  preferredLane: StudioLane | null;
  /** False when no row exists and the default applies. */
  configured: boolean;
}

export async function usedKrwIn(sql: SqlRunner, organizationId: string, window: { start: Date; end: Date }): Promise<number> {
  const row = (
    await sql.query<{ used: string | number }>(
      `select coalesce(sum(coalesce(usage_krw, estimate_krw)), 0)::bigint as used from brand_studio_jobs
        where organization_id = $1 and status not in ('failed','canceled') and created_at >= $2 and created_at < $3`,
      [organizationId, window.start.toISOString(), window.end.toISOString()],
    )
  ).rows[0];
  return Number(row?.used ?? 0);
}

export async function loadAllowance(
  sql: SqlRunner,
  organizationId: string,
  env: { defaultMonthlyKrw: number },
  now: Date = new Date(),
): Promise<StudioAllowance> {
  const row = (
    await sql.query<{ monthly_cap_krw: number; preferred_lane: string | null }>(
      'select monthly_cap_krw, preferred_lane from brand_studio_allowances where organization_id = $1',
      [organizationId],
    )
  ).rows[0];
  const window = studioMonthWindow(now);
  const lane = row?.preferred_lane ?? null;
  return {
    capKrw: row ? Number(row.monthly_cap_krw) : env.defaultMonthlyKrw,
    usedKrw: await usedKrwIn(sql, organizationId, window),
    resetsAt: window.end.toISOString(),
    preferredLane: lane && (STUDIO_LANES as readonly string[]).includes(lane) ? (lane as StudioLane) : null,
    configured: Boolean(row),
  };
}

export function allowanceView(a: StudioAllowance): StudioAllowanceView {
  return { capKrw: a.capKrw, usedKrw: a.usedKrw, resetsAt: a.resetsAt };
}

export type AllowanceVerdict = { ok: true; allowance: StudioAllowance } | { ok: false; code: 'allowance_closed' | 'allowance_exhausted' };

/**
 * Lock the organization row, then check that `estimateKrw` still fits this month. Call inside the
 * transaction that inserts the job, so the check and the insert share one view: a second request
 * for the same organization waits on the lock and then sees the first one's reservation.
 */
export async function reserveAllowance(
  tx: SqlRunner,
  organizationId: string,
  estimateKrw: number,
  env: { defaultMonthlyKrw: number },
  now: Date = new Date(),
): Promise<AllowanceVerdict> {
  await tx.query('select id from brand_organizations where id = $1 for update', [organizationId]);
  const allowance = await loadAllowance(tx, organizationId, env, now);
  if (allowance.capKrw <= 0) return { ok: false, code: 'allowance_closed' };
  if (allowance.usedKrw + Math.max(0, estimateKrw) > allowance.capKrw) return { ok: false, code: 'allowance_exhausted' };
  return { ok: true, allowance };
}

/* ------------------------------------------------------------------ admin */

export interface StudioAllowanceRow {
  organizationId: string;
  monthlyCapKrw: number;
  preferredLane: StudioLane | null;
  note: string;
  updatedAt: string | null;
}

export async function loadAllowanceRow(sql: SqlRunner, organizationId: string): Promise<StudioAllowanceRow | null> {
  try {
    const row = (
      await sql.query<{ monthly_cap_krw: number; preferred_lane: string | null; note: string; updated_at: unknown }>(
        'select monthly_cap_krw, preferred_lane, note, updated_at from brand_studio_allowances where organization_id = $1',
        [organizationId],
      )
    ).rows[0];
    if (!row) return null;
    return {
      organizationId,
      monthlyCapKrw: Number(row.monthly_cap_krw),
      preferredLane: (STUDIO_LANES as readonly string[]).includes(row.preferred_lane ?? '') ? (row.preferred_lane as StudioLane) : null,
      note: String(row.note ?? ''),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at == null ? null : String(row.updated_at),
    };
  } catch (error) {
    // Before migration 0076 the admin page must still render.
    if ((error as { code?: string } | null)?.code === '42P01') return null;
    throw error;
  }
}

const AllowanceInput = z.object({
  organizationId: z.uuid(),
  monthlyCapKrw: z.number().int().min(0).max(100_000_000),
  preferredLane: z.enum(STUDIO_LANES).nullable(),
  note: z.string().trim().max(500).default(''),
});

export type SetAllowanceOutcome =
  | { ok: true; id: string }
  | { ok: false; code: 'sign_in_required' | 'forbidden' | 'not_found' | 'invalid'; field?: string };

/** Admin only. The profile row decides who is an administrator, never the viewer object. */
export async function setStudioAllowance(deps: { sql: SqlRunner }, viewer: Viewer, input: unknown): Promise<SetAllowanceOutcome> {
  if (!z.uuid().safeParse(viewer.userId).success) return { ok: false, code: 'sign_in_required' };
  const parsed = AllowanceInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  const v = parsed.data;
  return deps.sql.transaction(async (sql) => {
    const profile = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1 for share', [viewer.userId])).rows[0];
    if (!profile) return { ok: false as const, code: 'sign_in_required' as const };
    if (profile.is_admin !== true) return { ok: false as const, code: 'forbidden' as const };
    if (!(await sql.query('select id from brand_organizations where id = $1 for update', [v.organizationId])).rows[0])
      return { ok: false as const, code: 'not_found' as const };
    await sql.query(
      `insert into brand_studio_allowances (organization_id, monthly_cap_krw, preferred_lane, note, updated_by, updated_at)
         values ($1, $2, $3, $4, $5, now())
       on conflict (organization_id) do update
         set monthly_cap_krw = excluded.monthly_cap_krw, preferred_lane = excluded.preferred_lane,
             note = excluded.note, updated_by = excluded.updated_by, updated_at = now()`,
      [v.organizationId, v.monthlyCapKrw, v.preferredLane, v.note, viewer.userId],
    );
    return { ok: true as const, id: v.organizationId };
  });
}
