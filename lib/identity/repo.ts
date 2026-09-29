import type { SqlRunner } from '@/lib/db/sql-runner';
import type { ArkAssetStatus } from '@/lib/ark/assets';

/**
 * Every `identity_groups` / `identity_assets` statement (migration 0019), driver-agnostic like the
 * other repos: the tests drive these on PGlite, the app on Supabase Postgres.
 */

/** `evicted` (0040): the bank's copy was deleted by slot rotation; the next render makes it again. */
export type IdentityStatus = 'pending' | 'active' | 'failed' | 'revoked' | 'evicted';

/** Which ModelArk library the group lives in (0024). See lib/flags.ts ASSET_LIBRARY_MODE. */
export type IdentityGroupType = 'LivenessFace' | 'AIGC';

export interface IdentityGroup {
  userId: string;
  groupId: string | null;
  status: IdentityStatus;
  groupType: IdentityGroupType;
  bytedToken: string | null;
  h5Link: string | null;
  nextPath: string | null;
  sessionStartedAt: string | null;
  verifiedAt: string | null;
  lastRenderAt: string | null;
  failureCode: string | null;
}

export interface IdentityAsset {
  id: string;
  userId: string;
  groupId: string;
  assetId: string;
  photoSha256: string;
  status: ArkAssetStatus;
  createdAt: string;
  activatedAt: string | null;
  lastUsedAt: string | null;
}

interface GroupRow {
  user_id: string;
  group_id: string | null;
  status: IdentityStatus;
  group_type: IdentityGroupType;
  byted_token: string | null;
  h5_link: string | null;
  next_path: string | null;
  session_started_at: Date | string | null;
  verified_at: Date | string | null;
  last_render_at: Date | string | null;
  failure_code: string | null;
}

interface AssetRow {
  id: string;
  user_id: string;
  group_id: string;
  asset_id: string;
  photo_sha256: string;
  status: ArkAssetStatus;
  created_at: Date | string;
  activated_at: Date | string | null;
  last_used_at: Date | string | null;
}

const GROUP_COLUMNS = 'user_id, group_id, status, group_type, byted_token, h5_link, next_path, session_started_at, verified_at, last_render_at, failure_code';
const ASSET_COLUMNS = 'id, user_id, group_id, asset_id, photo_sha256, status, created_at, activated_at, last_used_at';

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toGroup(row: GroupRow): IdentityGroup {
  return {
    userId: row.user_id,
    groupId: row.group_id,
    status: row.status,
    groupType: row.group_type === 'AIGC' ? 'AIGC' : 'LivenessFace',
    bytedToken: row.byted_token,
    h5Link: row.h5_link,
    nextPath: row.next_path,
    sessionStartedAt: iso(row.session_started_at),
    verifiedAt: iso(row.verified_at),
    lastRenderAt: iso(row.last_render_at),
    failureCode: row.failure_code,
  };
}

function toAsset(row: AssetRow): IdentityAsset {
  return {
    id: row.id,
    userId: row.user_id,
    groupId: row.group_id,
    assetId: row.asset_id,
    photoSha256: row.photo_sha256,
    status: row.status,
    createdAt: iso(row.created_at) ?? '',
    activatedAt: iso(row.activated_at),
    lastUsedAt: iso(row.last_used_at),
  };
}

// ---------------------------------------------------------------------------
// groups (one per person)
// ---------------------------------------------------------------------------

export async function loadIdentityGroup(sql: SqlRunner, userId: string): Promise<IdentityGroup | null> {
  const { rows } = await sql.query<GroupRow>(`select ${GROUP_COLUMNS} from identity_groups where user_id = $1`, [userId]);
  return rows[0] ? toGroup(rows[0]) : null;
}

export async function loadIdentityGroupByToken(sql: SqlRunner, bytedToken: string): Promise<IdentityGroup | null> {
  const { rows } = await sql.query<GroupRow>(`select ${GROUP_COLUMNS} from identity_groups where byted_token = $1`, [bytedToken]);
  return rows[0] ? toGroup(rows[0]) : null;
}

/** A new liveness session: the row is created or reset to `pending` with the session's token and page. */
export async function upsertIdentitySession(
  sql: SqlRunner,
  args: { userId: string; bytedToken: string; h5Link: string; nextPath: string | null; now: Date },
): Promise<void> {
  await sql.query(
    `insert into identity_groups (user_id, status, byted_token, h5_link, next_path, session_started_at, failure_code)
     values ($1, 'pending', $2, $3, $4, $5::timestamptz, null)
     on conflict (user_id) do update
       set status = 'pending', byted_token = excluded.byted_token, h5_link = excluded.h5_link,
           next_path = excluded.next_path, session_started_at = excluded.session_started_at, failure_code = null`,
    [args.userId, args.bytedToken, args.h5Link, args.nextPath, args.now.toISOString()],
  );
}

/** The liveness result was read: the person now holds a group. The session is consumed. */
export async function activateIdentityGroup(sql: SqlRunner, userId: string, args: { groupId: string; now: Date }): Promise<void> {
  await sql.query(
    `update identity_groups
        set status = 'active', group_id = $2, group_type = 'LivenessFace', verified_at = $3::timestamptz, byted_token = null, h5_link = null, failure_code = null
      where user_id = $1`,
    [userId, args.groupId, args.now.toISOString()],
  );
}

/**
 * The virtual library (0024): the person holds an AIGC group the moment we create one for them —
 * no session, no token, `verified_at` is simply when it was made. A LivenessFace row already
 * `active` is left alone by the caller (a verified face is the stricter thing and works as well).
 */
export async function upsertVirtualIdentityGroup(sql: SqlRunner, args: { userId: string; groupId: string; now: Date }): Promise<void> {
  await sql.query(
    `insert into identity_groups (user_id, status, group_id, group_type, verified_at, byted_token, h5_link, failure_code)
     values ($1, 'active', $2, 'AIGC', $3::timestamptz, null, null, null)
     on conflict (user_id) do update
       set status = 'active', group_id = excluded.group_id, group_type = 'AIGC', verified_at = excluded.verified_at,
           byted_token = null, h5_link = null, failure_code = null`,
    [args.userId, args.groupId, args.now.toISOString()],
  );
}

export async function failIdentityGroup(sql: SqlRunner, userId: string, code: string): Promise<void> {
  await sql.query(`update identity_groups set status = 'failed', failure_code = $2, byted_token = null where user_id = $1`, [userId, code.slice(0, 80)]);
}

export async function touchIdentityRender(sql: SqlRunner, userId: string, now: Date): Promise<void> {
  await sql.query(`update identity_groups set last_render_at = $2::timestamptz where user_id = $1`, [userId, now.toISOString()]);
}

/** What the free tier's 50/50 cap is measured against: verified people and photos not yet failed. */
export async function countIdentity(sql: SqlRunner): Promise<{ groups: number; assets: number }> {
  const { rows } = await sql.query<{ groups: number | string; assets: number | string }>(
    `select (select count(*) from identity_groups where status = 'active')::int as groups,
            (select count(*) from identity_assets where status <> 'Failed')::int as assets`,
  );
  return { groups: Number(rows[0]?.groups ?? 0), assets: Number(rows[0]?.assets ?? 0) };
}

// ---------------------------------------------------------------------------
// assets (one per photo per person)
// ---------------------------------------------------------------------------

export async function loadIdentityAssetByPhoto(sql: SqlRunner, userId: string, photoSha256: string): Promise<IdentityAsset | null> {
  const { rows } = await sql.query<AssetRow>(`select ${ASSET_COLUMNS} from identity_assets where user_id = $1 and photo_sha256 = $2`, [userId, photoSha256]);
  return rows[0] ? toAsset(rows[0]) : null;
}

export async function loadIdentityAssetByAssetId(sql: SqlRunner, assetId: string): Promise<IdentityAsset | null> {
  const { rows } = await sql.query<AssetRow>(`select ${ASSET_COLUMNS} from identity_assets where asset_id = $1`, [assetId]);
  return rows[0] ? toAsset(rows[0]) : null;
}

export async function insertIdentityAsset(sql: SqlRunner, args: { userId: string; groupId: string; assetId: string; photoSha256: string; status: ArkAssetStatus }): Promise<void> {
  await sql.query(
    `insert into identity_assets (user_id, group_id, asset_id, photo_sha256, status)
     values ($1, $2, $3, $4, $5)
     on conflict (user_id, photo_sha256) do update set asset_id = excluded.asset_id, group_id = excluded.group_id, status = excluded.status`,
    [args.userId, args.groupId, args.assetId, args.photoSha256, args.status],
  );
}

export async function updateIdentityAssetStatus(sql: SqlRunner, assetId: string, status: ArkAssetStatus, now: Date): Promise<void> {
  await sql.query(
    `update identity_assets
        set status = $2, activated_at = case when $2 = 'Active' then coalesce(activated_at, $3::timestamptz) else activated_at end
      where asset_id = $1`,
    [assetId, status, now.toISOString()],
  );
}

export async function touchIdentityAsset(sql: SqlRunner, assetId: string, now: Date): Promise<void> {
  await sql.query(`update identity_assets set last_used_at = $2::timestamptz where asset_id = $1`, [assetId, now.toISOString()]);
}

// ---------------------------------------------------------------------------
// slot rotation (0040, lib/identity/rotation.ts)
// ---------------------------------------------------------------------------

/**
 * What the bank is holding for us right now, as far as our rows know: every active group, and every
 * asset row — a Failed asset included, because it keeps its slot until someone deletes it.
 */
export async function countResident(sql: SqlRunner): Promise<{ groups: number; assets: number }> {
  const { rows } = await sql.query<{ groups: number | string; assets: number | string }>(
    `select (select count(*) from identity_groups where status = 'active' and group_id is not null)::int as groups,
            (select count(*) from identity_assets)::int as assets`,
  );
  return { groups: Number(rows[0]?.groups ?? 0), assets: Number(rows[0]?.assets ?? 0) };
}

export interface ResidentGroupRow {
  userId: string;
  groupId: string;
  groupType: IdentityGroupType;
  /** The disuse clock: the last render, else when the group was made. */
  lastUsedAt: string;
  /** The person has a render held, queued or running — their assets may be in a task right now. */
  busy: boolean;
}

export interface ResidentAssetRow {
  assetId: string;
  groupId: string;
  userId: string;
  groupType: IdentityGroupType;
  status: ArkAssetStatus;
  lastUsedAt: string;
  busy: boolean;
}

const BUSY_USERS = `select distinct user_id from render_jobs where status in ('held', 'queued', 'running')`;

export async function loadResidentInventory(sql: SqlRunner): Promise<{ groups: ResidentGroupRow[]; assets: ResidentAssetRow[] }> {
  const groups = await sql.query<{ user_id: string; group_id: string; group_type: IdentityGroupType; last_used_at: Date | string; busy: boolean }>(
    `select g.user_id, g.group_id, g.group_type,
            coalesce(g.last_render_at, g.verified_at) as last_used_at,
            (g.user_id in (${BUSY_USERS})) as busy
       from identity_groups g
      where g.status = 'active' and g.group_id is not null`,
  );
  const assets = await sql.query<{ asset_id: string; group_id: string; user_id: string; group_type: IdentityGroupType | null; status: ArkAssetStatus; last_used_at: Date | string; busy: boolean }>(
    `select a.asset_id, a.group_id, a.user_id, g.group_type, a.status,
            coalesce(a.last_used_at, a.activated_at, a.created_at) as last_used_at,
            (a.user_id in (${BUSY_USERS})) as busy
       from identity_assets a
       left join identity_groups g on g.user_id = a.user_id`,
  );
  return {
    groups: groups.rows.map((r) => ({ userId: r.user_id, groupId: r.group_id, groupType: r.group_type === 'AIGC' ? 'AIGC' : 'LivenessFace', lastUsedAt: iso(r.last_used_at) ?? '', busy: r.busy === true })),
    assets: assets.rows.map((r) => ({
      assetId: r.asset_id,
      groupId: r.group_id,
      userId: r.user_id,
      // An asset whose group row is gone or was a verified face is never rotated.
      groupType: r.group_type === 'AIGC' ? 'AIGC' : 'LivenessFace',
      status: r.status,
      lastUsedAt: iso(r.last_used_at) ?? '',
      busy: r.busy === true,
    })),
  };
}

export async function deleteIdentityAssetRow(sql: SqlRunner, assetId: string): Promise<void> {
  await sql.query(`delete from identity_assets where asset_id = $1`, [assetId]);
}

/** The bank no longer holds the group: the person's row says so and any photo rows left go with it. */
export async function evictIdentityGroup(sql: SqlRunner, args: { userId: string; groupId: string; now: Date }): Promise<void> {
  await sql.query(`delete from identity_assets where user_id = $1 and group_id = $2`, [args.userId, args.groupId]);
  await sql.query(
    `update identity_groups set status = 'evicted', evicted_at = $3::timestamptz where user_id = $1 and group_id = $2 and status = 'active'`,
    [args.userId, args.groupId, args.now.toISOString()],
  );
}
