/**
 * Seams between the room's slices (docs/BRAND-ROOMS.md §10). Types and event names only; each slice
 * fills in its own stub file and imports the others through here.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { RoomRef } from "@/lib/brand-rooms/events";

export type { RoomRef };
export type RoomLocale = "ko" | "en";

/** `window` event: something changed that the rail's unread badges should re-read. No detail. */
export const ROOM_ACTIVITY = "twings:room-activity";

/* ------------------------------------------------------------------ chat (M) */

/** One conversation: a project's channel, or the organization's general channel (`projectId: null`). */
export interface RoomChannelProps {
  organizationId: string;
  projectId: string | null;
  locale: RoomLocale;
  copy: Dictionary["roomsChat"];
  canTalk: boolean;
  /** Fill the parent's height (the inbox) or grow with the page (a room tab). */
  layout: "fill" | "flow";
}

/**
 * The thread about one thing (a storyboard cut, a deliverable): every message in the project's channel
 * whose `ref` matches, with a composer that posts with that `ref`. Slices S and R mount it beside the
 * cut or the player; it IS the comment column of a cut.
 */
export interface RoomThreadProps {
  organizationId: string;
  projectId: string;
  roomRef: RoomRef;
  locale: RoomLocale;
  copy: Dictionary["roomsChat"];
  canTalk: boolean;
  /** Shown above the composer ("컷 3에 남기기"). */
  label: string;
}

/** `GET /api/brand-rooms/summary?organizationId=` — what the rail and the room overview read. */
export interface RoomSummary {
  ok: true;
  /** Unread messages across every channel the viewer may open. */
  unread: number;
  channels: Array<{ projectId: string | null; title: string; unread: number; lastAt: string | null; lastLine: string | null }>;
}

/* ------------------------------------------------------------ storyboard (S) */

export interface StoryboardFrameView {
  id: string;
  idx: number;
  scene: string | null;
  shot: string | null;
  url: string;
  width: number | null;
  height: number | null;
  description: string;
  camera: string | null;
  audio: string | null;
  seconds: number | null;
  /** Messages in this cut's thread (0 on a shared link). */
  threadCount: number;
}

export interface StoryboardView {
  id: string;
  projectId: string;
  title: string;
  version: number;
  status: "draft" | "shared" | "changes_requested" | "approved";
  createdRole: "brand" | "studio";
  frames: StoryboardFrameView[];
  updatedAt: string;
}

/** The storyboard tab of a room. */
export interface StoryboardTabProps {
  organizationId: string;
  projectId: string;
  locale: RoomLocale;
  copy: Dictionary["roomsStoryboard"];
  chatCopy: Dictionary["roomsChat"];
  shareCopy: Dictionary["roomsReview"];
  canEdit: boolean;
  canTalk: boolean;
  /** `?board=<id>&frame=<id>` from the address, to open a cut directly. */
  initial?: { boardId?: string; frameId?: string };
}

/** A storyboard with nothing around it and no way to change it (the shared-link page uses it). */
export interface StoryboardReadOnlyProps {
  board: StoryboardView;
  locale: RoomLocale;
  copy: Dictionary["roomsStoryboard"];
}

/* ---------------------------------------------------------------- review (R) */

/** The deliverables tab of a room: the project's review items with their version stacks. */
export interface ProjectReviewTabProps {
  organizationId: string;
  projectId: string;
  locale: RoomLocale;
  copy: Dictionary["roomsReview"];
  reviewCopy: Dictionary["studioReview"];
  chatCopy: Dictionary["roomsChat"];
  canEdit: boolean;
  canTalk: boolean;
  initial?: { reviewId?: string; atMs?: number };
}

/** The share button + dialog for one storyboard or one review item. */
export interface ShareButtonProps {
  organizationId: string;
  target: { kind: "storyboard" | "review"; id: string };
  locale: RoomLocale;
  copy: Dictionary["roomsReview"];
  canEdit: boolean;
}

/* --------------------------------------------------------------- overview (H) */

export type RoomStage = "requested" | "storyboard" | "draft" | "revision" | "done";
