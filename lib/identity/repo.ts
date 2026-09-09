import type { SqlRunner } from '@/lib/db/sql-runner';
import type { ArkAssetStatus } from '@/lib/ark/assets';

/**
 * Every `identity_groups` / `identity_assets` statement (migration 0019), driver-agnostic like the
 * other repos: the tests drive these on PGlite, the app on Supabase Postgres.
 */

export type IdentityStatus = 'pending' | 'active' | 'failed' | 'revoked';

export interface IdentityGroup {
  userId: string;
  groupId: string | null;
  status: IdentityStatus;
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

const GROUP_COLUMNS = 'user_id, group_id, status, byted_token, h5_link, next_path, session_started_at, verified_at, last_render_at, failure_code';
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
        set status = 'active', group_id = $2, verified_at = $3::timestamptz, byted_token = null, h5_link = null, failure_code = null
      where user_id = $1`,
    [userId, args.groupId, args.now.toISOString()],
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
