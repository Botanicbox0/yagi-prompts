/**
 * Per-organization storage quota service (docs/BRAND-STORAGE-QUOTAS-F.md).
 *
 * - Defaults come from the organization's active plan (`b2b_29`: 200 GB, `b2b_49`: 400 GB, `b2b_69`: 800 GB,
 *   `project_only`: 50 GB + 90-day post-delivery retention, `unassigned`: 50 GB; founder decision 2026-11-12 §5).
 * - Admins may override `quota_bytes` (`null` = plan default) and `retention_days` per organization with
 *   optimistic concurrency (`revision`) and an append-only audit log (`brand_storage_quota_events`).
 * - Usage combines an `O(1)` cached counter (`brand_storage_quotas.used_bytes`) with an exact deduplicated
 *   reconciler (`reconcileOrganizationStorage`) that counts each physical `storage_key` at most once across
 *   studio assets, unsaved outputs, storyboards, room message attachments, and project attachments.
 * - `checkStorageQuotaForUpload` re-reconciles before ever refusing an upload so stale or expired reservations
 *   never falsely block a customer. At >= 100%, ONLY new uploads are refused (`storage_quota_exceeded`);
 *   viewing, downloading, reviewing, commenting, and deleting remain open.
 * - `inspectProjectOnlyRetention` reports expired non-subscribing project workspaces in read-only dry-run mode
 *   (zero automatic physical deletions until founder approval).
 */
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { BrandOutcome } from './workspace/types';
import {
  BYTES_PER_GB,
  EMPTY_STORAGE_BREAKDOWN,
  PROPOSED_PLAN_STORAGE_QUOTAS,
  STORAGE_QUOTA_TIERS,
  toStudioStorageQuotaView,
  type StorageBreakdown,
  type StorageQuotaTier,
  type StudioStorageQuotaView,
} from './storage-quota-format';

export * from './storage-quota-format';

const UUID = z.string().uuid();

export interface OrganizationStorageSummary extends StudioStorageQuotaView {
  organizationId: string;
  tier: StorageQuotaTier;
  planDefaultQuotaBytes: number;
  overrideQuotaBytes: number | null;
  planDefaultRetentionDays: number | null;
  overrideRetentionDays: number | null;
  breakdown: StorageBreakdown;
  reconciledAt: string | null;
  note: string;
  revision: number;
  updatedAt: string | null;
}

export interface ProjectOnlyRetentionStatus {
  organizationId: string;
  tier: StorageQuotaTier;
  retentionDays: number | null;
  lastCompletedOrDeliveredAt: string | null;
  daysSinceLastDelivery: number | null;
  expired: boolean;
  usedBytes: number;
}

interface QuotaRow {
  organization_id: string;
  quota_bytes: string | number | null;
  used_bytes: string | number;
  breakdown: Partial<StorageBreakdown> | null;
  retention_days: number | null;
  reconciled_at: Date | string | null;
  note: string;
  revision: number;
  updated_at: Date | string | null;
}

const isoOrNull = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

const toSafeBytes = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

async function tableExists(sql: SqlRunner, table: string): Promise<boolean> {
  const row = (await sql.query<{ t: string | null }>('select to_regclass($1)::text as t', [`public.${table}`])).rows[0];
  return Boolean(row?.t);
}

function normalizeBreakdown(raw: Partial<StorageBreakdown> | null | undefined): StorageBreakdown {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STORAGE_BREAKDOWN };
  return {
    studioUploadsBytes: toSafeBytes(raw.studioUploadsBytes),
    studioSavedBytes: toSafeBytes(raw.studioSavedBytes),
    studioUnsavedOutputsBytes: toSafeBytes(raw.studioUnsavedOutputsBytes),
    roomDeliveriesBytes: toSafeBytes(raw.roomDeliveriesBytes),
    storyboardBytes: toSafeBytes(raw.storyboardBytes),
    roomMessageAttachmentsBytes: toSafeBytes(raw.roomMessageAttachmentsBytes),
    projectAttachmentsBytes: toSafeBytes(raw.projectAttachmentsBytes),
  };
}

function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** Resolve the organization's active storage tier from `brand_plan_assignments` (falls back to `'unassigned'`). */
export async function resolveOrganizationStorageTier(sql: SqlRunner, organizationId: string, now?: Date): Promise<StorageQuotaTier> {
  if (!UUID.safeParse(organizationId).success) return 'unassigned';
  if (!(await tableExists(sql, 'brand_plan_assignments'))) return 'unassigned';
  const row = (
    await sql.query<{ plan_id: string; started_on: string; ends_on: string | null }>(
      'select plan_id, started_on::text as started_on, ends_on::text as ends_on from brand_plan_assignments where organization_id = $1',
      [organizationId],
    )
  ).rows[0];
  if (!row) return 'unassigned';
  const today = todayKst(now);
  const active = row.started_on <= today && (row.ends_on === null || today < row.ends_on);
  if (!active) return 'unassigned';
  return (STORAGE_QUOTA_TIERS as readonly string[]).includes(row.plan_id) ? (row.plan_id as StorageQuotaTier) : 'unassigned';
}

/**
 * Exact deduplicated storage scan across all brand media tables.
 * A physical `storage_key` shared across studio outputs, saved assets, storyboard versions, or room messages
 * is counted once in priority order so saving an output or versioning a storyboard never inflates quota usage.
 */
export async function calculateOrganizationStorageBreakdown(
  sql: SqlRunner,
  organizationId: string,
): Promise<{ totalBytes: number; breakdown: StorageBreakdown }> {
  const breakdown: StorageBreakdown = { ...EMPTY_STORAGE_BREAKDOWN };
  if (!UUID.safeParse(organizationId).success) return { totalBytes: 0, breakdown };

  const seenKeys = new Set<string>();

  if (await tableExists(sql, 'brand_studio_assets')) {
    const assets = (
      await sql.query<{ id: string; source: string; status: string; storage_key: string | null; bytes: string | number }>(
        `select id::text as id, source, status, storage_key, coalesce(size_bytes, 0)::bigint as bytes
           from brand_studio_assets
          where organization_id = $1
            and deleted_at is null
            and (status = 'ready' or (status = 'pending' and created_at > now() - interval '30 minutes'))
          order by case when status = 'ready' then 0 else 1 end, created_at asc, id asc`,
        [organizationId],
      )
    ).rows;
    for (const row of assets) {
      const key = row.status === 'ready' && row.storage_key ? row.storage_key : `pending-asset:${row.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const bytes = toSafeBytes(row.bytes);
      if (row.source === 'delivery') breakdown.roomDeliveriesBytes += bytes;
      else if (row.source === 'generation') breakdown.studioSavedBytes += bytes;
      else breakdown.studioUploadsBytes += bytes;
    }
  }

  if (await tableExists(sql, 'brand_studio_outputs')) {
    const outputs = (
      await sql.query<{ id: string; storage_key: string | null; bytes: string | number }>(
        `select id::text as id, storage_key, coalesce(bytes, 0)::bigint as bytes
           from brand_studio_outputs
          where organization_id = $1
            and deleted_at is null
            and status = 'ready'
            and storage_key is not null
          order by created_at asc, id asc`,
        [organizationId],
      )
    ).rows;
    for (const row of outputs) {
      if (!row.storage_key || seenKeys.has(row.storage_key)) continue;
      seenKeys.add(row.storage_key);
      breakdown.studioUnsavedOutputsBytes += toSafeBytes(row.bytes);
    }
  }

  if ((await tableExists(sql, 'brand_storyboard_frames')) && (await tableExists(sql, 'brand_storyboards'))) {
    const frames = (
      await sql.query<{ id: string; status: string; storage_key: string | null; bytes: string | number }>(
        `select f.id::text as id, f.status, f.storage_key, coalesce(f.size_bytes, 0)::bigint as bytes
           from brand_storyboard_frames f
           join brand_storyboards b on b.id = f.storyboard_id
          where f.organization_id = $1
            and b.deleted_at is null
            and (f.status = 'ready' or (f.status = 'pending' and f.created_at > now() - interval '30 minutes'))
          order by case when f.status = 'ready' then 0 else 1 end, f.created_at asc, f.id asc`,
        [organizationId],
      )
    ).rows;
    for (const row of frames) {
      const key = row.status === 'ready' && row.storage_key ? row.storage_key : `pending-frame:${row.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      breakdown.storyboardBytes += toSafeBytes(row.bytes);
    }
  }

  if (await tableExists(sql, 'brand_room_messages')) {
    const messages = (
      await sql.query<{ attachments: unknown }>(
        `select attachments
           from brand_room_messages
          where organization_id = $1
            and deleted_at is null
          order by created_at asc, id asc`,
        [organizationId],
      )
    ).rows;
    for (const row of messages) {
      if (!Array.isArray(row.attachments)) continue;
      for (const item of row.attachments) {
        const att = item as { key?: unknown; size?: unknown } | null;
        if (!att || typeof att.key !== 'string' || !att.key) continue;
        if (seenKeys.has(att.key)) continue;
        seenKeys.add(att.key);
        breakdown.roomMessageAttachmentsBytes += toSafeBytes(att.size);
      }
    }
  }

  if (await tableExists(sql, 'brand_attachments')) {
    const attachments = (
      await sql.query<{ id: string; storage_key: string | null; bytes: string | number }>(
        `select id::text as id, storage_key, coalesce(size_bytes, 0)::bigint as bytes
           from brand_attachments
          where organization_id = $1
            and (status = 'ready' or (status = 'pending' and created_at > now() - interval '30 minutes'))
          order by created_at asc, id asc`,
        [organizationId],
      )
    ).rows;
    for (const row of attachments) {
      const key = row.storage_key ? `brand-att:${row.storage_key}` : `pending-brand-att:${row.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      breakdown.projectAttachmentsBytes += toSafeBytes(row.bytes);
    }
  }

  const totalBytes =
    breakdown.studioUploadsBytes +
    breakdown.studioSavedBytes +
    breakdown.studioUnsavedOutputsBytes +
    breakdown.roomDeliveriesBytes +
    breakdown.storyboardBytes +
    breakdown.roomMessageAttachmentsBytes +
    breakdown.projectAttachmentsBytes;

  return { totalBytes, breakdown };
}

function buildSummary(organizationId: string, tier: StorageQuotaTier, row: QuotaRow | null, fallback?: { totalBytes: number; breakdown: StorageBreakdown }): OrganizationStorageSummary {
  const defaults = PROPOSED_PLAN_STORAGE_QUOTAS[tier];
  const overrideQuotaBytes = row?.quota_bytes == null ? null : Math.max(0, Math.round(Number(row.quota_bytes)));
  const effectiveQuotaBytes = overrideQuotaBytes ?? defaults.defaultQuotaBytes;
  const overrideRetentionDays = row?.retention_days == null ? null : Number(row.retention_days);
  const retentionDays = overrideRetentionDays ?? defaults.defaultRetentionDays;
  const usedBytes = fallback ? fallback.totalBytes : toSafeBytes(row?.used_bytes);
  const breakdown = fallback ? fallback.breakdown : normalizeBreakdown(row?.breakdown);
  const view = toStudioStorageQuotaView({ usedBytes, effectiveQuotaBytes, retentionDays });
  return {
    ...view,
    organizationId,
    tier,
    planDefaultQuotaBytes: defaults.defaultQuotaBytes,
    overrideQuotaBytes,
    planDefaultRetentionDays: defaults.defaultRetentionDays,
    overrideRetentionDays,
    breakdown,
    reconciledAt: isoOrNull(row?.reconciled_at),
    note: String(row?.note ?? ''),
    revision: row ? Number(row.revision) : 0,
    updatedAt: isoOrNull(row?.updated_at),
  };
}

/** Recompute deduplicated bytes from live tables and persist into `brand_storage_quotas` (if table exists). */
export async function reconcileOrganizationStorage(sql: SqlRunner, organizationId: string, now?: Date): Promise<OrganizationStorageSummary> {
  const [tier, calc, hasQuotaTable] = await Promise.all([
    resolveOrganizationStorageTier(sql, organizationId, now),
    calculateOrganizationStorageBreakdown(sql, organizationId),
    tableExists(sql, 'brand_storage_quotas'),
  ]);
  if (!hasQuotaTable || !UUID.safeParse(organizationId).success) {
    return buildSummary(organizationId, tier, null, calc);
  }
  const orgExists = (await sql.query('select 1 from brand_organizations where id = $1', [organizationId])).rows[0];
  if (!orgExists) {
    return buildSummary(organizationId, tier, null, calc);
  }
  const upserted = (
    await sql.query<QuotaRow>(
      `insert into brand_storage_quotas (organization_id, used_bytes, breakdown, reconciled_at, updated_at)
         values ($1, $2, $3::jsonb, now(), now())
       on conflict (organization_id) do update
         set used_bytes = excluded.used_bytes,
             breakdown = excluded.breakdown,
             reconciled_at = now(),
             updated_at = now()
       returning *`,
      [organizationId, calc.totalBytes, JSON.stringify(calc.breakdown)],
    )
  ).rows[0]!;
  return buildSummary(organizationId, tier, upserted);
}

/** Fast O(1) summary read; initializes via `reconcileOrganizationStorage` on first touch or pre-0086 fallback. */
export async function loadOrganizationStorageSummary(sql: SqlRunner, organizationId: string, now?: Date): Promise<OrganizationStorageSummary> {
  if (!UUID.safeParse(organizationId).success) {
    return buildSummary(organizationId, 'unassigned', null, { totalBytes: 0, breakdown: { ...EMPTY_STORAGE_BREAKDOWN } });
  }
  if (!(await tableExists(sql, 'brand_storage_quotas'))) {
    const [tier, calc] = await Promise.all([
      resolveOrganizationStorageTier(sql, organizationId, now),
      calculateOrganizationStorageBreakdown(sql, organizationId),
    ]);
    return buildSummary(organizationId, tier, null, calc);
  }
  const [tier, row] = await Promise.all([
    resolveOrganizationStorageTier(sql, organizationId, now),
    sql.query<QuotaRow>('select * from brand_storage_quotas where organization_id = $1', [organizationId]).then((r) => r.rows[0] ?? null),
  ]);
  if (!row || row.reconciled_at === null) {
    return reconcileOrganizationStorage(sql, organizationId, now);
  }
  return buildSummary(organizationId, tier, row);
}

/** Atomic delta update on `used_bytes` for fast-path uploads and generations (clamped at 0). */
export async function adjustOrganizationStorageBytes(sql: SqlRunner, organizationId: string, deltaBytes: number): Promise<void> {
  if (!deltaBytes || !Number.isFinite(deltaBytes) || !UUID.safeParse(organizationId).success) return;
  if (!(await tableExists(sql, 'brand_storage_quotas'))) return;
  const rounded = Math.round(deltaBytes);
  if (rounded === 0) return;
  await sql.query(
    `update brand_storage_quotas
        set used_bytes = greatest(0, used_bytes + $2::bigint),
            updated_at = now()
      where organization_id = $1`,
    [organizationId, rounded],
  );
}

/**
 * Gate for customer file uploads (`asset.reserve`, room `attachment.reserve` / `complete`, storyboard `frame.reserve` / `add`).
 * Fast-paths when cached `used_bytes + incomingBytes <= effectiveQuotaBytes`; otherwise runs a live deduplicated
 * reconcile before refusing so stale counters or expired pending reservations never falsely block an upload.
 */
export async function checkStorageQuotaForUpload(
  sql: SqlRunner,
  organizationId: string,
  incomingBytes: number,
  now?: Date,
): Promise<{ allowed: true; summary: OrganizationStorageSummary } | { allowed: false; code: 'storage_quota_exceeded'; summary: OrganizationStorageSummary }> {
  const add = Math.max(0, Math.round(incomingBytes));
  const summary = await loadOrganizationStorageSummary(sql, organizationId, now);
  if (add === 0) return { allowed: true, summary };
  if (summary.effectiveQuotaBytes > 0 && summary.usedBytes + add <= summary.effectiveQuotaBytes) {
    return { allowed: true, summary };
  }
  const fresh = await reconcileOrganizationStorage(sql, organizationId, now);
  if (fresh.effectiveQuotaBytes > 0 && fresh.usedBytes + add <= fresh.effectiveQuotaBytes) {
    return { allowed: true, summary: fresh };
  }
  return { allowed: false, code: 'storage_quota_exceeded', summary: fresh };
}

const SetQuotaInputSchema = z.object({
  organizationId: UUID,
  /** `null` resets to the assigned plan's default quota. Max 100 TB (`100_000` GB). */
  quotaBytes: z.number().int().min(0).max(100_000 * BYTES_PER_GB).nullable(),
  /** `null` resets to the assigned plan's default retention window. */
  retentionDays: z.number().int().min(1).max(3650).nullable().default(null),
  note: z.string().trim().max(500).default(''),
  expectedRevision: z.number().int().min(0),
});

/** Admin-only per-organization quota & retention override with optimistic concurrency and audit logging. */
export async function setOrganizationStorageQuota(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown,
): Promise<BrandOutcome<{ id: string; revision: number }>> {
  if (!UUID.safeParse(viewer.userId).success) return { ok: false, code: 'sign_in_required' };
  const parsed = SetQuotaInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  }
  const v = parsed.data;
  return deps.sql.transaction(async (sql) => {
    const profile = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1 for share', [viewer.userId])).rows[0];
    if (!profile) return { ok: false as const, code: 'sign_in_required' as const };
    if (profile.is_admin !== true) return { ok: false as const, code: 'forbidden' as const };
    if (!(await sql.query('select id from brand_organizations where id = $1 for update', [v.organizationId])).rows[0]) {
      return { ok: false as const, code: 'not_found' as const };
    }
    if (!(await tableExists(sql, 'brand_storage_quotas'))) {
      return { ok: false as const, code: 'storage_unavailable' as const };
    }
    const current = (
      await sql.query<QuotaRow>('select * from brand_storage_quotas where organization_id = $1 for update', [v.organizationId])
    ).rows[0];
    const revision = current ? Number(current.revision) : 0;
    if (revision !== v.expectedRevision) return { ok: false as const, code: 'conflict' as const };
    const calc = await calculateOrganizationStorageBreakdown(sql, v.organizationId);
    const nextRevision = revision + 1;
    const prevQuota = current?.quota_bytes == null ? null : Number(current.quota_bytes);
    const prevRetention = current?.retention_days == null ? null : Number(current.retention_days);

    await sql.query(
      `insert into brand_storage_quotas (
         organization_id, quota_bytes, used_bytes, breakdown, retention_days, reconciled_at, note, revision, updated_by, updated_at
       ) values ($1, $2, $3, $4::jsonb, $5, now(), $6, $7, $8, now())
       on conflict (organization_id) do update
         set quota_bytes = excluded.quota_bytes,
             used_bytes = excluded.used_bytes,
             breakdown = excluded.breakdown,
             retention_days = excluded.retention_days,
             reconciled_at = now(),
             note = excluded.note,
             revision = excluded.revision,
             updated_by = excluded.updated_by,
             updated_at = now()`,
      [v.organizationId, v.quotaBytes, calc.totalBytes, JSON.stringify(calc.breakdown), v.retentionDays, v.note, nextRevision, viewer.userId],
    );

    await sql.query(
      `insert into brand_storage_quota_events (
         organization_id, revision, previous_quota_bytes, next_quota_bytes,
         previous_retention_days, next_retention_days, used_bytes_snapshot, note, actor_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [v.organizationId, nextRevision, prevQuota, v.quotaBytes, prevRetention, v.retentionDays, calc.totalBytes, v.note, viewer.userId],
    );

    return { ok: true as const, id: v.organizationId, revision: nextRevision };
  });
}

/** Admin-only manual reconciliation trigger on `/admin/brand-workspace/organizations/[id]`. */
export async function adminReconcileOrganizationStorage(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  organizationId: string,
): Promise<BrandOutcome<{ id: string; usedBytes: number }>> {
  if (!UUID.safeParse(viewer.userId).success) return { ok: false, code: 'sign_in_required' };
  if (!UUID.safeParse(organizationId).success) return { ok: false, code: 'invalid', field: 'organizationId' };
  return deps.sql.transaction(async (sql) => {
    const profile = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1 for share', [viewer.userId])).rows[0];
    if (!profile) return { ok: false as const, code: 'sign_in_required' as const };
    if (profile.is_admin !== true) return { ok: false as const, code: 'forbidden' as const };
    if (!(await sql.query('select id from brand_organizations where id = $1 for update', [organizationId])).rows[0]) {
      return { ok: false as const, code: 'not_found' as const };
    }
    const summary = await reconcileOrganizationStorage(sql, organizationId);
    return { ok: true as const, id: organizationId, usedBytes: summary.usedBytes };
  });
}

/**
 * Read-only retention inspection for non-subscribing (`project_only`) or retention-configured organizations.
 * Never deletes rows or objects — reports whether `retentionDays` has elapsed since the latest completed project
 * or studio delivery so admins can review before any founder-approved cleanup.
 */
export async function inspectProjectOnlyRetention(
  sql: SqlRunner,
  organizationId: string,
  now: Date = new Date(),
): Promise<ProjectOnlyRetentionStatus> {
  const summary = await loadOrganizationStorageSummary(sql, organizationId, now);
  if (summary.retentionDays === null) {
    return {
      organizationId,
      tier: summary.tier,
      retentionDays: null,
      lastCompletedOrDeliveredAt: null,
      daysSinceLastDelivery: null,
      expired: false,
      usedBytes: summary.usedBytes,
    };
  }

  let latestMs: number | null = null;
  let hasActiveProject = false;

  if (await tableExists(sql, 'brand_projects')) {
    const proj = (
      await sql.query<{ active_count: number; latest_completed: Date | string | null }>(
        `select count(*) filter (where status not in ('completed', 'cancelled'))::int as active_count,
                max(updated_at) filter (where status = 'completed') as latest_completed
           from brand_projects
          where organization_id = $1`,
        [organizationId],
      )
    ).rows[0];
    hasActiveProject = Number(proj?.active_count ?? 0) > 0;
    if (proj?.latest_completed) {
      const t = new Date(proj.latest_completed).getTime();
      if (Number.isFinite(t)) latestMs = t;
    }
  }

  if (await tableExists(sql, 'brand_studio_assets')) {
    const deliv = (
      await sql.query<{ latest_delivery: Date | string | null }>(
        `select max(created_at) as latest_delivery
           from brand_studio_assets
          where organization_id = $1 and source = 'delivery' and deleted_at is null`,
        [organizationId],
      )
    ).rows[0];
    if (deliv?.latest_delivery) {
      const t = new Date(deliv.latest_delivery).getTime();
      if (Number.isFinite(t) && (latestMs === null || t > latestMs)) latestMs = t;
    }
  }

  if (hasActiveProject || latestMs === null) {
    return {
      organizationId,
      tier: summary.tier,
      retentionDays: summary.retentionDays,
      lastCompletedOrDeliveredAt: latestMs === null ? null : new Date(latestMs).toISOString(),
      daysSinceLastDelivery: latestMs === null ? null : Math.max(0, Math.floor((now.getTime() - latestMs) / 86_400_000)),
      expired: false,
      usedBytes: summary.usedBytes,
    };
  }

  const daysSince = Math.max(0, Math.floor((now.getTime() - latestMs) / 86_400_000));
  return {
    organizationId,
    tier: summary.tier,
    retentionDays: summary.retentionDays,
    lastCompletedOrDeliveredAt: new Date(latestMs).toISOString(),
    daysSinceLastDelivery: daysSince,
    expired: daysSince >= summary.retentionDays,
    usedBytes: summary.usedBytes,
  };
}
