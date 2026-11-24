import type { Viewer } from '@/lib/auth/identity';
import { studioEnv, type StudioEnv } from '@/lib/brand-studio/env';
import type { StudioLane } from '@/lib/brand-studio/models';
import {
  loadAllowance,
  loadAllowanceRow,
  type StudioAllowance,
  type StudioAllowanceRow,
} from '@/lib/brand-studio/usage';
import {
  listBrandDiscounts,
  listBrandInvoices,
  listExtraAllowanceGrants,
  loadActiveBrandDiscount,
  loadBrandBillingProfile,
  loadPlanAllowanceDefault,
} from '@/lib/brands/billing';
import { hasTable, hasTables, loadSubscriptionSchemaReady } from '@/lib/brands/billing/schema-guard';
import type {
  BrandAllowanceGrant,
  BrandBillingProfile,
  BrandDiscount,
  BrandInvoice,
} from '@/lib/brands/billing/types';
import {
  hasCompleteTaxInvoiceProfile,
  isInvoiceOverdueWithDueOn,
  listBrandSubscriptionEvents,
  loadBrandSubscription,
  loadExtendedInvoiceMetaByOrg,
  loadSubscriptionPanelFacts,
  type BrandSubscription,
  type ExtendedInvoiceMeta,
  type SubscriptionPanelFacts,
} from '@/lib/brands/subscriptions';
import { kstDayOf } from '@/lib/brands/billing/math';
import { brandBillingAutoIssueOpen } from '@/lib/flags';
import { loadPlanAssignment } from '@/lib/brands/plans';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { isDbAdmin, iso, UUID_RE } from './brand-ops-guard';

export const ORG_JOB_STATUSES = [
  'all',
  'failed',
  'succeeded',
  'running',
  'finishing',
  'queued',
  'held',
  'canceled',
] as const;
export type OrgJobStatusFilter = (typeof ORG_JOB_STATUSES)[number];

export interface OrgStudioJobRow {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  kind: string;
  model: string;
  lane: StudioLane | null;
  status: string;
  estimateKrw: number;
  usageKrw: number | null;
  returnedKrw: number;
  errorCode: string | null;
  errorDetail: string | null;
}

export type OrgHistoryCategory =
  | 'plan'
  | 'invoice'
  | 'discount'
  | 'grant'
  | 'audit'
  | 'policy'
  | 'storage'
  | 'subscription';

export interface OrgHistoryItem {
  id: string;
  at: string;
  category: OrgHistoryCategory;
  title: string;
  detail: string;
  actorId: string | null;
  actorName: string | null;
}

export interface OrgSubscriptionPanelState {
  enabled: boolean;
  schemaReady: boolean;
  subscription: BrandSubscription | null;
  /** B1c-2: the next draft day and the next billing day (start of the next cycle), from the subscription's cycles. */
  calendar: { nextDraftOpenDay: string | null; nextIssueDay: string | null };
  oldestUnpaid: {
    id: string;
    period: string;
    dueOn: string | null;
    totalKrw: number;
    overdue: boolean;
  } | null;
  endsOn: string | null;
  profileReadyForTransfer: boolean;
  facts: SubscriptionPanelFacts | null;
  invoiceMeta: Record<string, ExtendedInvoiceMeta>;
}

export interface BrandOrgDetailOps {
  billingAvailable: boolean;
  allowance: StudioAllowance | null;
  allowanceRow: StudioAllowanceRow | null;
  planDefaultCapKrw: number | null;
  activeDiscount: BrandDiscount | null;
  discounts: BrandDiscount[];
  grants: BrandAllowanceGrant[];
  billingProfile: BrandBillingProfile | null;
  invoices: BrandInvoice[];
  subscriptionPanel: OrgSubscriptionPanelState | null;
  studioJobsAvailable: boolean;
  studioJobs: OrgStudioJobRow[];
  history: OrgHistoryItem[];
}

export function orgJobStatusFilter(raw: string | string[] | undefined): OrgJobStatusFilter {
  const val = Array.isArray(raw) ? raw[0] : raw;
  return val && (ORG_JOB_STATUSES as readonly string[]).includes(val) ? (val as OrgJobStatusFilter) : 'all';
}

/**
 * Loads billing controls, latest 50 studio jobs, and merged audit/billing history for
 * `/admin/brand-workspace/organizations/[id]`. Tolerates missing 0176/0178/0076/0086 tables.
 */
export async function loadBrandOrgDetailOps(
  sql: SqlRunner,
  viewer: Viewer,
  organizationId: string,
  options: {
    jobStatus?: OrgJobStatusFilter;
    env?: Pick<StudioEnv, 'defaultMonthlyKrw' | 'planGraceDays'>;
    now?: Date;
  } = {},
): Promise<BrandOrgDetailOps | null> {
  if (!(await isDbAdmin(sql, viewer))) return null;
  if (!UUID_RE.test(organizationId)) return null;

  const now = options.now ?? new Date();
  const env = options.env ?? studioEnv();
  const jobStatus = options.jobStatus ?? 'all';
  const autoIssueEnabled = brandBillingAutoIssueOpen();

  const [
    billingAvailable,
    hasStudioJobs,
    hasStudioAllowances,
    hasPlanEvents,
    hasInvoiceEvents,
    hasDiscounts,
    hasGrants,
    hasPlatformAudit,
    hasPolicyEvents,
    hasStorageEvents,
    plan,
    subscriptionSchemaReady,
  ] = await Promise.all([
    hasTables(sql, ['brand_invoices', 'brand_discounts', 'brand_billing_profiles', 'brand_allowance_grants']),
    hasTable(sql, 'brand_studio_jobs'),
    hasTable(sql, 'brand_studio_allowances'),
    hasTable(sql, 'brand_plan_events'),
    hasTable(sql, 'brand_invoice_events'),
    hasTable(sql, 'brand_discounts'),
    hasTable(sql, 'brand_allowance_grants'),
    hasTable(sql, 'platform_audit'),
    hasTable(sql, 'brand_feature_policy_events'),
    hasTable(sql, 'brand_storage_quota_events'),
    loadPlanAssignment(sql, organizationId).catch(() => null),
    autoIssueEnabled ? loadSubscriptionSchemaReady(sql).catch(() => false) : Promise.resolve(false),
  ]);

  const [
    allowance,
    allowanceRow,
    planDefaultCapKrw,
    activeDiscount,
    discounts,
    grants,
    billingProfile,
    rawInvoices,
    subscription,
    subscriptionEvents,
    invoiceMetaMap,
  ] = await Promise.all([
    hasStudioJobs
      ? loadAllowance(sql, organizationId, env, now).catch(() => null)
      : Promise.resolve(null),
    hasStudioAllowances ? loadAllowanceRow(sql, organizationId).catch(() => null) : Promise.resolve(null),
    plan ? loadPlanAllowanceDefault(sql, plan.planId).catch(() => null) : Promise.resolve(null),
    loadActiveBrandDiscount(sql, organizationId).catch(() => null),
    listBrandDiscounts(sql, organizationId).catch(() => []),
    listExtraAllowanceGrants(sql, organizationId, now).catch(() => []),
    loadBrandBillingProfile(sql, organizationId).catch(() => null),
    listBrandInvoices(sql, { organizationId, now }).catch(() => []),
    autoIssueEnabled && subscriptionSchemaReady
      ? loadBrandSubscription(sql, organizationId).catch(() => null)
      : Promise.resolve(null),
    autoIssueEnabled && subscriptionSchemaReady
      ? listBrandSubscriptionEvents(sql, organizationId).catch(() => [])
      : Promise.resolve([]),
    autoIssueEnabled && subscriptionSchemaReady
      ? loadExtendedInvoiceMetaByOrg(sql, organizationId).catch(() => new Map<string, ExtendedInvoiceMeta>())
      : Promise.resolve(new Map<string, ExtendedInvoiceMeta>()),
  ]);

  const todayKst = kstDayOf(now);
  const invoices =
    autoIssueEnabled && subscriptionSchemaReady
      ? rawInvoices.map((inv) => {
          const meta = invoiceMetaMap.get(inv.id);
          return {
            ...inv,
            overdue: isInvoiceOverdueWithDueOn(
              { status: inv.status, issuedAt: inv.issuedAt, dueOn: meta?.dueOn ?? null },
              todayKst,
              now,
            ),
          };
        })
      : rawInvoices;

  let studioJobs: OrgStudioJobRow[] = [];
  if (hasStudioJobs) {
    const jobParams: unknown[] = [organizationId];
    let statusWhere = '';
    if (jobStatus !== 'all') {
      jobParams.push(jobStatus);
      statusWhere = `and status = $${jobParams.length}`;
    }
    const { rows } = await sql.query<{
      id: string;
      created_at: unknown;
      finished_at: unknown;
      kind: string;
      model: string;
      lane: string | null;
      status: string;
      estimate_krw: number;
      usage_krw: number | null;
      error_code: string | null;
      error_detail: string | null;
    }>(
      `select id::text as id, created_at, finished_at, kind, model, lane, status,
              estimate_krw, usage_krw, error_code, error_detail
         from brand_studio_jobs
        where organization_id = $1::uuid ${statusWhere}
        order by created_at desc, id desc
        limit 50`,
      jobParams,
    );
    studioJobs = rows.map((r) => {
      const estimateKrw = Number(r.estimate_krw ?? 0);
      const usageKrw = r.usage_krw === null || r.usage_krw === undefined ? null : Number(r.usage_krw);
      const returnedKrw =
        r.status === 'failed' || r.status === 'canceled'
          ? Math.max(0, estimateKrw - (usageKrw ?? 0))
          : 0;
      return {
        id: String(r.id),
        createdAt: iso(r.created_at) ?? '',
        finishedAt: iso(r.finished_at),
        kind: String(r.kind),
        model: String(r.model),
        lane: (r.lane as StudioLane | null) ?? null,
        status: String(r.status),
        estimateKrw,
        usageKrw,
        returnedKrw,
        errorCode: r.error_code ? String(r.error_code) : null,
        errorDetail: r.error_detail ? String(r.error_detail) : null,
      };
    });
  }

  const rawHistory: Array<Omit<OrgHistoryItem, 'actorName'>> = [];

  const [planEventsRes, invoiceEventsRes, auditRes, policyRes, storageRes] = await Promise.all([
    hasPlanEvents
      ? sql.query<{
          id: string;
          plan_id: string;
          billing_mode: string;
          started_on: string;
          ends_on: string | null;
          seats: number | null;
          note: string;
          actor_id: string | null;
          created_at: unknown;
        }>(
          `select id::text as id, plan_id, billing_mode, started_on::text as started_on,
                  ends_on::text as ends_on, seats, note, actor_id::text as actor_id, created_at
             from brand_plan_events
            where organization_id = $1::uuid
            order by created_at desc
            limit 40`,
          [organizationId],
        )
      : Promise.resolve({ rows: [] }),
    hasInvoiceEvents
      ? sql.query<{
          id: string;
          invoice_id: string;
          action: string;
          from_status: string | null;
          to_status: string;
          snapshot: Record<string, unknown>;
          note: string;
          actor_id: string | null;
          created_at: unknown;
        }>(
          `select id::text as id, invoice_id::text as invoice_id, action, from_status, to_status,
                  snapshot, note, actor_id::text as actor_id, created_at
             from brand_invoice_events
            where organization_id = $1::uuid
            order by created_at desc
            limit 60`,
          [organizationId],
        )
      : Promise.resolve({ rows: [] }),
    hasPlatformAudit
      ? sql.query<{
          id: string;
          actor_id: string | null;
          action: string;
          reason: string;
          details: Record<string, unknown>;
          created_at: unknown;
        }>(
          `select id::text as id, actor_id::text as actor_id, action, reason, details, created_at
             from platform_audit
            where entity_id = $1::uuid or details ->> 'organizationId' = ($1::uuid)::text
            order by created_at desc
            limit 40`,
          [organizationId],
        )
      : Promise.resolve({ rows: [] }),
    hasPolicyEvents
      ? sql.query<{
          id: string;
          denied_features: string[];
          note: string;
          actor_id: string | null;
          created_at: unknown;
        }>(
          `select id::text as id, denied_features, note, actor_id::text as actor_id, created_at
             from brand_feature_policy_events
            where organization_id = $1::uuid
            order by created_at desc
            limit 30`,
          [organizationId],
        )
      : Promise.resolve({ rows: [] }),
    hasStorageEvents
      ? sql.query<{
          id: string;
          revision: number;
          next_quota_bytes: string | number | null;
          next_retention_days: number | null;
          note: string;
          actor_id: string | null;
          created_at: unknown;
        }>(
          `select id::text as id, revision, next_quota_bytes, next_retention_days, note, actor_id::text as actor_id, created_at
             from brand_storage_quota_events
            where organization_id = $1::uuid
            order by created_at desc
            limit 30`,
          [organizationId],
        )
      : Promise.resolve({ rows: [] }),
  ]);

  for (const r of planEventsRes.rows) {
    const at = iso(r.created_at);
    if (!at) continue;
    rawHistory.push({
      id: `plan:${r.id}`,
      at,
      category: 'plan',
      title: `${r.plan_id} · ${r.billing_mode}`,
      detail: [
        `${r.started_on}${r.ends_on ? ` → ${r.ends_on}` : ''}`,
        r.seats != null ? `seats=${r.seats}` : null,
        r.note || null,
      ]
        .filter(Boolean)
        .join(' · '),
      actorId: r.actor_id ? String(r.actor_id) : null,
    });
  }

  for (const r of invoiceEventsRes.rows) {
    const at = iso(r.created_at);
    if (!at) continue;
    const snap = (r.snapshot && typeof r.snapshot === 'object' ? r.snapshot : {}) as Record<string, unknown>;
    const period = typeof snap.period === 'string' ? snap.period : r.invoice_id.slice(0, 8);
    const total = typeof snap.totalKrw === 'number' ? `${snap.totalKrw.toLocaleString('ko-KR')}원` : null;
    rawHistory.push({
      id: `invoice:${r.id}`,
      at,
      category: 'invoice',
      title: `${period} · ${r.action} (${r.from_status ?? 'new'} → ${r.to_status})`,
      detail: [total, r.note || null].filter(Boolean).join(' · '),
      actorId: r.actor_id ? String(r.actor_id) : null,
    });
  }

  if (hasDiscounts) {
    for (const d of discounts) {
      rawHistory.push({
        id: `discount-start:${d.id}`,
        at: d.createdAt,
        category: 'discount',
        title: `${d.percent}% (${d.source})`,
        detail: [
          d.invoicesTotal === null ? '무기한' : `${d.invoicesTotal}회`,
          d.memo || null,
        ]
          .filter(Boolean)
          .join(' · '),
        actorId: d.createdBy,
      });
      if (d.endedAt) {
        rawHistory.push({
          id: `discount-end:${d.id}`,
          at: d.endedAt,
          category: 'discount',
          title: `${d.percent}% ended`,
          detail: d.endReason || 'ended',
          actorId: d.endedBy,
        });
      }
    }
  }

  if (hasGrants) {
    for (const g of grants) {
      rawHistory.push({
        id: `grant-create:${g.id}`,
        at: g.createdAt,
        category: 'grant',
        title: `+${g.amountKrw.toLocaleString('ko-KR')}원 (${g.validMonth})`,
        detail: g.reason,
        actorId: g.createdBy,
      });
      if (g.revokedAt) {
        rawHistory.push({
          id: `grant-revoke:${g.id}`,
          at: g.revokedAt,
          category: 'grant',
          title: `-${g.amountKrw.toLocaleString('ko-KR')}원 revoked (${g.validMonth})`,
          detail: g.reason,
          actorId: g.revokedBy,
        });
      }
    }
  }

  for (const r of auditRes.rows) {
    const at = iso(r.created_at);
    if (!at) continue;
    const code = typeof r.details?.code === 'string' ? r.details.code : null;
    rawHistory.push({
      id: `audit:${r.id}`,
      at,
      category: 'audit',
      title: String(r.action),
      detail: [r.reason, code].filter(Boolean).join(' · '),
      actorId: r.actor_id ? String(r.actor_id) : null,
    });
  }

  for (const r of policyRes.rows) {
    const at = iso(r.created_at);
    if (!at) continue;
    rawHistory.push({
      id: `policy:${r.id}`,
      at,
      category: 'policy',
      title: r.denied_features.length > 0 ? r.denied_features.join(', ') : 'all_open',
      detail: r.note || '',
      actorId: r.actor_id ? String(r.actor_id) : null,
    });
  }

  for (const r of storageRes.rows) {
    const at = iso(r.created_at);
    if (!at) continue;
    const parts: string[] = [`r${r.revision}`];
    if (r.next_quota_bytes !== null && r.next_quota_bytes !== undefined) {
      parts.push(`${Math.round((Number(r.next_quota_bytes) / (1024 * 1024 * 1024)) * 10) / 10} GB`);
    }
    if (r.next_retention_days !== null && r.next_retention_days !== undefined) {
      parts.push(`${r.next_retention_days}d`);
    }
    if (r.note) parts.push(r.note);
    rawHistory.push({
      id: `storage:${r.id}`,
      at,
      category: 'storage',
      title: 'storage quota',
      detail: parts.join(' · '),
      actorId: r.actor_id ? String(r.actor_id) : null,
    });
  }

  for (const ev of subscriptionEvents) {
    rawHistory.push({
      id: `sub:${ev.id}`,
      at: ev.createdAt,
      category: 'subscription',
      title: `${ev.action} (${ev.actorKind})`,
      detail: typeof ev.snapshot.planId === 'string'
        ? [
            ev.snapshot.planId,
            typeof ev.snapshot.status === 'string' ? ev.snapshot.status : null,
            typeof ev.snapshot.reason === 'string' ? ev.snapshot.reason : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : '',
      actorId: ev.actor,
    });
  }

  rawHistory.sort((a, b) => b.at.localeCompare(a.at));
  const sliced = rawHistory.slice(0, 100);

  const actorIds = [
    ...new Set(sliced.map((item) => item.actorId).filter((id): id is string => Boolean(id && UUID_RE.test(id)))),
  ];
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const { rows: profiles } = await sql.query<{ id: string; display_name: string | null }>(
      'select id::text as id, display_name from profiles where id = any($1::uuid[])',
      [actorIds],
    );
    for (const p of profiles) {
      if (p.display_name && p.display_name.trim()) {
        actorNames.set(String(p.id), p.display_name.trim());
      }
    }
  }

  const history: OrgHistoryItem[] = sliced.map((item) => ({
    ...item,
    actorName: item.actorId
      ? (actorNames.get(item.actorId) ?? item.actorId.slice(0, 8))
      : item.category === 'subscription'
        ? 'system'
        : null,
  }));

  let subscriptionPanel: OrgSubscriptionPanelState | null = null;
  if (autoIssueEnabled) {
    let calendar: OrgSubscriptionPanelState['calendar'] = { nextDraftOpenDay: null, nextIssueDay: null };
    if (!subscriptionSchemaReady) {
      subscriptionPanel = {
        enabled: true,
        schemaReady: false,
        subscription: null,
        calendar,
        oldestUnpaid: null,
        endsOn: plan?.endsOn ?? null,
        profileReadyForTransfer: false,
        facts: null,
        invoiceMeta: {},
      };
    } else {
      const facts = subscription
        ? await loadSubscriptionPanelFacts(sql, subscription, now, env.planGraceDays ?? 7).catch(() => null)
        : null;
      calendar = { nextDraftOpenDay: facts?.nextDraftDay ?? null, nextIssueDay: facts?.nextCycle?.start ?? null };
      // A1: only the current subscription epoch counts; older manual invoices are not this subscription's debt.
      const unpaidSubOrAdj = invoices
        .filter((inv) => {
          const meta = invoiceMetaMap.get(inv.id);
          const kind = meta?.kind ?? 'subscription';
          return (
            subscription !== null &&
            meta?.subscriptionEpoch === subscription.epoch &&
            inv.status === 'issued' &&
            (kind === 'subscription' || kind === 'adjustment')
          );
        })
        .sort((a, b) => {
          const dueA = invoiceMetaMap.get(a.id)?.dueOn ?? a.period;
          const dueB = invoiceMetaMap.get(b.id)?.dueOn ?? b.period;
          return dueA.localeCompare(dueB);
        });
      const oldest = unpaidSubOrAdj[0] ?? null;
      const invoiceMetaRecord: Record<string, ExtendedInvoiceMeta> = {};
      for (const [k, val] of invoiceMetaMap.entries()) {
        invoiceMetaRecord[k] = val;
      }
      subscriptionPanel = {
        enabled: true,
        schemaReady: true,
        subscription,
        calendar,
        oldestUnpaid: oldest
          ? {
              id: oldest.id,
              period: oldest.period,
              dueOn: invoiceMetaMap.get(oldest.id)?.dueOn ?? null,
              totalKrw: oldest.totalKrw,
              overdue: oldest.overdue,
            }
          : null,
        endsOn: plan?.endsOn ?? null,
        profileReadyForTransfer: hasCompleteTaxInvoiceProfile(billingProfile),
        facts,
        invoiceMeta: invoiceMetaRecord,
      };
    }
  }

  return {
    billingAvailable,
    allowance,
    allowanceRow,
    planDefaultCapKrw,
    activeDiscount,
    discounts,
    grants,
    billingProfile,
    invoices,
    subscriptionPanel,
    studioJobsAvailable: hasStudioJobs,
    studioJobs,
    history,
  };
}
