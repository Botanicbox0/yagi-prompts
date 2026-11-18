/**
 * Credits each member used this month (docs/BRAND-STUDIO-V3.md §3, the team page).
 *
 * Same month and same filter as the allowance (./usage.ts `usedKrwIn`): the Asia/Seoul calendar month,
 * each job counted in whole credits (`jobUsageKrwSql`), failed and canceled jobs excluded. Grouped by the job's
 * `created_by`; a job whose author's profile is gone groups under `userId: null`.
 *
 * No access check here: the caller has already authorized the viewer for this organization's team
 * (lib/brands/workspace/service.ts `loadBrandMembers`) and decided the studio is visible to it. The
 * amounts stay KRW; screens turn them into credits (./credits.ts).
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { jobUsageKrwSql, studioMonthWindow } from './usage';

export interface MemberUsageRow {
  userId: string | null;
  email: string | null;
  displayName: string | null;
  usedKrw: number;
  runs: number;
}

export async function memberUsage(sql: SqlRunner, organizationId: string, now: Date = new Date()): Promise<MemberUsageRow[]> {
  const window = studioMonthWindow(now);
  const rows = (
    await sql.query<{ user_id: string | null; email: string | null; display_name: string | null; used: string | number; runs: string | number }>(
      `select j.created_by as user_id, p.email, p.display_name,
              coalesce(sum(${jobUsageKrwSql('j')}), 0)::bigint as used, count(*)::int as runs
         from brand_studio_jobs j
         left join profiles p on p.id = j.created_by
        where j.organization_id = $1 and j.status not in ('failed','canceled') and j.created_at >= $2 and j.created_at < $3
        group by j.created_by, p.email, p.display_name`,
      [organizationId, window.start.toISOString(), window.end.toISOString()],
    )
  ).rows;
  return rows
    .map((r) => ({
      userId: r.user_id == null ? null : String(r.user_id),
      email: r.email == null ? null : String(r.email),
      displayName: r.display_name == null || String(r.display_name).trim() === '' ? null : String(r.display_name),
      usedKrw: Number(r.used ?? 0),
      runs: Number(r.runs ?? 0),
    }))
    .sort((a, b) => b.usedKrw - a.usedKrw || b.runs - a.runs || String(a.userId).localeCompare(String(b.userId)));
}
