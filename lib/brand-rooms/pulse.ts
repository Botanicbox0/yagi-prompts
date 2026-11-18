/**
 * The room's pulse (docs/BRAND-ROOMS-FEEDBACK.md §11): one cheap read that answers "did anything change?"
 * with a short stamp per part, so a screen re-reads only the part that moved instead of everything on a
 * timer. Each stamp is a hash of a few indexed counts and latest times; it carries no content.
 *
 * Three doors share `pulseStamp` and each authorizes like the data it summarises:
 *   · a brand member: `roomPulse`, behind the room seat and the project check (lib/brand-rooms/access.ts);
 *   · a share link's guest: `sharePulse` in ./shares.ts, the one shared item only, behind the token and the
 *     passphrase proof;
 *   · the team: `staffRoomPulse`, the admin flag re-read and open organizations only.
 *
 * Team notes (0093) count for the team alone: the brand's and the guest's stamps are built from public
 * notes only, so a team note never moves them. The sandbox hardline answers `not_found` on every door.
 */
import { createHash } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { assertBrandFeature, BrandFeatureDenied, isSandboxedClientOrganization } from '@/lib/brands/entitlements';
import { brandRoomsOpen } from '@/lib/flags';
import { roomReviewReady } from '@/lib/brand-studio/review';
import { publicNotesOnly, teamNotesReady } from '@/lib/brand-studio/review-visibility';
import { RoomDenied, requireRoomProject, roomSeat } from './access';
import type { RoomErrorCode } from './message-contracts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One project's parts. `shares` only for those who manage links (owners, editors, the team). */
export interface RoomPulseStamp {
  chat: string;
  reviews: string;
  storyboards: string;
  shares: string | null;
}
export interface RoomPulse {
  ok: true;
  stamp: RoomPulseStamp;
}
/** A share link's one item. */
export interface SharePulseResult {
  ok: true;
  stamp: { item: string };
}
export type PulseFailure = { ok: false; code: RoomErrorCode };

/** What a stamp is computed over. */
export type PulseScope =
  | { kind: 'project'; organizationId: string; projectId: string; team: boolean; shares: boolean }
  | { kind: 'review'; organizationId: string; reviewId: string; team: boolean }
  | { kind: 'stack'; organizationId: string; reviewId: string; team: boolean }
  | { kind: 'storyboard'; organizationId: string; storyboardId: string };

/** The rows behind a stamp, hashed: 16 base64url characters, the same for the same rows. */
export function stampOf(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('base64url').slice(0, 16);
}

const at = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

/**
 * Counts and latest times of the notes on the reviews `where` selects (alias `r`). The brand's and the
 * guest's reads add the public-only condition; the team's do not.
 */
async function notesAggregate(sql: SqlRunner, where: string, params: unknown[], team: boolean): Promise<unknown[]> {
  const visibility = team ? '' : publicNotesOnly('c', await teamNotesReady(sql));
  const row = (
    await sql.query<Record<string, unknown>>(
      `select count(*)::int as n, count(c.resolved_at)::int as resolved, count(c.deleted_at)::int as deleted,
              max(c.created_at) as created, max(c.resolved_at) as resolved_at, max(c.deleted_at) as deleted_at
         from brand_studio_review_comments c join brand_studio_reviews r on r.id = c.review_id
        where ${where}${visibility}`,
      params,
    )
  ).rows[0];
  return [row?.n ?? 0, row?.resolved ?? 0, row?.deleted ?? 0, at(row?.created), at(row?.resolved_at), at(row?.deleted_at)];
}

/** The review rows `where` selects: how many, the latest activity and the latest status move. */
async function reviewsAggregate(sql: SqlRunner, where: string, params: unknown[]): Promise<unknown[]> {
  const row = (
    await sql.query<Record<string, unknown>>(
      `select count(*)::int as n, max(r.updated_at) as updated, max(r.status_changed_at) as moved
         from brand_studio_reviews r where ${where} and r.deleted_at is null`,
      params,
    )
  ).rows[0];
  return [row?.n ?? 0, at(row?.updated), at(row?.moved)];
}

/** The stamp(s) for one scope. Callers have authorized the reader; this only counts. */
export async function pulseStamp(sql: SqlRunner, scope: PulseScope): Promise<Record<string, string | null>> {
  if (scope.kind === 'storyboard') {
    const row = (
      await sql.query<Record<string, unknown>>(
        `select b.updated_at, b.status, b.status_changed_at, b.deleted_at,
                (select count(*)::int from brand_storyboard_frames f where f.storyboard_id = b.id) as frames
           from brand_storyboards b where b.id = $1 and b.organization_id = $2`,
        [scope.storyboardId, scope.organizationId],
      )
    ).rows[0];
    return { item: stampOf(row ? [at(row.updated_at), row.status, at(row.status_changed_at), at(row.deleted_at), row.frames] : null) };
  }

  if (scope.kind === 'review' || scope.kind === 'stack') {
    const rooms = await roomReviewReady(sql);
    // One piece (a share link), or every version of its stack (the team's page follows new versions too).
    const where =
      scope.kind === 'stack' && rooms
        ? `r.organization_id = $1 and coalesce(r.stack_id, r.id) = (select coalesce(s.stack_id, s.id) from brand_studio_reviews s where s.id = $2)`
        : `r.organization_id = $1 and r.id = $2`;
    const params = [scope.organizationId, scope.reviewId];
    // One after another on the transaction's one connection.
    const reviews = await reviewsAggregate(sql, where, params);
    const notes = await notesAggregate(sql, where, params, scope.team);
    const key = scope.kind === 'stack' ? 'reviews' : 'item';
    return { [key]: stampOf([reviews, notes]) };
  }

  const params = [scope.organizationId, scope.projectId];
  const rooms = await roomReviewReady(sql);
  const projectReviews = 'r.organization_id = $1 and r.project_id = $2';
  const reviews = rooms ? await reviewsAggregate(sql, projectReviews, params) : ['none'];
  const notes = rooms ? await notesAggregate(sql, projectReviews, params, scope.team) : ['none'];
  const chat = (
    await sql.query<Record<string, unknown>>(
      `select count(*)::int as n, max(m.updated_at) as updated, max(m.created_at) as created
         from brand_room_messages m where m.organization_id = $1 and m.channel = $2::text`,
      params,
    )
  ).rows[0];
  const boards = (
    await sql.query<Record<string, unknown>>(
      `select count(*)::int as n, max(b.updated_at) as updated, max(b.status_changed_at) as moved
         from brand_storyboards b
        where b.organization_id = $1 and b.project_id = $2 and b.deleted_at is null
              ${scope.team ? '' : "and (b.created_role = 'brand' or b.status <> 'draft')"}`,
      params,
    )
  ).rows[0];
  const shares =
    scope.shares && rooms
      ? (
          await sql.query<Record<string, unknown>>(
            `select count(*)::int as n, count(s.revoked_at)::int as revoked, max(s.created_at) as created, max(s.revoked_at) as revoked_at
               from brand_room_shares s where s.organization_id = $1 and s.project_id = $2`,
            params,
          )
        ).rows[0]
      : null;
  return {
    chat: stampOf([chat?.n ?? 0, at(chat?.updated), at(chat?.created)]),
    reviews: stampOf([reviews, notes]),
    storyboards: stampOf([boards?.n ?? 0, at(boards?.updated), at(boards?.moved)]),
    shares: scope.shares ? stampOf(shares ? [shares.n, shares.revoked, at(shares.created), at(shares.revoked_at)] : null) : null,
  };
}

function toRoomStamp(parts: Record<string, string | null>): RoomPulseStamp {
  return { chat: parts.chat ?? '', reviews: parts.reviews ?? '', storyboards: parts.storyboards ?? '', shares: parts.shares ?? null };
}

/* ------------------------------------------------------------------ the brand member's door */

/**
 * `GET /api/brand-rooms/pulse?organizationId=&projectId=`: the room seat (membership or this project's
 * invitation, then the sandbox hardline and the generation policy), then the project. Public notes only.
 */
export async function roomPulse(deps: { sql: SqlRunner }, viewer: Viewer, input: { organizationId?: unknown; projectId?: unknown }): Promise<RoomPulse | PulseFailure> {
  if (!brandRoomsOpen()) return { ok: false, code: 'rooms_closed' };
  const organizationId = typeof input.organizationId === 'string' ? input.organizationId.trim() : '';
  const projectId = typeof input.projectId === 'string' ? input.projectId.trim().toLowerCase() : '';
  if (!UUID.test(organizationId) || !UUID.test(projectId)) return { ok: false, code: 'not_found' };
  try {
    return await deps.sql.transaction(async (sql) => {
      const seat = await roomSeat(sql, viewer.userId, organizationId);
      await requireRoomProject(sql, seat, projectId);
      const parts = await pulseStamp(sql, { kind: 'project', organizationId: seat.organizationId, projectId, team: false, shares: seat.canEdit });
      return { ok: true as const, stamp: toRoomStamp(parts) };
    });
  } catch (error) {
    if (error instanceof RoomDenied) return { ok: false, code: error.code };
    throw error;
  }
}

/* ------------------------------------------------------------------ the team's door */

/** The organization may show anything at all: it exists, is not sandboxed and generation is not closed. */
async function organizationOpen(sql: SqlRunner, organizationId: string): Promise<boolean> {
  const org = (await sql.query<{ id: string; name: string }>('select id, name from brand_organizations where id = $1', [organizationId])).rows[0];
  if (!org || isSandboxedClientOrganization(org)) return false;
  try {
    await assertBrandFeature(sql, organizationId, 'generative_media');
    return true;
  } catch (error) {
    if (error instanceof BrandFeatureDenied) return false;
    throw error;
  }
}

/**
 * The team's desk and review page (`/admin/brand-rooms/<org>/pulse?projectId=` or `?review=`): the admin
 * flag re-read from the profile row, an open organization, then a client-visible project of it or a live
 * review of it. Team notes included. With `review`, the stamp covers that review's whole stack.
 */
export async function staffRoomPulse(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: { organizationId?: unknown; projectId?: unknown; reviewId?: unknown },
): Promise<RoomPulse | PulseFailure> {
  if (!brandRoomsOpen()) return { ok: false, code: 'rooms_closed' };
  const organizationId = typeof input.organizationId === 'string' ? input.organizationId.trim().toLowerCase() : '';
  const projectId = typeof input.projectId === 'string' && input.projectId ? input.projectId.trim().toLowerCase() : null;
  const reviewId = typeof input.reviewId === 'string' && input.reviewId ? input.reviewId.trim().toLowerCase() : null;
  if (!UUID.test(organizationId) || (projectId === null) === (reviewId === null) || (projectId && !UUID.test(projectId)) || (reviewId && !UUID.test(reviewId))) {
    return { ok: false, code: 'not_found' };
  }
  if (!viewer.userId || !UUID.test(viewer.userId)) return { ok: false, code: 'sign_in_required' };
  return deps.sql.transaction(async (sql): Promise<RoomPulse | PulseFailure> => {
    const profile = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1', [viewer.userId])).rows[0];
    if (!profile) return { ok: false, code: 'sign_in_required' };
    if (profile.is_admin !== true) return { ok: false, code: 'not_found' };
    if (!(await organizationOpen(sql, organizationId))) return { ok: false, code: 'not_found' };
    if (projectId) {
      const project = (await sql.query('select id from brand_projects where id = $1 and organization_id = $2 and client_visible', [projectId, organizationId])).rows[0];
      if (!project) return { ok: false, code: 'not_found' };
      const parts = await pulseStamp(sql, { kind: 'project', organizationId, projectId, team: true, shares: true });
      return { ok: true, stamp: toRoomStamp(parts) };
    }
    const review = (await sql.query('select id from brand_studio_reviews where id = $1 and organization_id = $2 and deleted_at is null', [reviewId, organizationId])).rows[0];
    if (!review) return { ok: false, code: 'not_found' };
    const parts = await pulseStamp(sql, { kind: 'stack', organizationId, reviewId: reviewId!, team: true });
    return { ok: true, stamp: { chat: '', reviews: parts.reviews ?? '', storyboards: '', shares: null } };
  });
}
