import type { SqlRunner } from '@/lib/db/sql-runner';
import { loadPlanAssignment, planActiveOn } from '@/lib/brands/plans';

export type ChecklistUsageState = 'not_requested' | 'requested' | 'ready';

export interface FirstRunChecklistState {
  show: boolean;
  hasTeammate: boolean;
  hasLogo: boolean;
  hasUploads: boolean;
  usageApproved: boolean;
  usageRequestSent?: boolean;
  usageState?: ChecklistUsageState;
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
 * Whether this organization has already sent a studio access request: an `allowance_request` notice, or
 * a `plan_request` notice that is not a plain plan question (`billing:plan_question…` surface). Shared by
 * `/brand/home`'s checklist and the closed studio banner (`GET /api/brand-workspace/access-request`).
 * False when the notice outbox table does not exist yet.
 */
export async function loadUsageRequestSent(sql: SqlRunner, organizationId: string): Promise<boolean> {
  if (!(await tableExists(sql, 'team_notice_deliveries'))) return false;
  const row = (
    await sql.query<{ sent: boolean }>(
      "select exists(select 1 from team_notice_deliveries where organization_id = $1 and (kind = 'allowance_request' or (kind = 'plan_request' and (surface is null or surface not like 'billing:plan_question%')))) as sent",
      [organizationId],
    )
  ).rows[0];
  return Boolean(row?.sent);
}

/** How long a sent request is still read as "waiting for the team" by the closed studio. */
export const USAGE_REQUEST_PENDING_DAYS = 30;

/**
 * Whether a studio access request is still WAITING: the rule above, narrowed to requests sent in the last
 * `USAGE_REQUEST_PENDING_DAYS` days and after the team's latest answer (the workspace approval, or the
 * current plan assignment being written). The closed studio banner is shown whenever the allowance is
 * closed, with no 30-day window of its own, so without this a workspace whose credits ran out months
 * after its first request would be told the request "was received" and never send a new one.
 */
export async function loadUsageRequestPending(sql: SqlRunner, organizationId: string): Promise<boolean> {
  if (!(await tableExists(sql, 'team_notice_deliveries'))) return false;
  const [hasApprovals, hasPlans] = await Promise.all([
    tableExists(sql, 'brand_workspace_approvals'),
    tableExists(sql, 'brand_plan_assignments'),
  ]);
  const answered = [
    hasApprovals ? '(select approved_at from brand_workspace_approvals where organization_id = $1)' : null,
    hasPlans ? '(select updated_at from brand_plan_assignments where organization_id = $1)' : null,
  ].filter((part): part is string => part !== null);
  const since = `greatest(now() - make_interval(days => ${USAGE_REQUEST_PENDING_DAYS})${answered.map((part) => `, ${part}`).join('')})`;
  const row = (
    await sql.query<{ pending: boolean }>(
      `select exists(select 1 from team_notice_deliveries where organization_id = $1 and created_at > ${since} and (kind = 'allowance_request' or (kind = 'plan_request' and (surface is null or surface not like 'billing:plan_question%')))) as pending`,
      [organizationId],
    )
  ).rows[0];
  return Boolean(row?.pending);
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
            "select count(*)::int as n from brand_studio_jobs where organization_id = $1 and deleted_at is null and kind = 'image' and status = 'succeeded' and coalesce(params->>'edited', '') <> 'true'",
            [organizationId],
          )
          .then((r) => Number(r.rows[0]?.n ?? 0))
      : Promise.resolve(0),
  ]);

  const hasTeammate = memberRow > 1 || inviteRow > 0;
  const hasLogo = Boolean(context.logoUrl);
  const hasUploads = assetRow > 0;
  const usageApproved = (context.capKrw ?? 0) > 0 || planActiveOn(plan, todayKst(now));
  const usageRequestSent = await loadUsageRequestSent(sql, organizationId);
  const usageState: ChecklistUsageState = usageApproved
    ? 'ready'
    : usageRequestSent
      ? 'requested'
      : 'not_requested';
  const hasFirstImage = imageRow > 0;

  const show = isWithin30Days && !(hasTeammate && hasLogo && hasUploads && usageApproved && hasFirstImage);

  return {
    show,
    hasTeammate,
    hasLogo,
    hasUploads,
    usageApproved,
    usageRequestSent,
    usageState,
    hasFirstImage,
  };
}
