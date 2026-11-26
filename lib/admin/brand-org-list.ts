import type { Viewer } from '@/lib/auth/identity';
import type { StudioEnv } from '@/lib/brand-studio/env';
import { STUDIO_CREDIT_KRW } from '@/lib/brand-studio/credits';
import type { AllowanceSource } from '@/lib/brand-studio/usage';
import { loadAllowance, studioMonthWindow } from '@/lib/brand-studio/usage';
import {
  BRAND_INVOICE_OVERDUE_DAYS,
  BRAND_PLAN_GRACE_DAYS_DEFAULT,
  kstDayOf,
  kstMonthOf,
  PAID_BRAND_PLAN_IDS,
  planActiveWithGrace,
} from '@/lib/brands/billing/math';
import { hasColumn, hasTables } from '@/lib/brands/billing/schema-guard';
import { confirmedPlanCapSql } from '@/lib/brands/billing/plan-credits';
import type { BrandBillingMode, BrandPlanId } from '@/lib/brands/plans';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { escapeLike, firstParam, isDbAdmin, iso } from './brand-ops-guard';
import { TEAM_PROJECTS } from '@/lib/brands/project-origin';

export const BRAND_ORG_FILTERS = [
  'all',
  'no_plan',
  'waiting_plan',
  'over_80',
  'overdue',
  'has_failures',
  'recent_7d',
] as const;
export type BrandOrgFilterKey = (typeof BRAND_ORG_FILTERS)[number];

export const BRAND_ORG_SORTS = [
  'last_activity',
  'created_desc',
  'name_asc',
  'usage_desc',
  'failures_desc',
] as const;
export type BrandOrgSortKey = (typeof BRAND_ORG_SORTS)[number];

export const BRAND_ORG_PAGE_SIZE = 25;

export interface BrandOrgListFilter {
  filter: BrandOrgFilterKey;
  sort: BrandOrgSortKey;
  query: string;
  page: number;
}

export interface BrandOrgListRow {
  id: string;
  name: string;
  createdAt: string;
  planId: BrandPlanId | null;
  billingMode: BrandBillingMode | null;
  planStartedOn: string | null;
  planEndsOn: string | null;
  planActive: boolean;
  planInGrace: boolean;
  planExpired: boolean;
  usedKrw: number;
  baseCapKrw: number;
  extraKrw: number;
  capKrw: number;
  allowanceSource: AllowanceSource;
  usagePercent: number | null;
  activeDiscount: {
    percent: number;
    invoicesTotal: number | null;
    invoicesUsed: number;
    invoicesRemaining: number | null;
  } | null;
  unpaidInvoiceCount: number;
  overdueInvoiceCount: number;
  memberCount: number;
  lastActivityAt: string | null;
  failedJobs7d: number;
  hasUsageRequest: boolean;
  projectCount: number;
}

export interface BrandOrgListResult {
  rows: BrandOrgListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function brandOrgListFilter(params: Record<string, string | string[] | undefined>): BrandOrgListFilter {
  const rawFilter = firstParam(params.filter);
  const rawSort = firstParam(params.sort);
  const rawPage = Number.parseInt(firstParam(params.page), 10);
  return {
    filter: (BRAND_ORG_FILTERS as readonly string[]).includes(rawFilter)
      ? (rawFilter as BrandOrgFilterKey)
      : 'all',
    sort: (BRAND_ORG_SORTS as readonly string[]).includes(rawSort) ? (rawSort as BrandOrgSortKey) : 'last_activity',
    query: firstParam(params.q).trim().slice(0, 120),
    page: Number.isFinite(rawPage) && rawPage > 1 ? Math.min(rawPage, 10_000) : 1,
  };
}

export function brandOrgListHref(
  current: BrandOrgListFilter,
  patch: Partial<{ filter: BrandOrgFilterKey; sort: BrandOrgSortKey; query: string; page: number }> = {},
): string {
  const next: BrandOrgListFilter = {
    filter: 'filter' in patch ? (patch.filter ?? 'all') : current.filter,
    sort: 'sort' in patch ? (patch.sort ?? 'last_activity') : current.sort,
    query: 'query' in patch ? (patch.query ?? '') : current.query,
    page: 'page' in patch ? (patch.page ?? 1) : 1,
  };
  const sp = new URLSearchParams();
  if (next.filter !== 'all') sp.set('filter', next.filter);
  if (next.sort !== 'last_activity') sp.set('sort', next.sort);
  if (next.query.trim()) sp.set('q', next.query.trim());
  if (next.page > 1) sp.set('page', String(next.page));
  const qs = sp.toString();
  return qs ? `/admin/brand-workspace?${qs}` : '/admin/brand-workspace';
}

const ORDER_BY_SQL: Record<BrandOrgSortKey, string> = {
  last_activity: 'c.last_activity_at desc nulls last, c.created_at desc, c.id desc',
  created_desc: 'c.created_at desc, c.id desc',
  name_asc: 'lower(c.name) asc, c.created_at desc, c.id desc',
  usage_desc:
    'case when c.cap_krw > 0 then (c.used_krw::numeric / c.cap_krw::numeric) else -1 end desc, c.used_krw desc, c.created_at desc, c.id desc',
  failures_desc: 'c.failed_jobs_7d desc, c.last_activity_at desc nulls last, c.created_at desc, c.id desc',
};

/**
 * Loads the paginated, SQL-aggregated organization matrix for `/admin/brand-workspace`.
 * Executes ONE SQL query per page of rows after cached schema probes (no N+1).
 */
export async function loadBrandOrgList(
  sql: SqlRunner,
  viewer: Viewer,
  filter: BrandOrgListFilter,
  options: {
    env?: Pick<StudioEnv, 'defaultMonthlyKrw' | 'planGraceDays'>;
    now?: Date;
  } = {},
): Promise<BrandOrgListResult | null> {
  if (!(await isDbAdmin(sql, viewer))) return null;

  const now = options.now ?? new Date();
  const window = studioMonthWindow(now);
  const todayKst = kstDayOf(now);
  const currentMonth = kstMonthOf(now);
  const envDefaultMonthlyKrw = Math.max(0, options.env?.defaultMonthlyKrw ?? 0);
  const graceDaysRaw = options.env?.planGraceDays ?? BRAND_PLAN_GRACE_DAYS_DEFAULT;
  const graceDays = Number.isInteger(graceDaysRaw) && graceDaysRaw >= 0 ? graceDaysRaw : BRAND_PLAN_GRACE_DAYS_DEFAULT;
  const sevenDaysAgoIso = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const overdueCutoffIso = new Date(now.getTime() - BRAND_INVOICE_OVERDUE_DAYS * 86_400_000).toISOString();

  const [
    hasPlans,
    hasAllowances,
    hasPlanDefaults,
    hasGrants,
    hasDiscounts,
    hasInvoices,
    hasStudioJobs,
    hasSupportMsgs,
    hasBrandMsgs,
    hasRoomMsgs,
    hasTeamNotices,
    hasProjects,
    hasMemberships,
    hasOverrideCol,
  ] = await Promise.all([
    hasTables(sql, ['brand_plan_assignments']),
    hasTables(sql, ['brand_studio_allowances']),
    hasTables(sql, ['brand_plan_allowance_defaults']),
    hasTables(sql, ['brand_allowance_grants']),
    hasTables(sql, ['brand_discounts']),
    hasTables(sql, ['brand_invoices']),
    hasTables(sql, ['brand_studio_jobs']),
    hasTables(sql, ['brand_support_messages']),
    hasTables(sql, ['brand_messages']),
    hasTables(sql, ['brand_room_messages']),
    hasTables(sql, ['team_notice_deliveries']),
    hasTables(sql, ['brand_projects']),
    hasTables(sql, ['brand_memberships']),
    hasColumn(sql, 'brand_studio_allowances', 'is_override'),
  ]);

  // Fixed positional parameters so every optional CTE/expression stays clean and unambiguous:
  // $1: envDefaultMonthlyKrw (int)
  // $2: todayKst (YYYY-MM-DD)
  // $3: graceDays (int)
  // $4: monthStart (timestamptz)
  // $5: monthEnd (timestamptz)
  // $6: currentMonth (YYYY-MM)
  // $7: sevenDaysAgo (timestamptz)
  // $8: overdueCutoff (timestamptz)
  // $9: limit (int)
  // $10: offset (int)
  // $11 (optional): search LIKE pattern
  const params: unknown[] = [
    envDefaultMonthlyKrw,
    todayKst,
    graceDays,
    window.start.toISOString(),
    window.end.toISOString(),
    currentMonth,
    sevenDaysAgoIso,
    overdueCutoffIso,
    BRAND_ORG_PAGE_SIZE,
    (Math.max(1, Math.floor(filter.page)) - 1) * BRAND_ORG_PAGE_SIZE,
  ];

  let searchWhere = '';
  if (filter.query.trim() !== '') {
    params.push(`%${escapeLike(filter.query.trim())}%`);
    searchWhere = `where o.name ilike $11 escape '!'`;
  }

  const paidPlanList = PAID_BRAND_PLAN_IDS.map((id) => `'${id}'`).join(', ');
  const planActiveExpr = `p.plan_id is not null and p.started_on::text <= $2::text and (p.ends_on is null or $2::text < p.ends_on::text or ($3::int > 0 and ($2::date - p.ends_on) <= $3::int))`;

  const planSelect = hasPlans
    ? `p.plan_id, p.billing_mode, p.started_on::text as plan_started_on, p.ends_on::text as plan_ends_on,
       (${planActiveExpr}) as plan_active,
       (p.plan_id is not null and p.started_on::text <= $2::text and p.ends_on is not null and $2::text >= p.ends_on::text and $3::int > 0 and ($2::date - p.ends_on) <= $3::int) as plan_in_grace`
    : `null::text as plan_id, null::text as billing_mode, null::text as plan_started_on, null::text as plan_ends_on,
       false as plan_active, false as plan_in_grace`;

  const planJoin = hasPlans ? 'left join brand_plan_assignments p on p.organization_id = o.id' : '';

  const allowOverrideExpr = hasAllowances
    ? hasOverrideCol
      ? 'a.monthly_cap_krw is not null and a.is_override is distinct from false'
      : 'a.monthly_cap_krw is not null'
    : 'false';
  // R3 item 6: an active paid plan's cap is its stored default, or with none stored its confirmed credits
  // (`confirmedPlanCapSql`, the same constants `resolvePlanCapKrw` uses) — never the env default.
  const planDefaultCapExpr =
    hasPlans && hasPlanDefaults ? `(${planActiveExpr}) and p.plan_id in (${paidPlanList})` : 'false';
  const planCapValueExpr = hasPlanDefaults ? `coalesce(d.monthly_cap_krw::bigint, ${confirmedPlanCapSql('p.plan_id')})` : '0::bigint';

  const allowanceSourceExpr = `case
    when ${allowOverrideExpr} then 'override'
    when ${planDefaultCapExpr} then 'plan'
    else 'default'
  end`;

  const baseCapExpr = `greatest(0::bigint, case
    when ${allowOverrideExpr} then ${hasAllowances ? 'a.monthly_cap_krw::bigint' : '0::bigint'}
    when ${planDefaultCapExpr} then ${planCapValueExpr}
    else $1::bigint
  end)`;

  const extraExpr = hasGrants ? 'coalesce(gr.extra_krw, 0)::bigint' : '0::bigint';

  const ctes: string[] = [
    `_params as (
      select $1::bigint as env_default_krw,
             $2::text as today_kst,
             $3::int as grace_days,
             $4::timestamptz as month_start,
             $5::timestamptz as month_end,
             $6::text as current_month,
             $7::timestamptz as seven_days_ago,
             $8::timestamptz as overdue_cutoff,
             $9::int as page_limit,
             $10::int as page_offset
    )`,
  ];

  if (hasStudioJobs) {
    ctes.push(`job_agg as (
      select organization_id,
             coalesce(sum(
               case
                 when status not in ('failed', 'canceled') and created_at >= $4::timestamptz and created_at < $5::timestamptz
                 then ceil(coalesce(usage_krw, estimate_krw) / ${STUDIO_CREDIT_KRW}.0)::bigint * ${STUDIO_CREDIT_KRW}
                 else 0
               end
             ), 0)::bigint as used_krw,
             count(*) filter (
               where status = 'failed' and coalesce(finished_at, created_at) >= $7::timestamptz
             )::int as failed_jobs_7d,
             max(created_at) as last_job_at
        from brand_studio_jobs
       group by organization_id
    )`);
  }

  if (hasGrants) {
    ctes.push(`grant_agg as (
      select organization_id, coalesce(sum(amount_krw), 0)::bigint as extra_krw
        from brand_allowance_grants
       where revoked_at is null and valid_month = $6::text
       group by organization_id
    )`);
  }

  if (hasInvoices) {
    ctes.push(`invoice_agg as (
      select organization_id,
             count(*) filter (where status = 'issued')::int as unpaid_invoice_count,
             count(*) filter (where status = 'issued' and issued_at < $8::timestamptz)::int as overdue_invoice_count
        from brand_invoices
       group by organization_id
    )`);
  }

  if (hasMemberships) {
    ctes.push(`member_agg as (
      select organization_id, count(*) filter (where status = 'active')::int as member_count
        from brand_memberships
       group by organization_id
    )`);
  }

  if (hasProjects) {
    // Team projects only: a brand's own studio project is never counted on the team side (lib/brands/project-origin.ts).
    ctes.push(`project_agg as (
      select p.organization_id, count(*)::int as project_count
        from brand_projects p
       where ${TEAM_PROJECTS('p')}
       group by p.organization_id
    )`);
  }

  if (hasSupportMsgs) {
    ctes.push(`support_agg as (
      select organization_id,
             max(created_at) as last_support_at
        from brand_support_messages
       group by organization_id
    )`);
  }

  if (hasBrandMsgs) {
    ctes.push(`brand_msg_agg as (
      select organization_id, max(created_at) as last_brand_msg_at
        from brand_messages
       group by organization_id
    )`);
  }

  // The team's channels only ('general' and a project's own): a members line (보내기, 0200) is never the team's, not even its time.
  if (hasRoomMsgs) {
    ctes.push(`room_msg_agg as (
      select organization_id, max(created_at) as last_room_msg_at
        from brand_room_messages
       where deleted_at is null and kind = 'text'
         and (channel = 'general' or channel = project_id::text)
       group by organization_id
    )`);
  }

  if (hasTeamNotices) {
    ctes.push(`notice_req_agg as (
      select organization_id,
             bool_or(
               kind = 'allowance_request'
               or (
                 kind = 'plan_request'
                 and coalesce(surface, '') not like 'billing:plan_question%'
               )
             ) as has_notice_request
        from team_notice_deliveries
       where organization_id is not null
       group by organization_id
    )`);
  }

  const activityExprs = [
    hasStudioJobs ? 'ja.last_job_at' : null,
    hasSupportMsgs ? 'sa.last_support_at' : null,
    hasBrandMsgs ? 'bma.last_brand_msg_at' : null,
    hasRoomMsgs ? 'rma.last_room_msg_at' : null,
  ].filter((x): x is string => x !== null);

  const lastActivityExpr = activityExprs.length > 0 ? `greatest(${activityExprs.join(', ')})` : 'null::timestamptz';

  const hasUsageRequestExpr = hasTeamNotices ? 'coalesce(na.has_notice_request, false)' : 'false';

  ctes.push(`org_summary as (
    select
      o.id::text as id,
      o.name,
      o.created_at,
      ${planSelect},
      ${allowanceSourceExpr} as allowance_source,
      ${baseCapExpr}::bigint as base_cap_krw,
      ${extraExpr} as extra_krw,
      (${baseCapExpr} + ${extraExpr})::bigint as cap_krw,
      ${hasStudioJobs ? 'coalesce(ja.used_krw, 0)::bigint' : '0::bigint'} as used_krw,
      ${hasDiscounts ? 'disc.percent' : 'null::int'} as discount_percent,
      ${hasDiscounts ? 'disc.invoices_total' : 'null::int'} as discount_invoices_total,
      ${hasDiscounts ? 'disc.invoices_used' : 'null::int'} as discount_invoices_used,
      ${hasInvoices ? 'coalesce(ia.unpaid_invoice_count, 0)::int' : '0'} as unpaid_invoice_count,
      ${hasInvoices ? 'coalesce(ia.overdue_invoice_count, 0)::int' : '0'} as overdue_invoice_count,
      ${hasMemberships ? 'coalesce(ma.member_count, 0)::int' : '0'} as member_count,
      ${lastActivityExpr} as last_activity_at,
      ${hasStudioJobs ? 'coalesce(ja.failed_jobs_7d, 0)::int' : '0'} as failed_jobs_7d,
      ${hasUsageRequestExpr} as has_usage_request,
      ${hasProjects ? 'coalesce(pa.project_count, 0)::int' : '0'} as project_count
    from brand_organizations o
    ${planJoin}
    ${hasAllowances ? 'left join brand_studio_allowances a on a.organization_id = o.id' : ''}
    ${hasPlans && hasPlanDefaults ? 'left join brand_plan_allowance_defaults d on d.plan_id = p.plan_id' : ''}
    ${hasDiscounts ? "left join brand_discounts disc on disc.organization_id = o.id and disc.status = 'active'" : ''}
    ${hasStudioJobs ? 'left join job_agg ja on ja.organization_id = o.id' : ''}
    ${hasGrants ? 'left join grant_agg gr on gr.organization_id = o.id' : ''}
    ${hasInvoices ? 'left join invoice_agg ia on ia.organization_id = o.id' : ''}
    ${hasMemberships ? 'left join member_agg ma on ma.organization_id = o.id' : ''}
    ${hasProjects ? 'left join project_agg pa on pa.organization_id = o.id' : ''}
    ${hasSupportMsgs ? 'left join support_agg sa on sa.organization_id = o.id' : ''}
    ${hasBrandMsgs ? 'left join brand_msg_agg bma on bma.organization_id = o.id' : ''}
    ${hasRoomMsgs ? 'left join room_msg_agg rma on rma.organization_id = o.id' : ''}
    ${hasTeamNotices ? 'left join notice_req_agg na on na.organization_id = o.id' : ''}
    ${searchWhere}
  )`);

  let filterWhere = '';
  switch (filter.filter) {
    case 'no_plan':
      filterWhere = 'where c.plan_id is null';
      break;
    case 'waiting_plan':
      filterWhere = 'where c.plan_id is null and c.has_usage_request = true';
      break;
    case 'over_80':
      filterWhere = 'where c.cap_krw > 0 and (c.used_krw::numeric * 100) >= (c.cap_krw::numeric * 80)';
      break;
    case 'overdue':
      filterWhere = 'where c.overdue_invoice_count > 0';
      break;
    case 'has_failures':
      filterWhere = 'where c.failed_jobs_7d > 0';
      break;
    case 'recent_7d':
      filterWhere = 'where c.created_at >= $7::timestamptz';
      break;
    default:
      filterWhere = '';
  }

  const orderSql = ORDER_BY_SQL[filter.sort];

  const { rows: rawRows } = await sql.query<{
    id: string;
    name: string;
    created_at: unknown;
    plan_id: string | null;
    billing_mode: string | null;
    plan_started_on: string | null;
    plan_ends_on: string | null;
    plan_active: boolean;
    plan_in_grace: boolean;
    allowance_source: AllowanceSource;
    base_cap_krw: number;
    extra_krw: number;
    cap_krw: number;
    used_krw: number;
    discount_percent: number | null;
    discount_invoices_total: number | null;
    discount_invoices_used: number | null;
    unpaid_invoice_count: number;
    overdue_invoice_count: number;
    member_count: number;
    last_activity_at: unknown;
    failed_jobs_7d: number;
    has_usage_request: boolean;
    project_count: number;
    total_count: number;
  }>(
    `with ${ctes.join(',\n')}
     select c.*, count(*) over()::int as total_count
       from org_summary c
       ${filterWhere}
      order by ${orderSql}
      limit $9::int offset $10::int`,
    params,
  );

  let total = Number(rawRows[0]?.total_count ?? 0);
  if (rawRows.length === 0 && filter.page > 1) {
    const countRes = await sql.query<{ n: number }>(
      `with ${ctes.join(',\n')}
       select count(*)::int as n
         from org_summary c
         ${filterWhere}`,
      params,
    );
    total = Number(countRes.rows[0]?.n ?? 0);
  }

  const rows: BrandOrgListRow[] = rawRows.map((r) => {
    const planId = r.plan_id as BrandPlanId | null;
    const planActive = Boolean(r.plan_active);
    const planInGrace = Boolean(r.plan_in_grace);
    const planExpired =
      planId !== null &&
      r.plan_started_on !== null &&
      !planActive &&
      !planActiveWithGrace({ startedOn: r.plan_started_on, endsOn: r.plan_ends_on }, todayKst, graceDays).active &&
      r.plan_started_on <= todayKst;
    const capKrw = Number(r.cap_krw ?? 0);
    const usedKrw = Number(r.used_krw ?? 0);
    const usagePercent = capKrw > 0 ? Math.round((usedKrw / capKrw) * 100) : null;
    const discPct = r.discount_percent === null ? null : Number(r.discount_percent);
    const discTotal = r.discount_invoices_total === null ? null : Number(r.discount_invoices_total);
    const discUsed = Number(r.discount_invoices_used ?? 0);

    return {
      id: String(r.id),
      name: String(r.name),
      createdAt: iso(r.created_at) ?? '',
      planId,
      billingMode: r.billing_mode as BrandBillingMode | null,
      planStartedOn: r.plan_started_on,
      planEndsOn: r.plan_ends_on,
      planActive,
      planInGrace,
      planExpired,
      usedKrw,
      baseCapKrw: Number(r.base_cap_krw ?? 0),
      extraKrw: Number(r.extra_krw ?? 0),
      capKrw,
      allowanceSource: r.allowance_source,
      usagePercent,
      activeDiscount:
        discPct !== null
          ? {
              percent: discPct,
              invoicesTotal: discTotal,
              invoicesUsed: discUsed,
              invoicesRemaining: discTotal === null ? null : Math.max(0, discTotal - discUsed),
            }
          : null,
      unpaidInvoiceCount: Number(r.unpaid_invoice_count ?? 0),
      overdueInvoiceCount: Number(r.overdue_invoice_count ?? 0),
      memberCount: Number(r.member_count ?? 0),
      lastActivityAt: iso(r.last_activity_at),
      failedJobs7d: Number(r.failed_jobs_7d ?? 0),
      hasUsageRequest: Boolean(r.has_usage_request),
      projectCount: Number(r.project_count ?? 0),
    };
  });

  // B1c: a plan organization's allowance runs on its billing cycle, not the calendar month the aggregate above uses.
  // Its shown numbers come from `loadAllowance` itself (what `reserveAllowance` enforces), one call per plan row on this
  // page. The SQL sort and the "near the cap" filter still read calendar-month usage for those rows.
  for (const row of rows) {
    if (row.allowanceSource !== 'plan') continue;
    const a = await loadAllowance(sql, row.id, { defaultMonthlyKrw: envDefaultMonthlyKrw, planGraceDays: graceDays }, now);
    if (a.source !== 'plan') continue;
    row.usedKrw = a.usedKrw;
    row.baseCapKrw = a.baseCapKrw;
    row.extraKrw = a.extraKrw;
    row.capKrw = a.capKrw;
    row.usagePercent = a.capKrw > 0 ? Math.round((a.usedKrw / a.capKrw) * 100) : null;
  }

  const totalPages = Math.max(1, Math.ceil(total / BRAND_ORG_PAGE_SIZE));
  return {
    rows,
    total,
    page: Math.max(1, filter.page),
    pageSize: BRAND_ORG_PAGE_SIZE,
    totalPages,
  };
}
