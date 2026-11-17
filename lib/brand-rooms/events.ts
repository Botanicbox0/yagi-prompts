/**
 * The line a room's conversation gets when something happens outside it (docs/BRAND-ROOMS.md §4):
 * a storyboard was shared, a new version arrived, a deliverable was approved. Slices S and R call this;
 * slice M implements it (a `kind: 'event'` message with `author_role: 'system'` and the `ref`).
 *
 * Best effort by contract: a failure here never fails the write that called it.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { enqueueNotices } from './notices';

export const ROOM_EVENT_KINDS = [
  'storyboard_shared',
  'storyboard_version',
  'storyboard_approved',
  'storyboard_changes_requested',
  'review_posted',
  'review_version',
  'review_approved',
  'review_changes_requested',
  'review_commented',
] as const;
export type RoomEventKind = (typeof ROOM_EVENT_KINDS)[number];

/** What a message can point at. `frameId` narrows a storyboard ref to one cut; `commentId` narrows a review ref to one note. */
export type RoomRef =
  | { kind: 'storyboard'; storyboardId: string; frameId?: string }
  | { kind: 'review'; reviewId: string; commentId?: string };

export interface RoomEventInput {
  organizationId: string;
  projectId: string;
  event: RoomEventKind;
  ref: RoomRef;
  /** Who did it (a profile id), and on which side. */
  actorId: string | null;
  actorRole: 'brand' | 'studio';
  /** Short facts the line may show ("v2", the title). Never free text from a customer. */
  detail?: { title?: string; version?: number };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The flat form the table indexes (same rule as `refKeyOf` in ./message-contracts.ts). Null for a malformed ref. */
function eventRefKey(ref: RoomRef): string | null {
  const ids = ref.kind === 'storyboard' ? [ref.storyboardId, ref.frameId] : [ref.reviewId, ref.commentId];
  if (!ids[0] || !UUID.test(ids[0]) || (ids[1] !== undefined && !UUID.test(ids[1]))) return null;
  return [ref.kind, ...ids.filter((id): id is string => Boolean(id)).map((id) => id.toLowerCase())].join(':');
}

/**
 * Write the event line. Inside the caller's transaction it runs under a savepoint, so a failed insert is
 * rolled back alone and the caller's transaction stays usable; outside one, a failure simply leaves no
 * line. Either way it is logged and swallowed. The actor is stored only when it is a real profile.
 */
export async function postRoomEvent(sql: SqlRunner, input: RoomEventInput): Promise<void> {
  const refKey = input?.ref ? eventRefKey(input.ref) : null;
  if (
    !input ||
    !UUID.test(input.organizationId ?? '') ||
    !UUID.test(input.projectId ?? '') ||
    !(ROOM_EVENT_KINDS as readonly string[]).includes(input.event) ||
    !refKey ||
    (input.actorRole !== 'brand' && input.actorRole !== 'studio')
  ) {
    console.warn('[brand-rooms] room_event_invalid', JSON.stringify({ event: String(input?.event ?? '').slice(0, 40) }));
    return;
  }
  const detail: Record<string, unknown> = { actorRole: input.actorRole };
  const title = input.detail?.title?.replace(/\s+/g, ' ').trim();
  if (title) detail.title = title.slice(0, 120);
  if (Number.isInteger(input.detail?.version) && input.detail!.version! > 0 && input.detail!.version! < 10_000) detail.version = input.detail!.version;
  const ref =
    input.ref.kind === 'storyboard'
      ? { kind: 'storyboard', storyboardId: input.ref.storyboardId.toLowerCase(), ...(input.ref.frameId ? { frameId: input.ref.frameId.toLowerCase() } : {}) }
      : { kind: 'review', reviewId: input.ref.reviewId.toLowerCase(), ...(input.ref.commentId ? { commentId: input.ref.commentId.toLowerCase() } : {}) };
  let savepoint = false;
  try {
    await sql.query('savepoint brand_room_event');
    savepoint = true;
  } catch {
    // Not inside a transaction: nothing of the caller's can be poisoned by a failed insert.
  }
  let lineId: string | null = null;
  try {
    const { rows } = await sql.query<{ id: string }>(
      `insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, event, detail, ref, ref_key)
         values ($1, $2::uuid, $8::text, (select id from profiles where id = $3::uuid), 'system', 'event', $4, $5::jsonb, $6::jsonb, $7)
       returning id`,
      [input.organizationId, input.projectId, input.actorId && UUID.test(input.actorId) ? input.actorId : null, input.event, JSON.stringify(detail), JSON.stringify(ref), refKey, input.projectId.toLowerCase()],
    );
    lineId = rows[0]?.id ? String(rows[0].id) : null;
    if (savepoint) await sql.query('release savepoint brand_room_event');
  } catch (error) {
    if (savepoint) await sql.query('rollback to savepoint brand_room_event').catch(() => undefined);
    console.warn('[brand-rooms] room_event_failed', JSON.stringify({ event: input.event, message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }));
    return;
  }
  // Mail and push to the room's members (docs/BRAND-ROOMS-FEEDBACK.md §2). Same contract: never throws.
  if (lineId) {
    await enqueueNotices(sql, {
      type: 'event',
      organizationId: input.organizationId,
      projectId: input.projectId,
      event: input.event,
      messageId: lineId,
      actorId: input.actorId,
      actorRole: input.actorRole,
    });
  }
}
