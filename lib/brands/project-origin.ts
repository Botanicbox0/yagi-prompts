/**
 * docs/BRAND-PROJECT-SPINE.md §3.4, the second layer: a project a customer made for their own filing
 * (`brand_projects.origin = 'self'`, migration 0194) never appears in, is counted by, is opened by, or notifies
 * anything on the YAGI-team side. Most team-side reads are already closed by `client_visible` (a 'self' row is
 * always hidden, a table check since 0194). Every other team-side read or write — a list or count that does not
 * look at `client_visible`, and every read or write that takes a project id from a staff, admin or worker caller —
 * adds this predicate. tests/brand-studio/spine/team-guard.test.ts keeps the list.
 *
 * It must work before migration 0194 is applied (the code deploys first), when `origin` does not exist yet:
 * the row is read as jsonb, so a missing column reads as null, and null counts as 'team' (every row that
 * exists before 0194 is a team project). The same SQL text is correct in both states; nothing is probed.
 *
 * A leaf module on purpose (no runtime imports): the team-side modules and the spine both use it.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';

const ALIAS = /^[a-z_][a-z0-9_]*$/;

/**
 * `origin = 'team'` for the `brand_projects` row named `alias` in the query (`p`, `bp`, …), null-safe and
 * valid with or without the `origin` column. A row from an outer join that is null reads as team (it adds no
 * project to a list).
 */
export const TEAM_PROJECTS = (alias: string): string => {
  if (!ALIAS.test(alias)) throw new Error('TEAM_PROJECTS: alias');
  return `coalesce(to_jsonb(${alias}) ->> 'origin', 'team') = 'team'`;
};

const RECHECK_MS = 60_000;
let probe: { ready: boolean; at: number } | null = null;

/**
 * True once all four columns of migration 0194 exist (`brand_projects.origin` and `brand_project_id` on runs,
 * uploads and films). A miss is looked up again after a minute, so applying the migration needs no redeploy;
 * a hit is kept.
 */
export async function spineColumnsReady(sql: SqlRunner, now = Date.now()): Promise<boolean> {
  if (probe && (probe.ready || now - probe.at < RECHECK_MS)) return probe.ready;
  const found = await sql.query<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where table_schema = current_schema()
        and ((table_name = 'brand_projects' and column_name = 'origin')
          or (column_name = 'brand_project_id' and table_name in ('brand_studio_jobs', 'brand_studio_assets', 'brand_studio_video_projects')))`,
  );
  probe = { ready: Number(found.rows[0]?.n ?? 0) === 4, at: now };
  return probe.ready;
}

/** Forget the lookup (tests change the schema under one process). */
export function resetSpineProbe(): void {
  probe = null;
}
