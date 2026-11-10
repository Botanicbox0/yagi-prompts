/**
 * The line a room's conversation gets when something happens outside it (docs/BRAND-ROOMS.md §4):
 * a storyboard was shared, a new version arrived, a deliverable was approved. Slices S and R call this;
 * slice M implements it (a `kind: 'event'` message with `author_role: 'system'` and the `ref`).
 *
 * Best effort by contract: a failure here never fails the write that called it.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';

export const ROOM_EVENT_KINDS = [
  'storyboard_shared',
  'storyboard_version',
  'storyboard_approved',
  'storyboard_changes_requested',
  'review_posted',
  'review_version',
  'review_approved',
  'review_changes_requested',
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

/** Stub until slice M lands. */
export async function postRoomEvent(_sql: SqlRunner, _input: RoomEventInput): Promise<void> {}
