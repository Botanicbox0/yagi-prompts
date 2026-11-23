/**
 * Pre-approval upload gate for brand-new self-created workspaces (`lib/brands/upload-gate.ts`).
 *
 * Rules (founder review B1 / S2 / S6):
 * - Organizations created BEFORE `UPLOAD_GATE_APPLIES_FROM` (`2026-11-24T00:00:00+09:00`) are exempt.
 * - Organizations created at or after the cutoff are exempt (approved) when ANY of:
 *   1. Studio allowance `monthly_cap_krw > 0`
 *   2. Any plan assignment has EVER existed (active OR ended) in `brand_plan_assignments` or `brand_plan_events`
 *   3. Any commissioned/staff record exists (`studio_managed`, staff-created `brand_projects` / `brand_contract_documents`,
 *      studio `brand_storyboards` / `brand_room_messages` / `brand_messages`, `brand_content_versions`, or `delivery` studio assets)
 *   4. An admin storage-quota override row exists (`brand_storage_quotas.quota_bytes is not null`)
 * - While unapproved (gated), ONLY files/bytes uploaded by the organization's own non-admin members count toward the
 *   500 MB (`UNAPPROVED_UPLOAD_QUOTA_BYTES`) and 50-file (`UNAPPROVED_UPLOAD_MAX_FILES`) ceiling — staff uploads on behalf
 *   of a gated organization are never blocked and never counted.
 * - Unsent room attachments reserved via `attachment.reserve` / `attachment.complete` are tracked per organization inside
 *   `brand_storage_quotas.breakdown._pendingRoomUploads` with a 30-minute TTL so parallel/sequential room reserves cannot
 *   cross the 50-file / 500 MB ceiling without adding a DB column or migration.
 */
import { studioEnv } from '../brand-studio/env';
import { loadAllowance } from '../brand-studio/usage';
import type { SqlRunner } from '../db/sql-runner';
import { brandWorkspaceApprovalOpen } from '../flags';
import { hasWorkspaceApproval, loadWorkspaceApprovalSchemaReady } from './billing/workspace-approval-schema';
import {
  isUnapprovedUploadReason,
  UNAPPROVED_UPLOAD_MAX_FILES,
  UNAPPROVED_UPLOAD_QUOTA_BYTES,
  UPLOAD_GATE_APPLIES_FROM,
  type UploadLimitReason,
} from './upload-limits-format';

export {
  isUnapprovedUploadReason,
  UNAPPROVED_UPLOAD_MAX_FILES,
  UNAPPROVED_UPLOAD_QUOTA_BYTES,
  UPLOAD_GATE_APPLIES_FROM,
  type UploadLimitReason,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPLOAD_GATE_APPLIES_FROM_MS = Date.parse(UPLOAD_GATE_APPLIES_FROM);
const PENDING_ROOM_BREAKDOWN_KEY = '_pendingRoomUploads';

export interface PendingRoomUpload {
  key: string;
  completedKey?: string;
  sizeBytes: number;
  reservedAt?: string;
}

export interface MemberUploadUsage {
  fileCount: number;
  usedBytes: number;
}

async function tableExists(sql: SqlRunner, table: string): Promise<boolean> {
  const row = (await sql.query<{ t: string | null }>('select to_regclass($1)::text as t', [`public.${table}`])).rows[0];
  return Boolean(row?.t);
}

const toSafeCount = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

const toSafeBytes = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** Extract all unsent room upload reservations (`_pendingRoomUploads`) without expiring by age. */
export function readPendingRoomUploads(breakdown: unknown): PendingRoomUpload[] {
  if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) return [];
  const rawList = (breakdown as Record<string, unknown>)[PENDING_ROOM_BREAKDOWN_KEY];
  if (!Array.isArray(rawList)) return [];
  const out: PendingRoomUpload[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const key = typeof obj.key === 'string' ? obj.key : '';
    if (!key) continue;
    const completedKey = typeof obj.completedKey === 'string' && obj.completedKey ? obj.completedKey : undefined;
    const sizeBytes = toSafeBytes(obj.sizeBytes);
    const reservedAt =
      typeof obj.reservedAt === 'string' && obj.reservedAt
        ? obj.reservedAt
        : typeof obj.expiresAt === 'string' && obj.expiresAt
          ? obj.expiresAt
          : undefined;
    out.push({
      key,
      ...(completedKey ? { completedKey } : {}),
      sizeBytes,
      ...(reservedAt ? { reservedAt } : {}),
    });
  }
  return out;
}

async function lockOrgForPending(sql: SqlRunner, organizationId: string): Promise<boolean> {
  const row = (await sql.query<{ id: string }>('select id from brand_organizations where id = $1 for update', [organizationId])).rows[0];
  return Boolean(row?.id);
}

async function updatePendingRoomUploads(
  sql: SqlRunner,
  organizationId: string,
  mutate: (current: PendingRoomUpload[]) => PendingRoomUpload[],
): Promise<void> {
  if (!UUID_RE.test(organizationId)) return;
  if (!(await tableExists(sql, 'brand_storage_quotas'))) return;
  if (!(await lockOrgForPending(sql, organizationId))) return;
  const existing = (
    await sql.query<{ breakdown: Record<string, unknown> | null }>(
      'select breakdown from brand_storage_quotas where organization_id = $1 for update',
      [organizationId],
    )
  ).rows[0];
  const baseObj =
    existing?.breakdown && typeof existing.breakdown === 'object' && !Array.isArray(existing.breakdown)
      ? { ...existing.breakdown }
      : {};
  const current = readPendingRoomUploads(baseObj);
  const next = mutate(current);
  if (next.length > 0) {
    baseObj[PENDING_ROOM_BREAKDOWN_KEY] = next;
  } else {
    delete baseObj[PENDING_ROOM_BREAKDOWN_KEY];
  }
  await sql.query(
    `insert into brand_storage_quotas (organization_id, used_bytes, breakdown, updated_at)
       values ($1, 0, $2::jsonb, now())
     on conflict (organization_id) do update
       set breakdown = excluded.breakdown,
           updated_at = now()`,
    [organizationId, JSON.stringify(baseObj)],
  );
}

/** Record an in-flight `attachment.reserve` upload for a gated organization (never expires while unsent). */
export async function reservePendingRoomUpload(
  sql: SqlRunner,
  organizationId: string,
  entry: { key: string; sizeBytes: number; now?: Date },
): Promise<void> {
  const reservedAt = (entry.now ?? new Date()).toISOString();
  await updatePendingRoomUploads(sql, organizationId, (list) => [
    ...list.filter((item) => item.key !== entry.key && item.completedKey !== entry.key),
    { key: entry.key, sizeBytes: toSafeBytes(entry.sizeBytes), reservedAt },
  ]);
}

/** Bind a completed `storage_key` (`attachment.complete`) to its staging reservation while still unsent in chat. */
export async function completePendingRoomUpload(
  sql: SqlRunner,
  organizationId: string,
  entry: { stagingKey: string; completedKey: string; sizeBytes: number; now?: Date },
): Promise<void> {
  const reservedAt = (entry.now ?? new Date()).toISOString();
  await updatePendingRoomUploads(sql, organizationId, (list) => [
    ...list.filter((item) => item.key !== entry.stagingKey && item.completedKey !== entry.completedKey),
    { key: entry.stagingKey, completedKey: entry.completedKey, sizeBytes: toSafeBytes(entry.sizeBytes), reservedAt },
  ]);
}

/** Drop pending room reservations once their attachments have been persisted in `brand_room_messages`. */
export async function consumePendingRoomUploadKeys(
  sql: SqlRunner,
  organizationId: string,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  const keySet = new Set(keys);
  await updatePendingRoomUploads(sql, organizationId, (list) =>
    list.filter((item) => !keySet.has(item.key) && (!item.completedKey || !keySet.has(item.completedKey))),
  );
}

/**
 * Returns `true` when uploads for `organizationId` are EXEMPT from the 500 MB / 50-file pre-approval cap.
 */
export async function isOrganizationUploadApproved(
  sql: SqlRunner,
  organizationId: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!UUID_RE.test(organizationId)) return false;

  const orgRow = (
    await sql.query<{ created_at: Date | string; studio_managed: boolean }>(
      'select created_at, studio_managed from brand_organizations where id = $1',
      [organizationId],
    )
  ).rows[0];
  if (!orgRow) return false;
  if (orgRow.studio_managed === true) return true;

  const createdMs = new Date(orgRow.created_at).getTime();
  if (Number.isFinite(createdMs) && createdMs < UPLOAD_GATE_APPLIES_FROM_MS) return true;

  // 0) An admin approved the workspace (BRAND_WORKSPACE_APPROVAL, migration 0184): exempt for good, so the limit does
  //    not come back when the trial credits run out. Flag off: not looked at, the checks below run exactly as before.
  if (brandWorkspaceApprovalOpen() && (await loadWorkspaceApprovalSchemaReady(sql)) && (await hasWorkspaceApproval(sql, organizationId))) {
    return true;
  }

  // 1) Allowance cap > 0
  const allowance = await loadAllowance(sql, organizationId, studioEnv(), now);
  if (allowance.capKrw > 0) return true;

  // 2) Admin storage-quota override row exists (quota_bytes is not null)
  if (await tableExists(sql, 'brand_storage_quotas')) {
    const quotaRow = (
      await sql.query('select 1 from brand_storage_quotas where organization_id = $1 and quota_bytes is not null limit 1', [
        organizationId,
      ])
    ).rows[0];
    if (quotaRow) return true;
  }

  // 3) ANY plan assignment has EVER existed (active OR ended)
  if (await tableExists(sql, 'brand_plan_assignments')) {
    const planRow = (
      await sql.query('select 1 from brand_plan_assignments where organization_id = $1 limit 1', [organizationId])
    ).rows[0];
    if (planRow) return true;
  }
  if (await tableExists(sql, 'brand_plan_events')) {
    const planEvt = (
      await sql.query('select 1 from brand_plan_events where organization_id = $1 limit 1', [organizationId])
    ).rows[0];
    if (planEvt) return true;
  }

  // 4) Any commissioned / staff-created project, contract, storyboard, room line, delivery, or content version exists
  if (await tableExists(sql, 'brand_projects')) {
    const staffProject = (
      await sql.query(
        `select 1
           from brand_projects bp
           join profiles p on p.id = bp.created_by
          where bp.organization_id = $1 and p.is_admin = true
          limit 1`,
        [organizationId],
      )
    ).rows[0];
    if (staffProject) return true;
  }
  if (await tableExists(sql, 'brand_contract_documents')) {
    const staffContract = (
      await sql.query(
        `select 1
           from brand_contract_documents c
           join profiles p on p.id = c.created_by
          where c.organization_id = $1 and p.is_admin = true
          limit 1`,
        [organizationId],
      )
    ).rows[0];
    if (staffContract) return true;
  }
  if (await tableExists(sql, 'brand_storyboards')) {
    const staffBoard = (
      await sql.query(
        `select 1
           from brand_storyboards
          where organization_id = $1 and created_role = 'studio' and deleted_at is null
          limit 1`,
        [organizationId],
      )
    ).rows[0];
    if (staffBoard) return true;
  }
  if (await tableExists(sql, 'brand_room_messages')) {
    const staffMsg = (
      await sql.query(
        `select 1
           from brand_room_messages
          where organization_id = $1 and author_role = 'studio' and deleted_at is null
          limit 1`,
        [organizationId],
      )
    ).rows[0];
    if (staffMsg) return true;
  }
  if (await tableExists(sql, 'brand_messages')) {
    const staffLegacy = (
      await sql.query(
        `select 1
           from brand_messages
          where organization_id = $1 and author_role = 'studio'
          limit 1`,
        [organizationId],
      )
    ).rows[0];
    if (staffLegacy) return true;
  }
  if (await tableExists(sql, 'brand_content_versions')) {
    const deliveredVersion = (
      await sql.query('select 1 from brand_content_versions where organization_id = $1 limit 1', [organizationId])
    ).rows[0];
    if (deliveredVersion) return true;
  }
  if (await tableExists(sql, 'brand_studio_assets')) {
    const studioDelivery = (
      await sql.query(
        `select 1
           from brand_studio_assets
          where organization_id = $1 and source = 'delivery' and deleted_at is null
          limit 1`,
        [organizationId],
      )
    ).rows[0];
    if (studioDelivery) return true;
  }

  return false;
}

/**
 * Counts files and bytes uploaded ONLY by the organization's own non-admin members across all upload surfaces:
 * Studio uploads, brand storyboard upload frames, non-deleted brand room message attachments + live pending
 * room upload reservations, project attachments, and the currently active non-admin org logo.
 */
export async function loadMemberUploadUsage(
  sql: SqlRunner,
  organizationId: string,
  options?: { excludePendingRoomKeys?: readonly string[]; now?: Date },
): Promise<MemberUploadUsage> {
  if (!UUID_RE.test(organizationId)) return { fileCount: 0, usedBytes: 0 };
  const now = options?.now ?? new Date();
  const excludeSet = new Set(options?.excludePendingRoomKeys ?? []);

  let fileCount = 0;
  let usedBytes = 0;

  if (await tableExists(sql, 'brand_studio_assets')) {
    const row = (
      await sql.query<{ n: number; bytes: string | number }>(
        `select count(*)::int as n, coalesce(sum(a.size_bytes), 0)::bigint as bytes
           from brand_studio_assets a
           left join profiles p on p.id = a.created_by
          where a.organization_id = $1
            and a.deleted_at is null
            and a.source = 'upload'
            and coalesce(p.is_admin, false) = false
            and a.status in ('ready', 'pending')`,
        [organizationId],
      )
    ).rows[0];
    fileCount += toSafeCount(row?.n);
    usedBytes += toSafeBytes(row?.bytes);
  }

  if (await tableExists(sql, 'brand_storyboard_frames')) {
    const row = (
      await sql.query<{ n: number; bytes: string | number }>(
        `select count(*)::int as n, coalesce(sum(f.size_bytes), 0)::bigint as bytes
           from brand_storyboard_frames f
           join brand_storyboards b on b.id = f.storyboard_id
           left join profiles p on p.id = f.created_by
          where f.organization_id = $1
            and b.deleted_at is null
            and b.created_role = 'brand'
            and f.source = 'upload'
            and coalesce(p.is_admin, false) = false
            and f.status in ('ready', 'pending')`,
        [organizationId],
      )
    ).rows[0];
    fileCount += toSafeCount(row?.n);
    usedBytes += toSafeBytes(row?.bytes);
  }

  const seenRoomKeys = new Map<string, number>();
  if (await tableExists(sql, 'brand_room_messages')) {
    const msgRows = (
      await sql.query<{ attachments: unknown }>(
        `select m.attachments
           from brand_room_messages m
           left join profiles p on p.id = m.author_id
          where m.organization_id = $1
            and m.deleted_at is null
            and m.author_role = 'brand'
            and coalesce(p.is_admin, false) = false
            and jsonb_typeof(m.attachments) = 'array'
            and jsonb_array_length(m.attachments) > 0`,
        [organizationId],
      )
    ).rows;
    for (const row of msgRows) {
      if (!Array.isArray(row.attachments)) continue;
      for (const item of row.attachments) {
        if (!item || typeof item !== 'object') continue;
        const att = item as { key?: unknown; size?: unknown };
        const key = typeof att.key === 'string' ? att.key : '';
        if (!key) continue;
        const size = toSafeBytes(att.size);
        const prev = seenRoomKeys.get(key) ?? 0;
        if (!seenRoomKeys.has(key) || size > prev) seenRoomKeys.set(key, size);
      }
    }
  }

  if (await tableExists(sql, 'brand_storage_quotas')) {
    const quotaRow = (
      await sql.query<{ breakdown: unknown }>('select breakdown from brand_storage_quotas where organization_id = $1', [
        organizationId,
      ])
    ).rows[0];
    const pendingEntries = readPendingRoomUploads(quotaRow?.breakdown);
    const seenPending = new Set<string>();
    for (const entry of pendingEntries) {
      const effectiveKey = entry.completedKey ?? entry.key;
      if (excludeSet.has(entry.key) || (entry.completedKey && excludeSet.has(entry.completedKey))) continue;
      if (entry.completedKey && seenRoomKeys.has(entry.completedKey)) continue;
      if (seenPending.has(effectiveKey)) continue;
      seenPending.add(effectiveKey);
      fileCount += 1;
      usedBytes += entry.sizeBytes;
    }
  }

  fileCount += seenRoomKeys.size;
  for (const bytes of seenRoomKeys.values()) usedBytes += bytes;

  if (await tableExists(sql, 'brand_attachments')) {
    const row = (
      await sql.query<{ n: number; bytes: string | number }>(
        `select count(*)::int as n, coalesce(sum(ba.size_bytes), 0)::bigint as bytes
           from brand_attachments ba
           left join profiles p on p.id = ba.created_by
          where ba.organization_id = $1
            and coalesce(p.is_admin, false) = false
            and ba.status in ('ready', 'pending')`,
        [organizationId],
      )
    ).rows[0];
    fileCount += toSafeCount(row?.n);
    usedBytes += toSafeBytes(row?.bytes);
  }

  if (await tableExists(sql, 'brand_organization_logos')) {
    const row = (
      await sql.query<{ bytes: string | number }>(
        `select coalesce(l.size_bytes, 0)::bigint as bytes
           from brand_organizations o
           join brand_organization_logos l on l.id = o.logo_id
           left join profiles p on p.id = l.created_by
          where o.id = $1 and coalesce(p.is_admin, false) = false`,
        [organizationId],
      )
    ).rows[0];
    if (row) {
      fileCount += 1;
      usedBytes += toSafeBytes(row.bytes);
    }
  }

  return { fileCount, usedBytes };
}

/** Counts uploaded files owned by the organization's non-admin members (never staff/team uploads or deliveries). */
export async function countOrganizationUploadedFiles(sql: SqlRunner, organizationId: string): Promise<number> {
  const usage = await loadMemberUploadUsage(sql, organizationId);
  return usage.fileCount;
}
