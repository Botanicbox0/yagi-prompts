import type { SqlRunner } from '@/lib/db/sql-runner';
import { loadPlanAssignment, planActiveOn } from '@/lib/brands/plans';

export interface FirstRunChecklistState {
  show: boolean;
  hasTeammate: boolean;
  hasLogo: boolean;
  hasUploads: boolean;
  usageApproved: boolean;
  hasFirstImage: boolean;
}

const CHECKLIST_MAX_AGE_MS = 30 * 86_400_000;

function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

async function tableExists(sql: SqlRunner, table: string): Promise<boolean> {
  const row = (await sql.query<{ t: string | null }>('select to_regclass($1)::text as t', [`public.${table}`])).rows[0];
  return Boolean(row?.t);
}

/**
 * Derives `/brand/home`'s dismissable first-run checklist strictly from existing workspace tables
 * without adding any schema/migration. Only shows while the workspace is new (<= 30 days) and
 * incomplete; counts only active memberships.
 */
export async function loadFirstRunChecklistState(
  sql: SqlRunner,
  organizationId: string,
  context: { capKrw?: number | null; logoUrl?: string | null; now?: Date },
): Promise<FirstRunChecklistState> {
  const now = context.now ?? new Date();
  const [orgRow, hasMemberships, hasInvites, hasAssets, hasJobs, plan] = await Promise.all([
    sql
      .query<{ created_at: Date | string }>('select created_at from brand_organizations where id = $1', [organizationId])
      .then((r) => r.rows[0] ?? null),
    tableExists(sql, 'brand_memberships'),
    tableExists(sql, 'brand_invites'),
    tableExists(sql, 'brand_studio_assets'),
    tableExists(sql, 'brand_studio_jobs'),
    loadPlanAssignment(sql, organizationId).catch(() => null),
  ]);

  const createdMs = orgRow ? new Date(orgRow.created_at).getTime() : NaN;
  const isWithin30Days = Number.isFinite(createdMs) && now.getTime() - createdMs <= CHECKLIST_MAX_AGE_MS;

  const [memberRow, inviteRow, assetRow, imageRow] = await Promise.all([
    hasMemberships
      ? sql
          .query<{ n: string | number }>(
            "select count(*)::int as n from brand_memberships where organization_id = $1 and status = 'active'",
            [organizationId],
          )
          .then((r) => Number(r.rows[0]?.n ?? 0))
      : Promise.resolve(0),
    hasInvites
      ? sql
          .query<{ n: string | number }>(
            'select count(*)::int as n from brand_invites where organization_id = $1 and accepted_at is null and revoked_at is null and expires_at > now()',
            [organizationId],
          )
          .then((r) => Number(r.rows[0]?.n ?? 0))
      : Promise.resolve(0),
    hasAssets
      ? sql
          .query<{ n: string | number }>(
            "select count(*)::int as n from brand_studio_assets where organization_id = $1 and deleted_at is null and status = 'ready'",
            [organizationId],
          )
          .then((r) => Number(r.rows[0]?.n ?? 0))
      : Promise.resolve(0),
    hasJobs
      ? sql
          .query<{ n: string | number }>(
            "select count(*)::int as n from brand_studio_jobs where organization_id = $1 and deleted_at is null and kind = 'image' and status = 'succeeded'",
            [organizationId],
          )
          .then((r) => Number(r.rows[0]?.n ?? 0))
      : Promise.resolve(0),
  ]);

  const hasTeammate = memberRow > 1 || inviteRow > 0;
  const hasLogo = Boolean(context.logoUrl);
  const hasUploads = assetRow > 0;
  const usageApproved = (context.capKrw ?? 0) > 0 || planActiveOn(plan, todayKst(now));
  const hasFirstImage = imageRow > 0;

  const show = isWithin30Days && !(hasTeammate && hasLogo && hasUploads && usageApproved && hasFirstImage);

  return {
    show,
    hasTeammate,
    hasLogo,
    hasUploads,
    usageApproved,
    hasFirstImage,
  };
}
