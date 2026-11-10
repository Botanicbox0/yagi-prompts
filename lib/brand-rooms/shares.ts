/**
 * Share links (docs/BRAND-ROOMS.md §6, §9-3): one review item or one storyboard, shown to someone
 * outside the workspace at `/s/<token>`.
 *
 *   · The token is 256 random bits (base64url). The database keeps only its SHA-256; the token itself is
 *     returned once, to the person who made the link, and never again (lists never carry it).
 *   · Lookup is by the hash, then the stored hash is compared in constant time.
 *   · A revoked link, an expired link, a link of a sandboxed or generation-closed brand, a link whose item
 *     is gone, and BRAND_ROOMS off all answer exactly like a token that never existed: nothing (404).
 *   · A passphrase is stored as scrypt. The page asks for it; the right answer sets an http-only cookie
 *     holding an HMAC keyed by that stored hash, so the browser holds a proof and never the passphrase.
 *     Wrong answers count per link; after a few the link pauses for the rest of a ten-minute window.
 *   · A guest note carries the name they typed (`guest_name`), no account, and the link it came through;
 *     notes per link are limited per minute and per day.
 *   · A view counts at most once per visitor per hour (a random visitor cookie, stored only as a hash).
 *
 * Creating, listing and revoking pass the room seat (lib/brand-rooms/access.ts): a sandboxed brand never
 * gets past it (404), and only owners and editors manage links. The team lists and revokes from /admin.
 */
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { featureDenied, isSandboxedClientOrganization } from '@/lib/brands/features';
import { loadFeaturePolicies } from '@/lib/brands/entitlements';
import { brandRoomsOpen } from '@/lib/flags';
import type { StudioMediaStore } from '@/lib/brand-studio/media-store';
import { addGuestComment, reviewTarget, sharedReviewView } from '@/lib/brand-studio/review';
import type { ReviewComment, ReviewCommentAdded, ReviewItem } from '@/lib/brand-studio/review-contracts';
import { RoomDenied, requireEdit, requireRoomProject, roomSeat, type RoomSeat } from './access';
import type { StoryboardView } from '@/components/brand-rooms/seams';
import { storyboardForShare } from './storyboards';
import {
  SHARE_LIMITS,
  ShareCommentSchema,
  ShareCreateSchema,
  ShareListQuerySchema,
  ShareRevokeSchema,
  ShareUnlockSchema,
  ShareViewSchema,
  guestNoteOf,
  shareStateOf,
  type PublicShare,
  type ShareCreated,
  type ShareDone,
  type ShareErrorCode,
  type ShareFailure,
  type ShareKind,
  type ShareLink,
  type ShareList,
} from './share-contracts';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

export interface ShareDeps {
  sql: SqlRunner;
  media: StudioMediaStore;
  now?: () => Date;
}

export class ShareDenied extends Error {
  constructor(readonly code: ShareErrorCode) {
    super(code);
    this.name = 'ShareDenied';
  }
}

const failure = (code: ShareErrorCode): ShareFailure => ({ ok: false, code });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function guard<T>(fn: () => Promise<T>): Promise<T | ShareFailure> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ShareDenied) return failure(error.code);
    if (error instanceof RoomDenied) return failure(error.code);
    throw error;
  }
}

/* --------------------------------------------------------------- secrets */

export function newShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 32 } as const;

export async function hashPassphrase(passphrase: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(passphrase.normalize('NFC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassphrase(passphrase: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 1 << 17) return false;
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  if (!salt.length || !expected.length) return false;
  const actual = await scrypt(passphrase.normalize('NFC'), salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** The cookie that says "this browser gave the right passphrase for this link". */
export function unlockCookieName(shareId: string): string {
  return `twings_share_${shareId.replace(/-/g, '').slice(0, 32)}`;
}

/** An HMAC keyed by the stored passphrase hash: only the server can make it, and a new link cannot reuse it. */
export function unlockProof(share: { id: string; token_hash: string; passphrase_hash: string | null }): string {
  return createHmac('sha256', share.passphrase_hash ?? '').update(`twings-share:${share.id}:${share.token_hash}`).digest('base64url');
}

function proofMatches(share: ShareRow, presented: string | null | undefined): boolean {
  if (!share.passphrase_hash) return true;
  if (!presented) return false;
  const expected = Buffer.from(unlockProof(share));
  const given = Buffer.from(presented);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The visitor cookie (random, http-only); the database keeps only a hash of it per link. */
export const VISITOR_COOKIE = 'twings_share_visitor';
export const newVisitorId = () => randomBytes(16).toString('hex');
const isVisitorId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);

/* --------------------------------------------------------------- rows */

interface ShareRow {
  id: string;
  token_hash: string;
  organization_id: string;
  project_id: string | null;
  kind: ShareKind;
  target_id: string;
  allow_comments: boolean;
  allow_download: boolean;
  passphrase_hash: string | null;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  views: number;
  last_viewed_at: Date | string | null;
  unlock_failures: number;
  unlock_window_at: Date | string | null;
  created_role: 'brand' | 'studio';
  created_at: Date | string;
}

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const isoOrNull = (v: Date | string | null): string | null => (v == null ? null : iso(v));

function linkView(row: ShareRow, now: number): ShareLink {
  const expiresAt = iso(row.expires_at);
  const revokedAt = isoOrNull(row.revoked_at);
  return {
    id: String(row.id),
    kind: row.kind,
    targetId: String(row.target_id),
    allowComments: row.allow_comments === true,
    allowDownload: row.allow_download === true,
    hasPassphrase: Boolean(row.passphrase_hash),
    expiresAt,
    revokedAt,
    state: shareStateOf({ expiresAt, revokedAt }, now),
    views: Number(row.views ?? 0),
    lastViewedAt: isoOrNull(row.last_viewed_at),
    createdAt: iso(row.created_at),
    createdRole: row.created_role,
  };
}

async function sharesReady(sql: SqlRunner): Promise<boolean> {
  return (await sql.query<{ ready: boolean }>("select to_regclass('public.brand_room_shares') is not null and to_regclass('public.brand_room_share_visits') is not null as ready")).rows[0]?.ready === true;
}

/** The organization may show anything at all: not sandboxed and generation not closed. */
async function organizationOpen(sql: SqlRunner, organizationId: string): Promise<boolean> {
  const org = (await sql.query<{ id: string; name: string }>('select id, name from brand_organizations where id = $1', [organizationId])).rows[0];
  if (!org || isSandboxedClientOrganization(org)) return false;
  const denied = (await loadFeaturePolicies(sql, [org.id]))[org.id] ?? [];
  return !featureDenied(denied, 'generative_media');
}

/** The item a link would show: live, in this organization, in a room this seat may open. Returns its project. */
async function targetFor(deps: ShareDeps, sql: SqlRunner, seat: RoomSeat, kind: ShareKind, targetId: string): Promise<string | null> {
  if (kind === 'review') {
    const review = await reviewTarget(sql, seat.organizationId, targetId);
    if (!review) throw new ShareDenied('not_found');
    if (review.projectId) await requireRoomProject(sql, seat, review.projectId);
    else if (seat.projectIds) throw new ShareDenied('not_found');
    return review.projectId;
  }
  const board = (
    await sql.query<{ project_id: string; status: string }>(
      'select project_id, status from brand_storyboards where id = $1 and organization_id = $2 and deleted_at is null',
      [targetId, seat.organizationId],
    )
  ).rows[0];
  // A draft is not the brand's to see yet, so it is nobody else's either.
  if (!board || board.status === 'draft') throw new ShareDenied('not_found');
  await requireRoomProject(sql, seat, String(board.project_id));
  return String(board.project_id);
}

/** Owners and editors of a seated organization, with 0084 applied. */
async function editorSeat(sql: SqlRunner, viewer: Viewer, organizationId: string): Promise<RoomSeat> {
  const seat = await roomSeat(sql, viewer.userId, organizationId);
  requireEdit(seat);
  if (!(await sharesReady(sql))) throw new ShareDenied('provider_unavailable');
  return seat;
}

/* --------------------------------------------------------------- brand side */

export async function createShare(deps: ShareDeps, viewer: Viewer, raw: unknown): Promise<ShareCreated | ShareFailure> {
  // The seat before any detail is judged: a closed brand gets the same 404 whatever it sent.
  const organizationId = (raw as { organizationId?: unknown } | null)?.organizationId;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) return failure('invalid');
  const gate = await guard(() => deps.sql.transaction((sql) => editorSeat(sql, viewer, organizationId)));
  if ('ok' in gate) return gate;
  const parsed = ShareCreateSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const passphraseHash = v.passphrase ? await hashPassphrase(v.passphrase) : null;
  const now = (deps.now ?? (() => new Date()))();
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await editorSeat(sql, viewer, organizationId);
      const projectId = await targetFor(deps, sql, seat, v.kind, v.targetId);
      await sql.query('select id from brand_organizations where id = $1 for update', [organizationId]);
      const live = (
        await sql.query<{ n: number }>(
          'select count(*)::int as n from brand_room_shares where organization_id = $1 and kind = $2 and target_id = $3 and revoked_at is null and expires_at > now()',
          [organizationId, v.kind, v.targetId],
        )
      ).rows[0]!.n;
      if (Number(live) >= SHARE_LIMITS.livePerTarget) throw new ShareDenied('limit_reached');
      const token = newShareToken();
      const row = (
        await sql.query<ShareRow>(
          `insert into brand_room_shares (token_hash, organization_id, project_id, kind, target_id, allow_comments, allow_download, passphrase_hash, expires_at, created_by, created_role)
             values ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(days => $9), $10, 'brand') returning *`,
          [hashShareToken(token), organizationId, projectId, v.kind, v.targetId, v.allowComments, v.allowDownload, passphraseHash, v.expiresInDays, seat.userId],
        )
      ).rows[0]!;
      return { ok: true as const, share: linkView(row, now.getTime()), token };
    }),
  );
}

export async function listShares(deps: ShareDeps, viewer: Viewer, raw: unknown): Promise<ShareList | ShareFailure> {
  const parsed = ShareListQuerySchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const now = (deps.now ?? (() => new Date()))().getTime();
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await editorSeat(sql, viewer, v.organizationId);
      await targetFor(deps, sql, seat, v.kind, v.targetId);
      const rows = (
        await sql.query<ShareRow>(
          'select * from brand_room_shares where organization_id = $1 and kind = $2 and target_id = $3 order by created_at desc limit $4',
          [v.organizationId, v.kind, v.targetId, SHARE_LIMITS.listMax],
        )
      ).rows;
      return { ok: true as const, shares: rows.map((r) => linkView(r, now)) };
    }),
  );
}

export async function revokeShare(deps: ShareDeps, viewer: Viewer, raw: unknown): Promise<ShareDone | ShareFailure> {
  const organizationId = (raw as { organizationId?: unknown } | null)?.organizationId;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) return failure('invalid');
  const gate = await guard(() => deps.sql.transaction((sql) => editorSeat(sql, viewer, organizationId)));
  if ('ok' in gate) return gate;
  const parsed = ShareRevokeSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await editorSeat(sql, viewer, organizationId);
      const row = (await sql.query<ShareRow>('select * from brand_room_shares where id = $1 and organization_id = $2 for update', [parsed.data.shareId, organizationId])).rows[0];
      if (!row) throw new ShareDenied('not_found');
      await targetFor(deps, sql, seat, row.kind, row.target_id).catch((error) => {
        // An item deleted since keeps its links revocable by the people who could manage it.
        if (!(error instanceof ShareDenied)) throw error;
      });
      if (!row.revoked_at) await sql.query('update brand_room_shares set revoked_at = now(), revoked_by = $2 where id = $1', [row.id, seat.userId]);
      return { ok: true as const };
    }),
  );
}

/* --------------------------------------------------------------- team side */

async function requireStaff(sql: SqlRunner, viewer: Viewer): Promise<string> {
  if (!viewer.userId || !UUID.test(viewer.userId)) throw new ShareDenied('sign_in_required');
  const profile = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1 for share', [viewer.userId])).rows[0];
  if (!profile) throw new ShareDenied('sign_in_required');
  if (profile.is_admin !== true) throw new ShareDenied('forbidden');
  if (!(await sharesReady(sql))) throw new ShareDenied('provider_unavailable');
  return viewer.userId;
}

/** Every link of one item, for the team's review page. */
export async function staffListShares(deps: ShareDeps, viewer: Viewer, input: { kind: ShareKind; targetId: string }): Promise<ShareList | ShareFailure> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      await requireStaff(sql, viewer);
      if (!UUID.test(input.targetId)) throw new ShareDenied('invalid');
      const rows = (
        await sql.query<ShareRow>('select * from brand_room_shares where kind = $1 and target_id = $2 order by created_at desc limit $3', [input.kind, input.targetId, SHARE_LIMITS.listMax])
      ).rows;
      return { ok: true as const, shares: rows.map((r) => linkView(r, now)) };
    }),
  );
}

/** The kill switch, from /admin (`brand_rooms.share.revoke`). */
export async function staffRevokeShare(deps: ShareDeps, viewer: Viewer, input: { shareId: string }): Promise<(ShareDone & { kind: ShareKind; targetId: string }) | ShareFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const userId = await requireStaff(sql, viewer);
      if (!UUID.test(input.shareId ?? '')) throw new ShareDenied('invalid');
      const row = (await sql.query<ShareRow>('select * from brand_room_shares where id = $1 for update', [input.shareId])).rows[0];
      if (!row) throw new ShareDenied('not_found');
      if (!row.revoked_at) await sql.query('update brand_room_shares set revoked_at = now(), revoked_by = $2 where id = $1', [row.id, userId]);
      return { ok: true as const, kind: row.kind, targetId: String(row.target_id) };
    }),
  );
}

/* --------------------------------------------------------------- the public page */

/**
 * The live link behind a token, or null for anything else (unknown, malformed, revoked, expired, rooms
 * off, a closed brand, 0084 missing). Lookup by hash, then a constant-time comparison of the hashes.
 */
export async function resolveShare(sql: SqlRunner, token: unknown, lock = false): Promise<ShareRow | null> {
  if (!brandRoomsOpen() || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  if (!(await sharesReady(sql))) return null;
  const hash = hashShareToken(token);
  const row = (await sql.query<ShareRow>(`select * from brand_room_shares where token_hash = $1${lock ? ' for update' : ''}`, [hash])).rows[0];
  if (!row) return null;
  const a = Buffer.from(String(row.token_hash));
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (row.revoked_at) return null;
  if (new Date(iso(row.expires_at)).getTime() <= Date.now()) return null;
  if (!(await organizationOpen(sql, String(row.organization_id)))) return null;
  return row;
}

export type SharePage =
  | { state: 'locked'; kind: ShareKind }
  | { state: 'open'; share: PublicShare; review: { review: ReviewItem; comments: ReviewComment[] } }
  | { state: 'open'; share: PublicShare; storyboard: StoryboardView };

const publicShare = (row: ShareRow): PublicShare => ({
  kind: row.kind,
  allowComments: row.allow_comments === true,
  allowDownload: row.allow_download === true,
  expiresAt: iso(row.expires_at),
});

/** What `/s/<token>` renders, or null (the page answers 404). `unlock` is the cookie the browser sent, if any. */
export async function loadSharePage(deps: ShareDeps, token: string, cookies: { get(name: string): string | undefined }): Promise<SharePage | null> {
  const row = await deps.sql.transaction((sql) => resolveShare(sql, token));
  if (!row) return null;
  if (!proofMatches(row, cookies.get(unlockCookieName(String(row.id))))) return { state: 'locked', kind: row.kind };
  if (row.kind === 'review') {
    const found = await deps.sql.transaction((sql) => sharedReviewView(sql, deps.media, String(row.organization_id), String(row.target_id)));
    if (!found) return null;
    // The page plays the piece and lists its notes; no id of the organization, project, stack or studio file goes with it.
    const { organizationId: _org, projectId: _project, stackId: _stack, subject: _subject, ...rest } = found.review;
    const review: ReviewItem = { ...rest, organizationId: '', subject: { assetId: '' } };
    return { state: 'open', share: publicShare(row), review: { review, comments: found.comments } };
  }
  const board = await storyboardForShare({ sql: deps.sql, media: deps.media }, String(row.organization_id), String(row.target_id));
  if (!board) return null;
  return { state: 'open', share: publicShare(row), storyboard: board };
}

/** The right passphrase: the proof to set as a cookie. A wrong one counts toward the link's pause. */
export async function unlockShare(
  deps: ShareDeps,
  raw: unknown,
): Promise<{ ok: true; cookie: { name: string; value: string; maxAge: number } } | ShareFailure> {
  const parsed = ShareUnlockSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const windowMs = SHARE_LIMITS.unlockWindowMinutes * 60_000;
  // Read and count under the row lock so parallel guesses cannot each see "not paused yet".
  const outcome = await deps.sql.transaction(async (sql): Promise<{ row: ShareRow } | { code: 'not_found' | 'locked' | 'wrong_passphrase' }> => {
    const row = await resolveShare(sql, parsed.data.token, true);
    if (!row) return { code: 'not_found' as const };
    if (!row.passphrase_hash) return { row };
    const windowAt = row.unlock_window_at ? new Date(iso(row.unlock_window_at)).getTime() : 0;
    const inWindow = Date.now() - windowAt < windowMs;
    if (inWindow && Number(row.unlock_failures) >= SHARE_LIMITS.unlockFailuresMax) return { code: 'locked' as const };
    if (await verifyPassphrase(parsed.data.passphrase, row.passphrase_hash)) {
      if (Number(row.unlock_failures) > 0) await sql.query('update brand_room_shares set unlock_failures = 0, unlock_window_at = null where id = $1', [row.id]);
      return { row };
    }
    await sql.query(
      inWindow
        ? 'update brand_room_shares set unlock_failures = unlock_failures + 1 where id = $1'
        : 'update brand_room_shares set unlock_failures = 1, unlock_window_at = now() where id = $1',
      [row.id],
    );
    return { code: 'wrong_passphrase' as const };
  });
  if ('code' in outcome) return failure(outcome.code);
  const row = outcome.row;
  const left = Math.floor((new Date(iso(row.expires_at)).getTime() - Date.now()) / 1000);
  return { ok: true, cookie: { name: unlockCookieName(String(row.id)), value: unlockProof(row), maxAge: Math.max(60, Math.min(left, 7 * 86_400)) } };
}

/** A guest's note on a shared review item, when the link allows it. */
export async function guestComment(
  deps: ShareDeps,
  raw: unknown,
  cookies: { get(name: string): string | undefined },
): Promise<ReviewCommentAdded | ShareFailure> {
  const parsed = ShareCommentSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const row = await resolveShare(sql, v.token, true);
      if (!row || row.kind !== 'review') throw new ShareDenied('not_found');
      if (!proofMatches(row, cookies.get(unlockCookieName(String(row.id))))) throw new ShareDenied('forbidden');
      if (!row.allow_comments) throw new ShareDenied('comments_closed');
      const counts = (
        await sql.query<{ minute: number; day: number }>(
          `select count(*) filter (where created_at > now() - interval '1 minute')::int as minute,
                  count(*) filter (where created_at > now() - interval '1 day')::int as day
             from brand_studio_review_comments where share_id = $1`,
          [row.id],
        )
      ).rows[0]!;
      if (Number(counts.minute) >= SHARE_LIMITS.guestCommentsPerMinute || Number(counts.day) >= SHARE_LIMITS.guestCommentsPerDay) throw new ShareDenied('rate_limited');
      const added = await addGuestComment(sql, {
        organizationId: String(row.organization_id),
        reviewId: String(row.target_id),
        shareId: String(row.id),
        guestName: v.name,
        comment: guestNoteOf(v) as Record<string, unknown>,
      });
      if (!added.ok) throw new ShareDenied(added.code === 'not_found' ? 'not_found' : added.code === 'invalid' ? 'invalid' : 'failed');
      return added;
    }),
  );
}

/** One view per visitor per hour. Returns the visitor id to keep in the cookie. */
export async function countShareView(
  deps: ShareDeps,
  raw: unknown,
  cookies: { get(name: string): string | undefined },
): Promise<{ ok: true; visitor: string } | ShareFailure> {
  const parsed = ShareViewSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const existing = cookies.get(VISITOR_COOKIE);
  const visitor = isVisitorId(existing) ? existing : newVisitorId();
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const row = await resolveShare(sql, parsed.data.token);
      if (!row) throw new ShareDenied('not_found');
      // A locked link's page has shown nothing yet: no view.
      if (!proofMatches(row, cookies.get(unlockCookieName(String(row.id))))) return { ok: true as const, visitor };
      const visitorHash = createHash('sha256').update(`${row.id}:${visitor}`).digest('hex');
      const fresh = (
        await sql.query(
          `insert into brand_room_share_visits (share_id, visitor_hash, hour) values ($1, $2, date_trunc('hour', now()))
           on conflict do nothing returning share_id`,
          [row.id, visitorHash],
        )
      ).rows[0];
      if (fresh) {
        await sql.query('update brand_room_shares set views = views + 1, last_viewed_at = now() where id = $1', [row.id]);
        await sql.query("delete from brand_room_share_visits where share_id = $1 and hour < now() - interval '2 days'", [row.id]);
      }
      return { ok: true as const, visitor };
    }),
  );
}
